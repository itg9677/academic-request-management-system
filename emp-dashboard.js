import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, collection, query, where, getDocs,
  updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentEmployee = null;
let isAffairs = false;

// ==================== State ====================

const studentsCache  = {};
const employeesCache = {};

const tabData = { addDrop: [], excuse: [], visit: [] };

let currentTab          = "addDrop";
let currentStatusFilter = "all";
let searchQuery         = "";
let activeRequest       = null;

// ==================== التواريخ ====================

function setDates() {
  const now  = new Date();
  const days = ["الاحد","الاثنين","الثلاثاء","الاربعاء","الخميس","الجمعة","السبت"];
  document.getElementById("gregDate").textContent =
    days[now.getDay()] + "، " + now.toLocaleDateString("ar-SA-u-ca-gregory");
  document.getElementById("hijriDate").textContent =
    now.toLocaleDateString("ar-SA-u-ca-islamic");
}

// ==================== أدوات مساعدة ====================

function esc(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function formatDate(ts) {
  if (!ts) return "-";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("ar-SA-u-ca-gregory");
  } catch (e) { return "-"; }
}

function formatFieldValue(value) {
  if (value === null || value === undefined) return "-";
  if (value && typeof value.toDate === "function")
    return value.toDate().toLocaleDateString("ar-SA-u-ca-gregory");
  if (Array.isArray(value)) {
    if (!value.length) return "-";
    return value.map(v => typeof v === "object" ? JSON.stringify(v) : String(v)).join("، ");
  }
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

// ==================== ثوابت ====================

const fieldLabels = {
  fullName:       "الاسم الكامل",
  studentId:      "الرقم الجامعي",
  universityId:   "الرقم الجامعي",
  email:          "البريد الإلكتروني",
  major:          "التخصص",
  phoneNumber:    "رقم الجوال",
  phone:          "رقم الجوال",
  mobile:         "رقم الجوال",
  level:          "المستوى الدراسي",
  gender:         "الجنس",
  nationalId:     "رقم الهوية",
  section:        "الشعبة",
  department:     "القسم",
  college:        "الكلية",
  gpa:            "المعدل التراكمي",
  creditHours:    "الساعات المكتملة",
  enrollmentYear: "سنة الالتحاق",
  graduationYear: "سنة التخرج المتوقعة",
  status:         "حالة الطالب",
  uid:            "معرف المستخدم",
  updatedAt:      "تاريخ آخر تحديث",
  address:        "العنوان",
  city:           "المدينة",
  nationality:    "الجنسية",
  birthDate:      "تاريخ الميلاد",
  advisorName:    "المرشد الأكاديمي",
  track:          "المسار",
  plan:           "الخطة الدراسية",
};

const hiddenFields = [
  "_uid", "password", "token", "fcmToken", "pushToken",
  "deviceId", "emailVerified", "role", "createdAt"
];

const statusLabel = {
  new:          "جديد",
  under_review: "قيد المراجعة",
  approved:     "مقبول",
  rejected:     "مرفوض"
};

const reqTypeLabel   = { add: "اضافة", drop: "حذف", edit: "تعديل شعبة", remove: "حذف", change: "تعديل شعبة" };
const visitTypeLabel = { internal: "داخلية", external: "خارجية" };
const levelLabel     = {
  "1": "المستوى الأول", "2": "المستوى الثاني", "3": "المستوى الثالث",
  "4": "المستوى الرابع", "5": "المستوى الخامس", "6": "المستوى السادس",
  "7": "المستوى السابع", "8": "المستوى الثامن"
};

const tabConfig = {
  addDrop: { collectionName: "requests",      studentField: "studentUid", title: "طلبات الحذف والإضافة" },
  excuse:  { collectionName: "excuses",       studentField: "studentUid", title: "طلبات رفع الأعذار"   },
  visit:   { collectionName: "visitRequests", studentField: "uid",        title: "طلبات الزيارة"       }
};

const REJECT_REASONS = [
  { value: "section_closed", label: "الشعبة مغلقة"         },
  { value: "system_closed",  label: "تم اقفال النظام"      },
  { value: "no_contact",     label: "عدم تواصل الطالبة"    },
  { value: "conflict",       label: "وجود تعارض"            },
  { value: "other",          label: "أخرى"                  }
];

// ==================== حالة "جديد" ====================

// حالة "جديد" = طلب pending ما عنده موظف معالج
// حالة "قيد المراجعة" = طلب pending وله موظف معالج (دمج معلق مع قيد المراجعة)
function getEffectiveStatus(item) {
  if (item.status === "pending" || !item.status) {
    return item.assignedEmployee ? "under_review" : "new";
  }
  return item.status;
}

// ==================== جلب البيانات ====================

async function getStudent(uid) {
  if (!uid) return null;
  if (studentsCache[uid]) return studentsCache[uid];

  // 1) document ID
  try {
    const snap = await getDoc(doc(db, "students", uid));
    if (snap.exists()) {
      studentsCache[uid] = { _uid: uid, ...snap.data() };
      return studentsCache[uid];
    }
  } catch(e) {}

  // 2) studentId field
  try {
    const q = query(collection(db, "students"), where("studentId", "==", uid));
    const snap = await getDocs(q);
    if (!snap.empty) {
      studentsCache[uid] = { _uid: uid, ...snap.docs[0].data() };
      return studentsCache[uid];
    }
  } catch(e) {}

  // 3) universityId field
  try {
    const q = query(collection(db, "students"), where("universityId", "==", uid));
    const snap = await getDocs(q);
    if (!snap.empty) {
      studentsCache[uid] = { _uid: uid, ...snap.docs[0].data() };
      return studentsCache[uid];
    }
  } catch(e) {}

  studentsCache[uid] = { _uid: uid, fullName: "-", studentId: "-", email: "-", major: "-" };
  return studentsCache[uid];
}

async function getEmployeeName(uid) {
  if (!uid) return null;
  if (employeesCache[uid]) return employeesCache[uid];
  try {
    const snap = await getDoc(doc(db, "employees", uid));
    employeesCache[uid] = snap.exists() ? (snap.data().fullName || "-") : "-";
  } catch(e) {
    employeesCache[uid] = "-";
  }
  return employeesCache[uid];
}

// ==================== تحميل البيانات ====================

async function loadAllData() {
  const loadingEl   = document.getElementById("loadingState");
  const tableWrapEl = document.getElementById("tableWrap");

  if (loadingEl)   loadingEl.style.display  = "";
  if (tableWrapEl) tableWrapEl.style.display = "none";

  try {
    const types = ["add", "drop", "edit", "remove", "change"];

    const reqQuery = isAffairs
      ? query(collection(db, "requests"), where("requestType", "in", types))
      : query(collection(db, "requests"), where("requestType", "in", types),
              where("assignedDepartment", "==", currentEmployee.department));

    const excQuery = isAffairs
      ? query(collection(db, "excuses"))
      : query(collection(db, "excuses"), where("assignedDepartment", "==", currentEmployee.department));

    const [reqSnap, excSnap, visSnap] = await Promise.all([
      getDocs(reqQuery),
      getDocs(excQuery),
      getDocs(collection(db, "visitRequests"))
    ]);

    tabData.addDrop = reqSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    tabData.excuse  = excSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    tabData.visit   = visSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    updateBadges();
  } catch(err) {
    console.error("loadAllData error:", err);
  } finally {
    if (loadingEl)   loadingEl.style.display  = "none";
    if (tableWrapEl) tableWrapEl.style.display = "";
  }

  await renderTab();
}

function updateBadges() {
  const el = (id) => document.getElementById(id);
  if (el("badge-addDrop")) el("badge-addDrop").textContent = tabData.addDrop.filter(r => r.status === "pending").length;
  if (el("badge-excuse"))  el("badge-excuse").textContent  = tabData.excuse.filter(r => r.status === "pending").length;
  if (el("badge-visit"))   el("badge-visit").textContent   = tabData.visit.filter(r => r.status === "pending").length;
}

function updateStatCards() {
  const items = tabData[currentTab];
  const counts = {
    new:          items.filter(r => getEffectiveStatus(r) === "new").length,
    under_review: items.filter(r => getEffectiveStatus(r) === "under_review").length,
    approved:     items.filter(r => r.status === "approved").length,
    rejected:     items.filter(r => r.status === "rejected").length,
    all:          items.length
  };
  Object.entries(counts).forEach(([key, val]) => {
    const el = document.getElementById("cnt-" + key);
    if (el) el.textContent = val;
  });
}

// ==================== عرض الجدول الرئيسي ====================

async function renderTab() {
  const cfg   = tabConfig[currentTab];
  const items = tabData[currentTab];

  // prefetch students & employees
  const uniqueStudentUids = [...new Set(items.map(it => it[cfg.studentField]).filter(Boolean))];
  await Promise.all(uniqueStudentUids.map(uid => getStudent(uid)));

  const uniqueEmpUids = [...new Set(items.map(it => it.assignedEmployee).filter(Boolean))];
  await Promise.all(uniqueEmpUids.map(uid => getEmployeeName(uid)));

  // filter
  let filtered = [...items];

  if (currentStatusFilter !== "all") {
    filtered = filtered.filter(it => getEffectiveStatus(it) === currentStatusFilter);
  }

  const q = searchQuery.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(it => {
      const student = studentsCache[it[cfg.studentField]] || {};
      const name    = (student.fullName || "").toLowerCase();
      const sid     = String(student.studentId || student.universityId || "").toLowerCase();
      return name.includes(q) || sid.includes(q);
    });
  }

  updateStatCards();

  // group by student
  const byStudent = {};
  filtered.forEach(it => {
    const uid = it[cfg.studentField];
    if (!uid) return;
    if (!byStudent[uid]) byStudent[uid] = [];
    byStudent[uid].push(it);
  });

  // sort: new/pending first, then by createdAt asc
  const priority = { new: 0, under_review: 1, approved: 2, rejected: 2 };
  const sortedUids = Object.keys(byStudent).sort((a, b) => {
    const worstA = Math.min(...byStudent[a].map(r => priority[getEffectiveStatus(r)] ?? 4));
    const worstB = Math.min(...byStudent[b].map(r => priority[getEffectiveStatus(r)] ?? 4));
    if (worstA !== worstB) return worstA - worstB;
    const ta = byStudent[a][0].createdAt?.toMillis?.() ?? 0;
    const tb = byStudent[b][0].createdAt?.toMillis?.() ?? 0;
    return ta - tb;
  });

  const tbody      = document.getElementById("mainTbody");
  const emptyState = document.getElementById("emptyState");
  tbody.innerHTML  = "";

  if (!sortedUids.length) {
    if (emptyState) emptyState.style.display = "";
  } else {
    if (emptyState) emptyState.style.display = "none";
    sortedUids.forEach(uid => {
      tbody.appendChild(buildRow(currentTab, uid, byStudent[uid]));
    });
  }

  const infoBar = document.getElementById("searchInfoBar");
  if (infoBar) {
    if (q) {
      infoBar.style.display = "";
      infoBar.textContent   = `نتائج البحث عن "${searchQuery.trim()}": ${sortedUids.length} طالب`;
    } else {
      infoBar.style.display = "none";
    }
  }
}

function buildRow(tab, studentUid, requests) {
  const cfg     = tabConfig[tab];
  const student = studentsCache[studentUid] || {};
  const tr      = document.createElement("tr");
  tr.dataset.tab = tab;
  tr.dataset.uid = studentUid;

  const initials = (student.fullName || "??").slice(0, 2);

  const priority = { new: 0, under_review: 1, approved: 2, rejected: 2 };
  const worstItem = requests.reduce((prev, cur) => {
    const ps = getEffectiveStatus(prev);
    const cs = getEffectiveStatus(cur);
    return (priority[cs] ?? 4) < (priority[ps] ?? 4) ? cur : prev;
  });

  tr.innerHTML = `
    <td>
      <div class="student-name-cell">
        <div class="student-avatar">${esc(initials)}</div>
        <div>
          <div class="student-name-text">${esc(student.fullName || "-")}</div>
          <div class="student-major-text">${esc(student.major || "")}</div>
        </div>
      </div>
    </td>
    <td class="uid-cell">${esc(student.studentId || student.universityId || "-")}</td>
    <td><span class="req-count-badge">${requests.length}</span></td>
    <td><button class="detail-btn">عرض <i class="ti ti-chevron-left detail-chevron"></i></button></td>
  `;

  tr.addEventListener("click", () => openSidePanel(tab, worstItem));
  return tr;
}

// ==================== اللوحة الجانبية ====================

function buildStudentAllFields(student) {
  return Object.entries(student)
    .filter(([key]) => !hiddenFields.includes(key))
    .map(([key, value]) => {
      const label        = fieldLabels[key] || key;
      const displayValue = formatFieldValue(value);
      return `<tr>
        <td class="sp-detail-label">${esc(label)}</td>
        <td>${esc(displayValue)}</td>
      </tr>`;
    })
    .join("");
}

function buildDetailRows(tab, item) {
  const statusKey  = getEffectiveStatus(item);
  const statusHtml = `<span class="status-badge s-${statusKey}">${statusLabel[statusKey] || statusKey}</span>`;
  const empName    = item.assignedEmployee
    ? (employeesCache[item.assignedEmployee] || item.assignedEmployeeName || "-")
    : "-";

  const rejectRow = (item.status === "rejected" && item.rejectReason)
    ? `<tr><td class="sp-detail-label">سبب الرفض</td><td><span class="sp-reject-reason">${esc(item.rejectReason)}</span></td></tr>`
    : "";

  if (tab === "addDrop") {
    let rows = `
      <tr><td class="sp-detail-label">نوع الطلب</td><td>${reqTypeLabel[item.requestType] || item.requestType || "-"}</td></tr>
      <tr><td class="sp-detail-label">المقرر</td><td>${esc(item.courseName || "-")} (${esc(item.courseCode || "-")})</td></tr>
    `;
    if (item.requestType === "edit" || item.requestType === "change") {
      rows += `<tr><td class="sp-detail-label">الشعبة المطلوبة</td><td>${esc(item.requestedSection || "-")}</td></tr>`;
    }
    rows += `
      <tr><td class="sp-detail-label">ملاحظات الطالب</td><td>${esc(item.notes || "-")}</td></tr>
      <tr><td class="sp-detail-label">تاريخ الطلب</td><td>${formatDate(item.createdAt)}</td></tr>
      <tr><td class="sp-detail-label">الحالة</td><td>${statusHtml}</td></tr>
      <tr><td class="sp-detail-label">الموظف المعالج</td><td>${esc(empName)}</td></tr>
      ${rejectRow}
    `;
    return rows;
  }

  if (tab === "excuse") {
    const attach = item.attachmentUrl
      ? `<a href="${esc(item.attachmentUrl)}" target="_blank" rel="noopener">تحميل المرفق</a>`
      : "لا يوجد";
    return `
      <tr><td class="sp-detail-label">رمز المقرر</td><td>${esc(item.courseCode || "-")}</td></tr>
      <tr><td class="sp-detail-label">تاريخ الغياب</td><td>${esc(item.absenceDate || item.examDate || "-")}</td></tr>
      <tr><td class="sp-detail-label">سبب الغياب</td><td>${esc(item.reason || item.notes || "-")}</td></tr>
      <tr><td class="sp-detail-label">المرفق</td><td>${attach}</td></tr>
      <tr><td class="sp-detail-label">تاريخ الطلب</td><td>${formatDate(item.createdAt)}</td></tr>
      <tr><td class="sp-detail-label">الحالة</td><td>${statusHtml}</td></tr>
      <tr><td class="sp-detail-label">الموظف المعالج</td><td>${esc(empName)}</td></tr>
      ${rejectRow}
    `;
  }

  // visit
  const courses = (item.courses || [])
    .map(c => `${esc(c.courseName || "-")} (${esc(c.courseCode || "-")}) — الشعبة: ${esc(c.section || "-")}`)
    .join("<br>") || "-";

  return `
    <tr><td class="sp-detail-label">نوع الزيارة</td><td>${visitTypeLabel[item.visitType] || item.visitType || "-"}</td></tr>
    <tr><td class="sp-detail-label">المستوى الدراسي</td><td>${levelLabel[item.level] || esc(item.level || "-")}</td></tr>
    <tr><td class="sp-detail-label">المقر المراد زيارته</td><td>${esc(item.visitPlace || "-")}</td></tr>
    <tr><td class="sp-detail-label">سبب الزيارة</td><td>${esc(item.reason || "-")}</td></tr>
    <tr><td class="sp-detail-label">المقررات</td><td>${courses}</td></tr>
    <tr><td class="sp-detail-label">تاريخ الطلب</td><td>${formatDate(item.createdAt)}</td></tr>
    <tr><td class="sp-detail-label">الحالة</td><td>${statusHtml}</td></tr>
    <tr><td class="sp-detail-label">الموظف المعالج</td><td>${esc(empName)}</td></tr>
    ${rejectRow}
  `;
}

function buildOtherRequestsTable(tab, item) {
  const cfg    = tabConfig[tab];
  const others = tabData[tab].filter(
    it => it.id !== item.id && it[cfg.studentField] === item[cfg.studentField]
  );
  if (!others.length) return "";

  const rows = others.map(o => {
    let label = "-";
    if (tab === "addDrop")
      label = `${reqTypeLabel[o.requestType] || o.requestType || "-"} — ${esc(o.courseName || o.courseCode || "")}`;
    else if (tab === "excuse")
      label = esc(o.courseCode || "-");
    else
      label = visitTypeLabel[o.visitType] || o.visitType || "-";

    const sk = getEffectiveStatus(o);
    return `
      <tr class="sp-other-row sp-other-clickable" data-id="${o.id}" style="cursor:pointer;" title="انقر لعرض تفاصيل هذا الطلب">
        <td>${label}</td>
        <td><span class="status-badge s-${sk}">${statusLabel[sk] || sk}</span></td>
        <td>${formatDate(o.createdAt)}</td>
        <td style="color:#1a3a6b;font-size:0.85rem;">عرض ←</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="sp-section-title">طلبات أخرى لنفس الطالب (${others.length})</div>
    <div class="sp-table-wrap">
      <table class="sp-table sp-other-table">
        <thead><tr><th>الطلب</th><th>الحالة</th><th>التاريخ</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function attachOtherRowsListeners(tab) {
  document.querySelectorAll(".sp-other-clickable").forEach(row => {
    row.addEventListener("click", () => {
      const id    = row.dataset.id;
      const found = tabData[tab].find(it => it.id === id);
      if (found) openSidePanel(tab, found);
    });
  });
}

function openSidePanel(tab, item) {
  activeRequest = { tab, item };
  const cfg     = tabConfig[tab];
  const student = studentsCache[item[cfg.studentField]] || {};
  const sk      = getEffectiveStatus(item);

  document.getElementById("spTitle").textContent = student.fullName || "تفاصيل الطالب";
  document.getElementById("spSub").textContent   = cfg.title;

  const allStudentRows = buildStudentAllFields(student);
  const canAct = sk !== "approved" && sk !== "rejected";

  document.getElementById("spBody").innerHTML = `
    <div class="sp-student-card">
      <div class="sp-student-name">
        <div class="sp-avatar">${esc((student.fullName || "??").slice(0, 2))}</div>
        <div>
          <div>${esc(student.fullName || "-")}</div>
          <div class="sp-phone">${esc(student.email || "-")}</div>
        </div>
      </div>
      <div class="sp-detail-card">
        <table class="sp-detail-table">${allStudentRows}</table>
      </div>
    </div>

    <div class="sp-section-title">تفاصيل الطلب</div>
    <div class="sp-detail-card">
      <table class="sp-detail-table">${buildDetailRows(tab, item)}</table>
    </div>

    <div class="sp-actions">
      <button class="sp-action-btn sp-approve" data-action="approved" ${sk === "approved" ? "disabled" : ""}>
        <i class="ti ti-circle-check"></i> قبول
      </button>
      <button class="sp-action-btn sp-review" data-action="under_review" ${sk === "under_review" ? "disabled" : ""}>
        <i class="ti ti-loader-2"></i> قيد المراجعة
      </button>
      <button class="sp-action-btn sp-reject" data-action="rejected" ${sk === "rejected" ? "disabled" : ""}>
        <i class="ti ti-circle-x"></i> رفض
      </button>
    </div>

    ${buildOtherRequestsTable(tab, item)}
  `;

  // action buttons
  document.getElementById("spBody").querySelectorAll(".sp-action-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "rejected") {
        openRejectModal(cfg.collectionName, item.id, async (reason) => {
          await updateRequestStatus(tab, item, "rejected", reason);
        });
      } else {
        updateRequestStatus(tab, item, action, null);
      }
    });
  });

  attachOtherRowsListeners(tab);

  document.getElementById("sidePanel").classList.add("open");
  document.getElementById("spOverlay").classList.add("show");
  const mainEl = document.querySelector(".admin-main") || document.querySelector(".emp-main");
  if (mainEl) mainEl.classList.add("panel-open");
}

function closeSidePanel() {
  document.getElementById("sidePanel").classList.remove("open");
  document.getElementById("spOverlay").classList.remove("show");
  const mainEl = document.querySelector(".admin-main") || document.querySelector(".emp-main");
  if (mainEl) mainEl.classList.remove("panel-open");
  activeRequest = null;
}

async function updateRequestStatus(tab, item, newStatus, rejectReason) {
  const cfg     = tabConfig[tab];
  const buttons = document.querySelectorAll("#spBody .sp-action-btn");
  buttons.forEach(b => b.disabled = true);

  try {
    const updateData = {
      status:               newStatus,
      assignedEmployee:     currentEmployee.uid,
      assignedEmployeeName: currentEmployee.fullName || "-",
      updatedAt:            serverTimestamp()
    };
    if (newStatus === "rejected" && rejectReason) updateData.rejectReason = rejectReason;

    await updateDoc(doc(db, cfg.collectionName, item.id), updateData);

    item.status               = newStatus;
    item.assignedEmployee     = currentEmployee.uid;
    item.assignedEmployeeName = currentEmployee.fullName || "-";
    if (rejectReason) item.rejectReason = rejectReason;

    employeesCache[currentEmployee.uid] = currentEmployee.fullName || "-";

    updateBadges();
    await renderTab();
    openSidePanel(tab, item);
  } catch(err) {
    console.error(err);
    alert("حدث خطأ: " + err.message);
    buttons.forEach(b => b.disabled = false);
  }
}

// ==================== مودال سبب الرفض ====================

function injectRejectModal() {
  if (document.getElementById("rejectModal")) return;
  const modal = document.createElement("div");
  modal.id = "rejectModal";
  modal.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;align-items:center;justify-content:center;";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:28px 24px;min-width:320px;max-width:420px;width:90%;direction:rtl;box-shadow:0 8px 32px rgba(0,0,0,.18);">
      <div style="font-size:1.1rem;font-weight:700;color:#1a3a6b;margin-bottom:18px;">سبب الرفض</div>
      <div id="rejectReasonList" style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
        ${REJECT_REASONS.map(r => `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.95rem;">
            <input type="radio" name="rejectReason" value="${r.value}" style="accent-color:#c8972b;width:16px;height:16px;">
            ${r.label}
          </label>`).join("")}
      </div>
      <div id="rejectOtherWrap" style="display:none;margin-bottom:14px;">
        <textarea id="rejectOtherText" placeholder="اكتب سبب الرفض..." rows="3"
          style="width:100%;border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-family:inherit;font-size:0.9rem;resize:vertical;box-sizing:border-box;"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="rejectCancelBtn" style="padding:8px 20px;border:1px solid #ddd;border-radius:8px;background:#f5f5f5;cursor:pointer;font-family:inherit;">إلغاء</button>
        <button id="rejectConfirmBtn" style="padding:8px 20px;border:none;border-radius:8px;background:#c0392b;color:#fff;cursor:pointer;font-weight:700;font-family:inherit;">تأكيد الرفض</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelectorAll('input[name="rejectReason"]').forEach(radio => {
    radio.addEventListener("change", () => {
      document.getElementById("rejectOtherWrap").style.display = radio.value === "other" ? "block" : "none";
    });
  });
  document.getElementById("rejectCancelBtn").addEventListener("click", closeRejectModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeRejectModal(); });
}

function openRejectModal(colName, requestId, onConfirm) {
  const modal = document.getElementById("rejectModal");
  modal.style.display = "flex";
  modal.querySelectorAll('input[name="rejectReason"]').forEach(r => r.checked = false);
  document.getElementById("rejectOtherWrap").style.display = "none";
  document.getElementById("rejectOtherText").value = "";

  document.getElementById("rejectConfirmBtn").onclick = async () => {
    const selected = modal.querySelector('input[name="rejectReason"]:checked');
    if (!selected) { alert("رجاءً اختر سبب الرفض"); return; }
    if (selected.value === "other" && !document.getElementById("rejectOtherText").value.trim()) {
      alert("رجاءً اكتب سبب الرفض"); return;
    }
    const reason = selected.value === "other"
      ? document.getElementById("rejectOtherText").value.trim()
      : REJECT_REASONS.find(r => r.value === selected.value).label;
    closeRejectModal();
    await onConfirm(reason);
  };
}

function closeRejectModal() {
  document.getElementById("rejectModal").style.display = "none";
}

// ==================== الطباعة ====================

function printActiveStudent() {
  if (!activeRequest) return;
  const { tab, item } = activeRequest;
  const cfg     = tabConfig[tab];
  const student = studentsCache[item[cfg.studentField]] || {};
  const items   = tabData[tab].filter(it => it[cfg.studentField] === item[cfg.studentField]);

  const studentInfoRows = Object.entries(student)
    .filter(([key]) => !hiddenFields.includes(key))
    .map(([key, value]) => {
      const label        = fieldLabels[key] || key;
      const displayValue = formatFieldValue(value);
      return `<tr><td class="label-col">${esc(label)}</td><td>${esc(displayValue)}</td></tr>`;
    }).join("");

  let headerCols = "";
  let rows       = "";

  if (tab === "addDrop") {
    headerCols = "<th>نوع الطلب</th><th>المقرر</th><th>الشعبة المطلوبة</th><th>ملاحظات الطالب</th><th>الحالة</th><th>الموظف المعالج</th><th>التاريخ</th>";
    rows = items.map(r => {
      const en = r.assignedEmployeeName || (r.assignedEmployee ? (employeesCache[r.assignedEmployee] || "-") : "-");
      const rejectNote = (r.status === "rejected" && r.rejectReason)
        ? `<br><small style="color:#c0392b;">«${r.rejectReason}»</small>` : "";
      return `<tr>
        <td>${reqTypeLabel[r.requestType] || r.requestType || "-"}</td>
        <td>${esc(r.courseName || "")} (${esc(r.courseCode || "")})</td>
        <td>${(r.requestType === "edit" || r.requestType === "change") ? esc(r.requestedSection || "-") : "-"}</td>
        <td>${esc(r.notes || "-")}</td>
        <td>${statusLabel[getEffectiveStatus(r)] || getEffectiveStatus(r)}${rejectNote}</td>
        <td>${esc(en)}</td>
        <td>${formatDate(r.createdAt)}</td>
      </tr>`;
    }).join("");
  } else if (tab === "excuse") {
    headerCols = "<th>رمز المقرر</th><th>تاريخ الغياب</th><th>سبب الغياب</th><th>الحالة</th><th>الموظف المعالج</th><th>التاريخ</th>";
    rows = items.map(r => {
      const en = r.assignedEmployeeName || (r.assignedEmployee ? (employeesCache[r.assignedEmployee] || "-") : "-");
      return `<tr>
        <td>${esc(r.courseCode || "-")}</td>
        <td>${esc(r.absenceDate || r.examDate || "-")}</td>
        <td>${esc(r.reason || r.notes || "-")}</td>
        <td>${statusLabel[getEffectiveStatus(r)] || getEffectiveStatus(r)}</td>
        <td>${esc(en)}</td>
        <td>${formatDate(r.createdAt)}</td>
      </tr>`;
    }).join("");
  } else {
    headerCols = "<th>نوع الزيارة</th><th>المستوى</th><th>المقر</th><th>سبب الزيارة</th><th>المقررات</th><th>الحالة</th><th>الموظف المعالج</th><th>التاريخ</th>";
    rows = items.map(r => {
      const en = r.assignedEmployeeName || (r.assignedEmployee ? (employeesCache[r.assignedEmployee] || "-") : "-");
      return `<tr>
        <td>${visitTypeLabel[r.visitType] || r.visitType || "-"}</td>
        <td>${levelLabel[r.level] || esc(r.level || "-")}</td>
        <td>${esc(r.visitPlace || "-")}</td>
        <td>${esc(r.reason || "-")}</td>
        <td>${(r.courses || []).map(c => `${esc(c.courseName || "-")} (${esc(c.courseCode || "-")}) - ${esc(c.section || "-")}`).join("<br>") || "-"}</td>
        <td>${statusLabel[getEffectiveStatus(r)] || getEffectiveStatus(r)}</td>
        <td>${esc(en)}</td>
        <td>${formatDate(r.createdAt)}</td>
      </tr>`;
    }).join("");
  }

  const styleBlock = `
    body{font-family:Arial,sans-serif;padding:30px;direction:rtl;}
    h2{color:#1a3a6b;border-bottom:3px solid #c8972b;padding-bottom:8px;}
    h3{color:#1a3a6b;margin-top:24px;}
    .info-table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px;}
    .info-table td{padding:7px 12px;border-bottom:1px solid #e0e0e0;}
    .label-col{width:35%;color:#555;font-weight:bold;}
    table.req-table{width:100%;border-collapse:collapse;margin-top:20px;font-size:13px;}
    th{background:#1a3a6b;color:white;padding:9px 12px;text-align:right;}
    td{padding:9px 12px;border-bottom:1px solid #e0e0e0;}
    tr:last-child td{border-bottom:none;}
    .footer{margin-top:30px;font-size:12px;color:#888;}
  `;

  const win = window.open("", "_blank");
  win.document.write(`
    <html dir="rtl" lang="ar">
    <head><meta charset="UTF-8"/><title>طباعة بيانات الطالب</title>
    <style>${styleBlock}</style></head>
    <body>
      <h2>بيانات الطالب — نظام الخدمات الطلابية</h2>
      <h3>معلومات الطالب</h3>
      <table class="info-table"><tbody>${studentInfoRows}</tbody></table>
      <h3>الطلبات المقدمة</h3>
      <table class="req-table">
        <thead><tr>${headerCols}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="footer">
        طُبع بواسطة: ${esc(currentEmployee.fullName || "-")} — ${esc(currentEmployee.department || "-")}
        &nbsp;|&nbsp; ${new Date().toLocaleDateString("ar-SA")}
      </div>
    </body></html>
  `);
  win.document.close();
  win.print();
}

// ==================== أحداث الواجهة ====================

document.querySelectorAll(".admin-tab, .emp-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll(".admin-tab, .emp-tab-btn").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    currentStatusFilter = "all";
    const sf = document.getElementById("statusFilter");
    if (sf) sf.value = "all";
    const pageTitleEl = document.getElementById("pageTitle");
    if (pageTitleEl) pageTitleEl.textContent = tabConfig[currentTab].title;
    document.querySelectorAll(".admin-stat-card, .emp-stat-card").forEach(c => c.classList.remove("active"));
    const allCard = document.getElementById("card-all");
    if (allCard) allCard.classList.add("active");
    renderTab();
  });
});

document.querySelectorAll(".admin-stat-card, .emp-stat-card").forEach(card => {
  card.addEventListener("click", () => {
    currentStatusFilter = card.dataset.filter;
    const sf = document.getElementById("statusFilter");
    if (sf) sf.value = ["new","under_review","approved","rejected"].includes(currentStatusFilter)
      ? currentStatusFilter : "all";
    document.querySelectorAll(".admin-stat-card, .emp-stat-card").forEach(c => c.classList.remove("active"));
    card.classList.add("active");
    renderTab();
  });
});

const statusFilterEl = document.getElementById("statusFilter");
if (statusFilterEl) {
  statusFilterEl.addEventListener("change", e => {
    currentStatusFilter = e.target.value;
    document.querySelectorAll(".admin-stat-card, .emp-stat-card").forEach(c => c.classList.remove("active"));
    const matchCard = document.getElementById("card-" + currentStatusFilter);
    if (matchCard) matchCard.classList.add("active");
    renderTab();
  });
}

const searchInputEl = document.getElementById("searchInput");
if (searchInputEl) {
  let searchDebounce = null;
  searchInputEl.addEventListener("input", e => {
    searchQuery = e.target.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => renderTab(), 200);
  });
}

document.getElementById("spCloseBtn")?.addEventListener("click", closeSidePanel);
document.getElementById("spOverlay")?.addEventListener("click", closeSidePanel);
document.getElementById("spPrintBtn")?.addEventListener("click", printActiveStudent);

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "EmployeeLogin.html";
});

// ==================== Auth ====================

auth.authStateReady().then(() => {
  onAuthStateChanged(auth, async user => {
    if (!user) { window.location.replace("EmployeeLogin.html"); return; }

    try {
      const empSnap = await getDoc(doc(db, "employees", user.uid));
      if (!empSnap.exists()) { window.location.replace("EmployeeLogin.html"); return; }

      const empData = empSnap.data();
      if (empData.role !== "employee") { window.location.replace("EmployeeLogin.html"); return; }

      currentEmployee = { uid: user.uid, ...empData };
      isAffairs       = empData.department === "شؤون الطالبات";

      employeesCache[user.uid] = empData.fullName || "-";

      const empNameEl = document.getElementById("empName");
      const empDeptEl = document.getElementById("empDept");
      const empEmailEl = document.getElementById("empEmail");
      const pageTitleEl = document.getElementById("pageTitle");
      if (empNameEl) empNameEl.textContent = empData.fullName  || "-";
      if (empDeptEl) empDeptEl.textContent = empData.department || "-";
      if (empEmailEl) empEmailEl.textContent = empData.email || user.email || "-";
      if (pageTitleEl) pageTitleEl.textContent = tabConfig[currentTab].title;

      setDates();
      injectRejectModal();
      await loadAllData();

    } catch(err) {
      console.error("Auth error:", err);
      await signOut(auth);
      window.location.replace("EmployeeLogin.html");
    }
  });
});
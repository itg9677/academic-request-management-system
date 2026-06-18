import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, collection, query, where, getDocs,
  updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
const reqTypeClass   = { add: "b-add", drop: "b-drop", edit: "b-edit", remove: "b-drop", change: "b-edit" };
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
  { value: "section_closed", label: "الشعبة مغلقة"      },
  { value: "system_closed",  label: "تم اقفال النظام"   },
  { value: "no_contact",     label: "عدم تواصل الطالبة" },
  { value: "conflict",       label: "وجود تعارض"         },
  { value: "other",          label: "أخرى"               }
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

  try {
    const snap = await getDoc(doc(db, "students", uid));
    if (snap.exists()) {
      studentsCache[uid] = { _uid: uid, ...snap.data() };
      return studentsCache[uid];
    }
  } catch(e) {}

  try {
    const q = query(collection(db, "students"), where("studentId", "==", uid));
    const snap = await getDocs(q);
    if (!snap.empty) {
      studentsCache[uid] = { _uid: uid, ...snap.docs[0].data() };
      return studentsCache[uid];
    }
  } catch(e) {}

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

// ==================== تحميل البيانات (excuse + visit) ====================

async function loadExcuseAndVisit() {
  try {
    const excQuery = isAffairs
      ? query(collection(db, "excuses"))
      : query(collection(db, "excuses"),
              where("assignedDepartment", "==", currentEmployee.department));


    const [excSnap, visSnap] = await Promise.all([
      getDocs(excQuery),
      getDocs(collection(db, "visitRequests"))
    ]);

    tabData.excuse = excSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    tabData.visit  = visSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    updateBadges();
  } catch(err) {
    console.error("loadExcuseAndVisit error:", err);
  }
}

// ==================== onSnapshot للحذف والإضافة ====================

let unsubscribeAddDrop = null;

function subscribeAddDrop() {
  if (unsubscribeAddDrop) unsubscribeAddDrop();

  const types = ["add", "drop", "edit", "remove", "change"];
const q = isAffairs
  ? query(collection(db, "requests"))
  : query(
      collection(db, "requests"),
      where("requestType", "in", types),
      where("major", "==", currentEmployee.department)
    );

  unsubscribeAddDrop = onSnapshot(q, async (snap) => {
    // موظفة شؤون الطالبات تشوف كل طلبات كل الطالبات من كل الأقسام
    // (تماماً مثل موظفة القسم اللي تشوف كل طلبات طالبتها، تخصص ومشترك)
    // وصلاحية القبول/الرفض تتحدد لاحقاً حسب نوع المادة
    tabData.addDrop = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateBadges();
    if (currentTab === "addDrop") {
      await renderTab();
      if (activeRequest && activeRequest.tab === "addDrop") {
        const updated = tabData.addDrop.find(it => it.id === activeRequest.item.id);
        if (updated) openSidePanel("addDrop", updated);
      }
    }
  });
}

function updateBadges() {
  const el = (id) => document.getElementById(id);
  if (el("badge-addDrop")) el("badge-addDrop").textContent = tabData.addDrop.filter(r => getEffectiveStatus(r) === "new").length;
  if (el("badge-excuse"))  el("badge-excuse").textContent  = tabData.excuse.filter(r => getEffectiveStatus(r) === "new").length;
  if (el("badge-visit"))   el("badge-visit").textContent   = tabData.visit.filter(r => getEffectiveStatus(r) === "new").length;
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

// ==================== عرض الجدول ====================

async function renderTab() {
  const cfg   = tabConfig[currentTab];

  const loadingEl   = document.getElementById("loadingState");
  const tableWrapEl = document.getElementById("tableWrap");

  if (loadingEl)   loadingEl.style.display  = "";
  if (tableWrapEl) tableWrapEl.style.display = "none";

  // لو excuse أو visit نجلب من Firestore
  if (currentTab !== "addDrop") {
    await loadExcuseAndVisit();
  }

  const uniqueStudentUids = [...new Set(tabData[currentTab].map(it => it[cfg.studentField]).filter(Boolean))];
  await Promise.all(uniqueStudentUids.map(uid => getStudent(uid)));

  const uniqueEmpUids = [...new Set(tabData[currentTab].map(it => it.assignedEmployee).filter(Boolean))];
  await Promise.all(uniqueEmpUids.map(uid => getEmployeeName(uid)));

  let filtered = [...tabData[currentTab]];

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

  const byStudent = {};
  filtered.forEach(it => {
    const uid = it[cfg.studentField];
    if (!uid) return;
    if (!byStudent[uid]) byStudent[uid] = [];
    byStudent[uid].push(it);
  });
  // ترتيب طلبات كل طالب: الأحدث أولاً
  Object.keys(byStudent).forEach(uid => {
    byStudent[uid].sort((a, b) => {
      const aTime = a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
      const bTime = b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
      return bTime - aTime;
    });
  });

  // ترتيب الطلاب: الحالة الأسوأ أولاً (جديد > قيد المراجعة > مقبول/مرفوض)، ثم الأحدث أولاً
  const priority = { new: 0, under_review: 1, approved: 2, rejected: 2 };
  const sortedUids = Object.keys(byStudent).sort((a, b) => {
    const worstA = Math.min(...byStudent[a].map(r => priority[getEffectiveStatus(r)] ?? 4));
    const worstB = Math.min(...byStudent[b].map(r => priority[getEffectiveStatus(r)] ?? 4));
    if (worstA !== worstB) return worstA - worstB;

    const latestA = Math.max(...byStudent[a].map(r => r.updatedAt?.toMillis?.() ?? r.createdAt?.toMillis?.() ?? 0));
    const latestB = Math.max(...byStudent[b].map(r => r.updatedAt?.toMillis?.() ?? r.createdAt?.toMillis?.() ?? 0));
    return latestB - latestA;
  });

  if (loadingEl)   loadingEl.style.display  = "none";
  if (tableWrapEl) tableWrapEl.style.display = "";

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
    if (item.requestedSection) {
      rows += `<tr><td class="sp-detail-label">الشعبة المطلوبة</td><td>${esc(item.requestedSection)}</td></tr>`;
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
 const others = tabData[tab]
  .filter(
    it => it.id !== item.id &&
    it[cfg.studentField] === item[cfg.studentField]
  )
  .sort((a, b) => {
    const aTime = a.createdAt?.toMillis?.() ?? 0;
    const bTime = b.createdAt?.toMillis?.() ?? 0;

    return bTime - aTime;
  });
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
      <tr class="sp-other-row sp-other-clickable" data-id="${o.id}" style="cursor:pointer;">
        <td>${label}</td>
        <td><span class="status-badge s-${sk}">${statusLabel[sk] || sk}</span></td>
        <td>${formatDate(o.createdAt)}</td>
        <td style="color:var(--navy);font-size:0.85rem;">عرض ←</td>
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
  const isSharedCourse = item.assignedDepartment?.trim() === "شؤون الطالبات";
  const hasDeptField   = typeof item.assignedDepartment === "string";

  // لو الطلب ما فيه معلومة قسم (أعذار/زيارات) تبقى الصلاحية كاملة كالسابق.
  // ولو فيه (طلبات حذف/إضافة): موظفة الشؤون تتصرف بالمواد المشتركة فقط،
  // وموظفة القسم تتصرف بمواد قسمها فقط (غير المشتركة).
  const canApproveReject = hasDeptField
    ? (isAffairs ? isSharedCourse : !isSharedCourse)
    : true;

  document.getElementById("spTitle").textContent = student.fullName || "تفاصيل الطالب";
  document.getElementById("spSub").textContent   = cfg.title;

  const allStudentRows = buildStudentAllFields(student);

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


${(sk === "approved" || sk === "rejected") ? `

<div class="sp-status-final">
  <span class="status-badge s-${sk}">
    ${statusLabel[sk]}
  </span>
</div>

` : canApproveReject ? `

<button class="sp-action-btn sp-approve"
        data-action="approved">
  <i class="ti ti-circle-check"></i>
  قبول
</button>

<button class="sp-action-btn sp-review"
        data-action="under_review"
        ${sk === "under_review" ? "disabled" : ""}>
  <i class="ti ti-loader-2"></i>
  قيد المراجعة
</button>

<button class="sp-action-btn sp-reject"
        data-action="rejected">
  <i class="ti ti-circle-x"></i>
  رفض
</button>

` : `

<button class="sp-action-btn sp-review"
        data-action="under_review"
        ${sk === "under_review" ? "disabled" : ""}>
  <i class="ti ti-loader-2"></i>
  قيد المراجعة
</button>

<div style="
margin-top:10px;
font-size:.85rem;
color:#888;">
${isAffairs ? "هذه المادة تابعة لقسم آخر، وليست من مواد شؤون الطالبات" : "هذه المادة تابعة لشؤون الطالبات"}
</div>

`}

    ${buildOtherRequestsTable(tab, item)}
  `;

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
}

function closeSidePanel() {
  document.getElementById("sidePanel").classList.remove("open");
  document.getElementById("spOverlay").classList.remove("show");
  activeRequest = null;
}

async function updateRequestStatus(tab, item, newStatus, rejectReason) {
  const isSharedCourse = item.assignedDepartment?.trim() === "شؤون الطالبات";
  const hasDeptField   = typeof item.assignedDepartment === "string";
  const canApproveReject = hasDeptField
    ? (isAffairs ? isSharedCourse : !isSharedCourse)
    : true;

  if (!canApproveReject && newStatus !== "under_review") {
    alert(isAffairs
      ? "ليس لديك صلاحية اعتماد أو رفض مواد الأقسام الأخرى"
      : "لا يمكن اعتماد أو رفض مواد شؤون الطالبات");
    return;
  }
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

    // تحديث الكاش المحلي فوراً
    item.status               = newStatus;
    item.assignedEmployee     = currentEmployee.uid;
    item.assignedEmployeeName = currentEmployee.fullName || "-";
    if (rejectReason) item.rejectReason = rejectReason;

    employeesCache[currentEmployee.uid] = currentEmployee.fullName || "-";

    // للأعذار والزيارة: نحدث يدوياً لأنها ليست onSnapshot
    if (tab !== "addDrop") {
      const idx = tabData[tab].findIndex(it => it.id === item.id);
      if (idx !== -1) tabData[tab][idx] = { ...tabData[tab][idx], ...item };
      updateBadges();
      await renderTab();
      openSidePanel(tab, item);
    }
    // للحذف والإضافة: onSnapshot سيتكفل بالتحديث تلقائياً
  } catch(err) {
    console.error(err);
    alert("حدث خطأ: " + err.message);
    buttons.forEach(b => b.disabled = false);
  }
}

// ==================== مودال الرفض ====================

function injectRejectModal() {
  if (document.getElementById("rejectModal")) return;
  const modal = document.createElement("div");
  modal.id = "rejectModal";
  modal.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;align-items:center;justify-content:center;";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:28px 24px;min-width:320px;max-width:420px;width:90%;direction:rtl;box-shadow:0 8px 32px rgba(0,0,0,.18);">
      <div style="font-size:1.1rem;font-weight:700;color:#1a2d5a;margin-bottom:18px;">سبب الرفض</div>
      <div id="rejectReasonList" style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
        ${REJECT_REASONS.map(r => `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.95rem;">
            <input type="radio" name="rejectReason" value="${r.value}" style="accent-color:#c9a84c;width:16px;height:16px;">
            ${r.label}
          </label>`).join("")}
      </div>
      <div id="rejectOtherWrap" style="display:none;margin-bottom:14px;">
        <textarea id="rejectOtherText" placeholder="اكتب سبب الرفض..." rows="3"
          style="width:100%;border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-family:inherit;font-size:0.9rem;resize:vertical;box-sizing:border-box;"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="rejectCancelBtn"  style="padding:8px 20px;border:1px solid #ddd;border-radius:8px;background:#f5f5f5;cursor:pointer;font-family:inherit;">إلغاء</button>
        <button id="rejectConfirmBtn" style="padding:8px 20px;border:none;border-radius:8px;background:#dc2626;color:#fff;cursor:pointer;font-weight:700;font-family:inherit;">تأكيد الرفض</button>
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
    headerCols = "<th>نوع الطلب</th><th>المقرر</th><th>الشعبة المطلوبة</th><th>ملاحظات</th><th>الحالة</th><th>الموظف المعالج</th><th>التاريخ</th>";
    rows = items.map(r => {
      const en = r.assignedEmployeeName || (r.assignedEmployee ? (employeesCache[r.assignedEmployee] || "-") : "-");
      const rejectNote = (r.status === "rejected" && r.rejectReason)
        ? `<br><small style="color:#dc2626;">«${r.rejectReason}»</small>` : "";
      return `<tr>
        <td>${reqTypeLabel[r.requestType] || r.requestType || "-"}</td>
        <td>${esc(r.courseName || "")} (${esc(r.courseCode || "")})</td>
        <td>${r.requestedSection ? esc(r.requestedSection) : "-"}</td>
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
    headerCols = "<th>نوع الزيارة</th><th>المستوى</th><th>المقر</th><th>السبب</th><th>المقررات</th><th>الحالة</th><th>الموظف</th><th>التاريخ</th>";
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
    h2{color:#1a2d5a;border-bottom:3px solid #c9a84c;padding-bottom:8px;}
    h3{color:#1a2d5a;margin-top:24px;}
    .info-table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px;}
    .info-table td{padding:7px 12px;border-bottom:1px solid #e0e0e0;}
    .label-col{width:35%;color:#555;font-weight:bold;}
    table.req-table{width:100%;border-collapse:collapse;margin-top:20px;font-size:13px;}
    th{background:#1a2d5a;color:white;padding:9px 12px;text-align:right;}
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

// تبديل التابات (السايدبار)
document.querySelectorAll(".emp-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll(".emp-tab-btn").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    currentStatusFilter = "all";
    const pageTitleEl = document.getElementById("pageTitle");
    if (pageTitleEl) pageTitleEl.textContent = tabConfig[currentTab].title;
    document.querySelectorAll(".admin-stat-card").forEach(c => c.classList.remove("active"));
    const allCard = document.getElementById("card-all");
    if (allCard) allCard.classList.add("active");
    renderTab();
  });
});

// فلترة بالبطاقات
document.querySelectorAll(".admin-stat-card").forEach(card => {
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

// البحث
const searchInputEl = document.getElementById("searchInput");
if (searchInputEl) {
  let searchDebounce = null;
  searchInputEl.addEventListener("input", e => {
    searchQuery = e.target.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => renderTab(), 200);
  });
}

// إغلاق اللوحة الجانبية
document.getElementById("spCloseBtn")?.addEventListener("click", closeSidePanel);
document.getElementById("spOverlay")?.addEventListener("click", closeSidePanel);
document.getElementById("spPrintBtn")?.addEventListener("click", printActiveStudent);

// تسجيل الخروج
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
      isAffairs       = (empData.department || "").trim() === "شؤون الطالبات";

      employeesCache[user.uid] = empData.fullName || "-";

      // تحديث الواجهة
      const empName    = empData.fullName   || "-";
      const empDept    = empData.department || "-";
      const empEmail   = empData.email || user.email || "-";

      // السايدبار
      const elName  = document.getElementById("empName");
      const elDept  = document.getElementById("empDept");
      const elEmail = document.getElementById("empEmail");
      if (elName)  elName.textContent  = empName;
      if (elDept)  elDept.textContent  = empDept;
      if (elEmail) elEmail.textContent = empEmail;

      // قسم الترحيب
      const elWelcomeName = document.getElementById("empNameWelcome");
      const elWelcomeDept = document.getElementById("empDeptWelcome");
      if (elWelcomeName) elWelcomeName.textContent = empName;
      if (elWelcomeDept) elWelcomeDept.textContent = `كلية العلوم - ${empDept}`;

      const pageTitleEl = document.getElementById("pageTitle");
      if (pageTitleEl) pageTitleEl.textContent = tabConfig[currentTab].title;

      setDates();
      injectRejectModal();

      // تحميل الأعذار والزيارات مرة واحدة
      await loadExcuseAndVisit();

      // الاشتراك في onSnapshot للحذف والإضافة
      subscribeAddDrop();

    } catch(err) {
      console.error("Auth error:", err);
      await signOut(auth);
      window.location.replace("EmployeeLogin.html");
    }
  });
});
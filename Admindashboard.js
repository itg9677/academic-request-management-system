import { auth, db, storage } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs,
  updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

console.log("FILE LOADED");

// ==================== State ====================

let currentAdminData = null;

const studentsCache  = {};
const employeesCache = {};

const tabData = { addDrop: [], excuse: [], visit: [] };

let currentTab          = "addDrop";
let currentStatusFilter = "all";
let currentDeptFilter   = "all";
let searchQuery         = "";
let activeRequest       = null;

// ==================== أدوات مساعدة ====================

function setDates() {
  const now = new Date();
  const days = ["الاحد","الاثنين","الثلاثاء","الاربعاء","الخميس","الجمعة","السبت"];
  const greg = days[now.getDay()] + "، " + now.toLocaleDateString("ar-SA-u-ca-gregory");
  const hijri = now.toLocaleDateString("ar-SA-u-ca-islamic");
  document.getElementById("gregDate").textContent = greg;
  document.getElementById("hijriDate").textContent = hijri;
}

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
  } catch (e) {
    return "-";
  }
}

// تحويل أي قيمة من فايرستور إلى نص قابل للعرض
function formatFieldValue(value) {
  if (value === null || value === undefined) return "-";
  if (value && typeof value.toDate === "function") {
    return value.toDate().toLocaleDateString("ar-SA-u-ca-gregory");
  }
  if (Array.isArray(value)) {
    if (!value.length) return "-";
    return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join("، ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

// ترجمة أسماء الحقول
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

// حقول تقنية لا تُعرض
const hiddenFields = ["_uid", "password", "token", "fcmToken", "pushToken", "deviceId", "emailVerified", "role", "createdAt"];

const statusLabel = {
  new:          "جديد",
  under_review: "قيد المراجعة",
  approved:     "مقبول",
  rejected:     "مرفوض"
};

const reqTypeLabel   = { add: "اضافة", drop: "حذف", edit: "تعديل شعبة" };
const visitTypeLabel = { internal: "داخلية", external: "خارجية" };
const examTypeLabel  = { midterm1: "اختبار فصلي أول", midterm2: "اختبار فصلي ثاني", final: "اختبار نهائي" };
const levelLabel     = {
  "1": "المستوى الأول", "2": "المستوى الثاني", "3": "المستوى الثالث", "4": "المستوى الرابع",
  "5": "المستوى الخامس", "6": "المستوى السادس", "7": "المستوى السابع", "8": "المستوى الثامن"
};

const tabConfig = {
  addDrop: { collectionName: "requests",      studentField: "studentUid", title: "طلبات الحذف والإضافة" },
  excuse:  { collectionName: "excuses",       studentField: "uid", title: "طلبات رفع الأعذار"   },
  visit:   { collectionName: "visitRequests", studentField: "uid",        title: "طلبات الزيارة"       }
};

// ==================== جلب بيانات الطالب (جميع الحقول) ====================

async function getStudent(uid) {
  if (!uid) return null;
  if (studentsCache[uid]) return studentsCache[uid];
  try {
    const snap = await getDoc(doc(db, "students", uid));
    studentsCache[uid] = snap.exists()
      ? { _uid: uid, ...snap.data() }
      : { _uid: uid, fullName: "-", studentId: "-", email: "-", major: "-" };
  } catch (e) {
    studentsCache[uid] = { _uid: uid, fullName: "-", studentId: "-", email: "-", major: "-" };
  }
  return studentsCache[uid];
}

async function getEmployeeName(uid) {
  if (!uid) return null;
  if (employeesCache[uid]) return employeesCache[uid];
  try {
    const snap = await getDoc(doc(db, "employees", uid));
    employeesCache[uid] = snap.exists() ? (snap.data().fullName || "-") : "-";
  } catch (e) {
    employeesCache[uid] = "-";
  }
  return employeesCache[uid];
}

function getReqDepartment(item, student) {
  return item.assignedDepartment || (student && student.major) || null;
}

// ==================== بناء صفوف بيانات الطالب (كل الحقول الموجودة فعلاً) ====================

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

// ==================== تحميل البيانات ====================

async function loadAllData() {
  const loadingEl   = document.getElementById("loadingState");
  const tableWrapEl = document.getElementById("tableWrap");

  loadingEl.style.display  = "";
  tableWrapEl.style.display = "none";

  try {
 
    const reqQuery = query(
      collection(db, "requests"),
      where("requestType", "in", ["add", "drop", "edit"])
    );

    const [reqSnap, excSnap, visSnap] = await Promise.all([
      getDocs(reqQuery),
      getDocs(collection(db, "excuses")),
      getDocs(collection(db, "visitRequests"))
    ]);

    tabData.addDrop = reqSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    tabData.excuse  = excSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    tabData.visit   = visSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    updateBadges();
  } catch (err) {
    console.error("loadAllData error:", err);
  } finally {
    loadingEl.style.display  = "none";
    tableWrapEl.style.display = "";
  }

  await renderTab();
}

function updateBadges() {
  document.getElementById("badge-addDrop").textContent = tabData.addDrop.filter((r) => r.status === "pending").length;
  document.getElementById("badge-excuse").textContent  = tabData.excuse.filter((r) => r.status === "pending").length;
  document.getElementById("badge-visit").textContent   = tabData.visit.filter((r) => r.status === "pending").length;
}

function updateStatCards() {
  const items = tabData[currentTab];
  const newCount         = items.filter((r) => getEffectiveStatus(r) === "new").length;
  const underReviewCount = items.filter((r) => getEffectiveStatus(r) === "under_review").length;
  const approvedCount    = items.filter((r) => r.status === "approved").length;
  const rejectedCount    = items.filter((r) => r.status === "rejected").length;

  const elNew         = document.getElementById("cnt-new");
  const elUnderReview = document.getElementById("cnt-under_review");
  const elApproved    = document.getElementById("cnt-approved");
  const elRejected    = document.getElementById("cnt-rejected");
  const elAll         = document.getElementById("cnt-all");

  if (elNew)         elNew.textContent         = newCount;
  if (elUnderReview)  elUnderReview.textContent = underReviewCount;
  if (elApproved)     elApproved.textContent    = approvedCount;
  if (elRejected)     elRejected.textContent    = rejectedCount;
  if (elAll)          elAll.textContent         = items.length;
}

// ==================== عرض الجدول الرئيسي ====================

// حالة "جديد" = طلب pending ما عنده assignedEmployee بعد
// حالة "قيد المراجعة" = طلب pending وله موظف معالج (دمج معلق مع قيد المراجعة)
function getEffectiveStatus(item) {
  if (item.status === "new") return "new";
  if (item.status === "pending" || !item.status) {
    return item.assignedEmployee ? "under_review" : "new";
  }
  return item.status;
}

async function renderTab() {
  const cfg   = tabConfig[currentTab];
  const items = tabData[currentTab];

  const uniqueStudentUids = [...new Set(items.map((it) => it[cfg.studentField]).filter(Boolean))];
  await Promise.all(uniqueStudentUids.map((uid) => getStudent(uid)));

  const uniqueEmpUids = [...new Set(items.map((it) => it.assignedEmployee).filter(Boolean))];
  await Promise.all(uniqueEmpUids.map((uid) => getEmployeeName(uid)));

  let filtered = items.filter((it) => {
    if (currentDeptFilter === "all") return true;
    const student = studentsCache[it[cfg.studentField]] || {};
    return getReqDepartment(it, student) === currentDeptFilter;
  });

  updateStatCards();

  if (currentStatusFilter !== "all") {
    filtered = filtered.filter((it) => getEffectiveStatus(it) === currentStatusFilter);
  }

  const q = searchQuery.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter((it) => {
      const student = studentsCache[it[cfg.studentField]] || {};
      const name = (student.fullName || "").toLowerCase();
      const uid  = String(student.studentId || "").toLowerCase();
      return name.includes(q) || uid.includes(q);
    });
  }

  // تجميع الطلبات بالطالب
  const byStudent = {};
  filtered.forEach((it) => {
    const uid = it[cfg.studentField];
    if (!uid) return;
    if (!byStudent[uid]) byStudent[uid] = [];
    byStudent[uid].push(it);
  });

  // ترتيب: الطلاب الذين لديهم طلبات معلقة/جديدة أولاً
  const sortedUids = Object.keys(byStudent).sort((a, b) => {
    const worstA = byStudent[a].some(r => getEffectiveStatus(r) === "new" || getEffectiveStatus(r) === "under_review") ? 0 : 1;
    const worstB = byStudent[b].some(r => getEffectiveStatus(r) === "new" || getEffectiveStatus(r) === "under_review") ? 0 : 1;
    if (worstA !== worstB) return worstA - worstB;
    const ta = byStudent[a][0].createdAt && byStudent[a][0].createdAt.toMillis ? byStudent[a][0].createdAt.toMillis() : 0;
    const tb = byStudent[b][0].createdAt && byStudent[b][0].createdAt.toMillis ? byStudent[b][0].createdAt.toMillis() : 0;
    return ta - tb;
  });

  const tbody      = document.getElementById("mainTbody");
  const emptyState = document.getElementById("emptyState");
  tbody.innerHTML  = "";

  if (!sortedUids.length) {
    emptyState.style.display = "";
  } else {
    emptyState.style.display = "none";
    sortedUids.forEach((uid) => {
      const studentRequests = byStudent[uid];
      tbody.appendChild(buildRow(currentTab, uid, studentRequests));
    });
  }

  const tableTitleEl = document.getElementById("tableTitle");
  if (tableTitleEl) tableTitleEl.textContent = cfg.title;

  const infoBar = document.getElementById("searchInfoBar");
  if (q) {
    infoBar.style.display = "";
    infoBar.textContent   = `نتائج البحث عن "${searchQuery.trim()}": ${sortedUids.length} طالب`;
  } else {
    infoBar.style.display = "none";
  }
}

function buildRow(tab, studentUid, requests) {
  const cfg     = tabConfig[tab];
  const student = studentsCache[studentUid] || {};
  const tr      = document.createElement("tr");
  tr.dataset.tab = tab;
  tr.dataset.uid = studentUid;

  const initials = (student.fullName || "??").slice(0, 2);
  const dept     = requests[0]?.assignedDepartment || student.major || "-";

  // الحالة الأسوأ: جديد > قيد المراجعة > مقبول/مرفوض
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
    <td class="uid-cell">${esc(student.studentId || "-")}</td>
    <td><span class="dept-chip">${esc(dept)}</span></td>
    <td><span class="req-count-badge">${requests.length}</span></td>
    <td><button class="detail-btn">التفاصيل <i class="ti ti-chevron-left detail-chevron"></i></button></td>
  `;

  // فتح اللوحة بأول طلب (الأعلى أولوية)
  tr.addEventListener("click", () => openSidePanel(tab, worstItem));
  return tr;
}

// ==================== اللوحة الجانبية ====================

function buildDetailRows(tab, item) {
  const statusKey  = getEffectiveStatus(item);
  const statusHtml = `<span class="status-badge s-${statusKey}">${statusLabel[statusKey] || statusKey}</span>`;

  if (tab === "addDrop") {
    const empName = item.assignedEmployee ? (employeesCache[item.assignedEmployee] || "-") : "-";
    const rejectRow = (item.status === "rejected" && item.rejectReason)
      ? `<tr><td class="sp-detail-label">سبب الرفض</td><td><span class="sp-reject-reason">${esc(item.rejectReason)}</span></td></tr>` : "";
    let rows = `
      <tr><td class="sp-detail-label">نوع الطلب</td><td>${reqTypeLabel[item.requestType] || item.requestType || "-"}</td></tr>
      <tr><td class="sp-detail-label">المقرر</td><td>${esc(item.courseName || "-")} (${esc(item.courseCode || "-")})</td></tr>
    `;
    if (item.requestType === "edit") {
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
    const empName = item.assignedEmployee ? (employeesCache[item.assignedEmployee] || "-") : "-";
    const attach = item.attachmentUrl
      ? `<a href="${esc(item.attachmentUrl)}" target="_blank" rel="noopener">تحميل المرفق</a>`
      : "لا يوجد";
    const rejectRow = (item.status === "rejected" && item.rejectReason)
      ? `<tr><td class="sp-detail-label">سبب الرفض</td><td><span class="sp-reject-reason">${esc(item.rejectReason)}</span></td></tr>` : "";
    return `
      <tr><td class="sp-detail-label">رمز المقرر</td><td>${esc(item.courseCode || "-")}</td></tr>
      <tr><td class="sp-detail-label">نوع الاختبار</td><td><strong>${examTypeLabel[item.examType] || esc(item.examType || "-")}</strong></td></tr>
      <tr><td class="sp-detail-label">تاريخ الاختبار</td><td>${esc(item.examDate || "-")}</td></tr>
      <tr><td class="sp-detail-label">سبب الغياب</td><td>${esc(item.reason || item.notes || "-")}</td></tr>
      <tr><td class="sp-detail-label">المرفق</td><td>${attach}</td></tr>
      <tr><td class="sp-detail-label">تاريخ الطلب</td><td>${formatDate(item.createdAt)}</td></tr>
      <tr><td class="sp-detail-label">الحالة</td><td>${statusHtml}</td></tr>
      <tr><td class="sp-detail-label">الموظف المعالج</td><td>${esc(empName)}</td></tr>
      ${rejectRow}
    `;
  }

  // visit
  const empNameVisit = item.assignedEmployee ? (employeesCache[item.assignedEmployee] || "-") : "-";
  const rejectRowVisit = (item.status === "rejected" && item.rejectReason)
    ? `<tr><td class="sp-detail-label">سبب الرفض</td><td><span class="sp-reject-reason">${esc(item.rejectReason)}</span></td></tr>` : "";
  const courses = (item.courses || [])
    .map((c) => `${esc(c.courseName || "-")} (${esc(c.courseCode || "-")}) — الشعبة: ${esc(c.section || "-")}`)
    .join("<br>") || "-";

  return `
    <tr><td class="sp-detail-label">نوع الزيارة</td><td>${visitTypeLabel[item.visitType] || item.visitType || "-"}</td></tr>
    <tr><td class="sp-detail-label">المستوى الدراسي</td><td>${levelLabel[item.level] || esc(item.level || "-")}</td></tr>
    <tr><td class="sp-detail-label">المقر المراد زيارته</td><td>${esc(item.visitPlace || "-")}</td></tr>
    <tr><td class="sp-detail-label">سبب الزيارة</td><td>${esc(item.reason || "-")}</td></tr>
    <tr><td class="sp-detail-label">المقررات</td><td>${courses}</td></tr>
    <tr><td class="sp-detail-label">تاريخ الطلب</td><td>${formatDate(item.createdAt)}</td></tr>
    <tr><td class="sp-detail-label">الحالة</td><td>${statusHtml}</td></tr>
    <tr><td class="sp-detail-label">الموظف المعالج</td><td>${esc(empNameVisit)}</td></tr>
    ${rejectRowVisit}
  `;
}

function buildOtherRequestsTable(tab, item) {
  const cfg    = tabConfig[tab];
  const others = tabData[tab].filter(
    (it) => it.id !== item.id && it[cfg.studentField] === item[cfg.studentField]
  );

  if (!others.length) return "";

  const rows = others.map((o) => {
    let label = "-";
    if (tab === "addDrop") label = `${reqTypeLabel[o.requestType] || o.requestType || "-"} — ${esc(o.courseName || o.courseCode || "")}`;
    else if (tab === "excuse") label = `${esc(o.courseCode || "-")} — ${examTypeLabel[o.examType] || esc(o.examType || "-")}`;
    else label = visitTypeLabel[o.visitType] || o.visitType || "-";

    const statusKey = getEffectiveStatus(o);
    return `
      <tr class="sp-other-row sp-other-clickable" data-id="${o.id}" style="cursor:pointer;" title="انقر لعرض تفاصيل هذا الطلب">
        <td>${label}</td>
        <td><span class="status-badge s-${statusKey}">${statusLabel[statusKey] || statusKey}</span></td>
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
  document.querySelectorAll(".sp-other-clickable").forEach((row) => {
    row.addEventListener("click", () => {
      const id  = row.dataset.id;
      const cfg = tabConfig[tab];
      const found = tabData[tab].find((it) => it.id === id);
      if (found) openSidePanel(tab, found);
    });
  });
}

function openSidePanel(tab, item) {
  activeRequest = { tab, item };
  const cfg       = tabConfig[tab];
  const student   = studentsCache[item[cfg.studentField]] || {};
  const statusKey = getEffectiveStatus(item);

  document.getElementById("spTitle").textContent = student.fullName || "تفاصيل الطالب";
  document.getElementById("spSub").textContent   = cfg.title;

  // جميع حقول الطالب الموجودة فعلاً في فايرستور
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
        <table class="sp-detail-table">
          ${allStudentRows}
        </table>
      </div>
    </div>

    <div class="sp-section-title">تفاصيل الطلب</div>
    <div class="sp-detail-card">
      <table class="sp-detail-table">${buildDetailRows(tab, item)}</table>
    </div>

    <div class="sp-actions">
      <button class="sp-action-btn sp-approve" data-action="approved" ${statusKey === "approved" ? "disabled" : ""}>
        <i class="ti ti-circle-check"></i> قبول
      </button>
      <button class="sp-action-btn sp-review" data-action="under_review" ${statusKey === "under_review" ? "disabled" : ""}>
        <i class="ti ti-loader-2"></i> قيد المراجعة
      </button>
      <button class="sp-action-btn sp-reject" data-action="rejected" ${statusKey === "rejected" ? "disabled" : ""}>
        <i class="ti ti-circle-x"></i> رفض
      </button>
    </div>

    ${buildOtherRequestsTable(tab, item)}
  `;

  document.getElementById("spBody").querySelectorAll(".sp-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => updateRequestStatus(tab, item, btn.dataset.action));
  });

  attachOtherRowsListeners(tab);

  document.getElementById("sidePanel").classList.add("open");
  document.getElementById("spOverlay").classList.add("show");
  document.querySelector(".admin-main").classList.add("panel-open");
}

function closeSidePanel() {
  document.getElementById("sidePanel").classList.remove("open");
  document.getElementById("spOverlay").classList.remove("show");
  document.querySelector(".admin-main").classList.remove("panel-open");
  activeRequest = null;
}

async function updateRequestStatus(tab, item, newStatus) {
  const cfg     = tabConfig[tab];
  const buttons = document.querySelectorAll("#spBody .sp-action-btn");
  buttons.forEach((b) => (b.disabled = true));

  try {
    await updateDoc(doc(db, cfg.collectionName, item.id), {
      status:           newStatus,
      assignedEmployee: currentAdminData.docId,
      updatedAt:        serverTimestamp()
    });

    item.status           = newStatus;
    item.assignedEmployee = currentAdminData.docId;
    employeesCache[currentAdminData.docId] = currentAdminData.fullName || "الأدمن";

    updateBadges();
    await renderTab();
    openSidePanel(tab, item);
  } catch (err) {
    console.error(err);
    alert("حدث خطأ: " + err.message);
    buttons.forEach((b) => (b.disabled = false));
  }
}

// ==================== الطباعة ====================

function printActiveStudent() {
  if (!activeRequest) return;
  const { tab, item } = activeRequest;
  const cfg     = tabConfig[tab];
  const student = studentsCache[item[cfg.studentField]] || {};
  const items   = tabData[tab].filter((it) => it[cfg.studentField] === item[cfg.studentField]);

  // صفوف بيانات الطالب كاملة للطباعة
  const studentInfoRows = Object.entries(student)
    .filter(([key]) => !hiddenFields.includes(key))
    .map(([key, value]) => {
      const label        = fieldLabels[key] || key;
      const displayValue = formatFieldValue(value);
      return `<tr>
        <td class="label-col">${esc(label)}</td>
        <td>${esc(displayValue)}</td>
      </tr>`;
    })
    .join("");

  let headerCols = "";
  let rows       = "";

  if (tab === "addDrop") {
    headerCols = "<th>نوع الطلب</th><th>المقرر</th><th>الشعبة المطلوبة</th><th>ملاحظات الطالب</th><th>الحالة</th><th>الموظف المعالج</th><th>التاريخ</th>";
    rows = items.map((r) => {
      const empName    = r.assignedEmployee ? (employeesCache[r.assignedEmployee] || "-") : "-";
      const rejectNote = (r.status === "rejected" && r.rejectReason)
        ? `<br><small style="color:#c0392b;">«${r.rejectReason}»</small>` : "";
      return `
      <tr>
        <td>${reqTypeLabel[r.requestType] || r.requestType || "-"}</td>
        <td>${esc(r.courseName || "")} (${esc(r.courseCode || "")})</td>
        <td>${r.requestType === "edit" ? esc(r.requestedSection || "-") : "-"}</td>
        <td>${esc(r.notes || "-")}</td>
        <td>${statusLabel[getEffectiveStatus(r)] || getEffectiveStatus(r)}${rejectNote}</td>
        <td>${esc(empName)}</td>
        <td>${formatDate(r.createdAt)}</td>
      </tr>
      `;
    }).join("");
  } else if (tab === "excuse") {
    headerCols = "<th>رمز المقرر</th><th>نوع الاختبار</th><th>تاريخ الاختبار</th><th>سبب الغياب</th><th>الحالة</th><th>التاريخ</th>";
    rows = items.map((r) => `
      <tr>
        <td>${esc(r.courseCode || "-")}</td>
        <td><strong>${examTypeLabel[r.examType] || esc(r.examType || "-")}</strong></td>
        <td>${esc(r.examDate || "-")}</td>
        <td>${esc(r.reason || r.notes || "-")}</td>
        <td>${statusLabel[getEffectiveStatus(r)] || getEffectiveStatus(r)}</td>
        <td>${formatDate(r.createdAt)}</td>
      </tr>
    `).join("");
  } else {
    headerCols = "<th>نوع الزيارة</th><th>المستوى</th><th>المقر</th><th>سبب الزيارة</th><th>المقررات</th><th>الحالة</th><th>التاريخ</th>";
    rows = items.map((r) => `
      <tr>
        <td>${visitTypeLabel[r.visitType] || r.visitType || "-"}</td>
        <td>${levelLabel[r.level] || esc(r.level || "-")}</td>
        <td>${esc(r.visitPlace || "-")}</td>
        <td>${esc(r.reason || "-")}</td>
        <td>${(r.courses || []).map((c) =>
          `${esc(c.courseName || "-")} (${esc(c.courseCode || "-")}) - ${esc(c.section || "-")}`
        ).join("<br>") || "-"}</td>
        <td>${statusLabel[getEffectiveStatus(r)] || getEffectiveStatus(r)}</td>
        <td>${formatDate(r.createdAt)}</td>
      </tr>
    `).join("");
  }

  const styleBlock = `
    body { font-family: Arial, sans-serif; padding: 30px; direction: rtl; }
    h2   { color: #1a3a6b; border-bottom: 3px solid #c8972b; padding-bottom: 8px; }
    h3   { color: #1a3a6b; margin-top: 24px; }
    .info-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; }
    .info-table td { padding: 7px 12px; border-bottom: 1px solid #e0e0e0; }
    .label-col  { width: 35%; color: #555; font-weight: bold; }
    table.req-table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
    th { background: #1a3a6b; color: white; padding: 9px 12px; text-align: right; }
    td { padding: 9px 12px; border-bottom: 1px solid #e0e0e0; }
    tr:last-child td { border-bottom: none; }
    .footer { margin-top: 30px; font-size: 12px; color: #888; }
    .reject-reason { color: #c0392b; font-size: 0.85em; }
  `;

  const printHTML = `
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
        طُبع بواسطة: ${esc(currentAdminData.fullName || "الأدمن")} — مدير النظام
        &nbsp;|&nbsp; ${new Date().toLocaleDateString("ar-SA")}
      </div>
    </body></html>
  `;

  const win = window.open("", "_blank");
  win.document.write(printHTML);
  win.document.close();
  win.print();
}

// ==================== رفع/عرض نموذج الزيارة (PDF) - متاح فقط داخل تبويب الزيارة ====================

const VISIT_FORM_STORAGE_PATH = "visitForms/visit_form.pdf";
const visitFormDocRef = () => doc(db, "settings", "visitForm");

async function loadVisitFormInfo() {
  const nameEl = document.getElementById("uploadedFileName");
  if (!nameEl) return;

  nameEl.innerHTML = `<span style="color:#888;font-size:0.85rem;">جاري التحقق من الملف...</span>`;

  try {
    const snap = await getDoc(visitFormDocRef());
    if (snap.exists()) {
      const data = snap.data();
      nameEl.innerHTML = `
        <span style="display:inline-flex;align-items:center;gap:6px;background:#eef3ff;color:#1a3a6b;border:1px solid #c7d6f5;border-radius:8px;padding:5px 10px;font-size:0.85rem;">
          <i class="ti ti-file-type-pdf" style="color:#c0392b;"></i>
          <span>${esc(data.fileName || "نموذج_الزيارة.pdf")}</span>
          <button type="button" id="removeVisitFileBtn" title="حذف الملف" style="border:none;background:transparent;color:#c0392b;cursor:pointer;display:flex;align-items:center;padding:0;margin-right:2px;">
            <i class="ti ti-trash"></i>
          </button>
        </span>
      `;
      const removeBtn = document.getElementById("removeVisitFileBtn");
      if (removeBtn) removeBtn.addEventListener("click", removeVisitForm);
    } else {
      nameEl.innerHTML = `<span style="color:#888;font-size:0.85rem;">لا يوجد ملف مرفوع حالياً</span>`;
    }
  } catch (err) {
    console.error("loadVisitFormInfo error:", err);
    nameEl.innerHTML = `<span style="color:#c0392b;font-size:0.85rem;">تعذر تحميل بيانات الملف</span>`;
  }
}

async function uploadVisitForm(file) {
  const nameEl = document.getElementById("uploadedFileName");

  if (file.type !== "application/pdf") {
    alert("يجب أن يكون الملف بصيغة PDF فقط");
    return;
  }

  const maxSizeMB = 10;
  if (file.size > maxSizeMB * 1024 * 1024) {
    alert(`حجم الملف يجب ألا يتجاوز ${maxSizeMB} ميجابايت`);
    return;
  }

  if (nameEl) nameEl.innerHTML = `<span style="color:#1a3a6b;font-size:0.85rem;">جاري رفع الملف...</span>`;

  try {
    const storageRef = ref(storage, VISIT_FORM_STORAGE_PATH);
    await uploadBytes(storageRef, file);
    const fileUrl = await getDownloadURL(storageRef);

    await setDoc(visitFormDocRef(), {
      fileUrl,
      fileName:   file.name,
      uploadedAt: serverTimestamp(),
      uploadedBy: currentAdminData?.fullName || "الأدمن"
    });

    await loadVisitFormInfo();
  } catch (err) {
    console.error("uploadVisitForm error:", err);
    alert("حدث خطأ أثناء رفع الملف: " + err.message);
    await loadVisitFormInfo();
  }
}

async function removeVisitForm() {
  if (!confirm("هل تريدين حذف نموذج الزيارة الحالي؟ الطالبات لن يتمكنّ من تحميله بعد الحذف.")) return;
  try {
    await deleteObject(ref(storage, VISIT_FORM_STORAGE_PATH)).catch(() => {});
    await deleteDoc(visitFormDocRef());
    await loadVisitFormInfo();
  } catch (err) {
    console.error("removeVisitForm error:", err);
    alert("حدث خطأ أثناء حذف الملف: " + err.message);
  }
}

const uploadVisitFileBtnEl = document.getElementById("uploadVisitFileBtn");
const visitFileInputEl     = document.getElementById("visitFileInput");

if (uploadVisitFileBtnEl && visitFileInputEl) {
  uploadVisitFileBtnEl.addEventListener("click", () => visitFileInputEl.click());

  visitFileInputEl.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) uploadVisitForm(file);
    e.target.value = "";
  });
}

// ==================== أحداث الواجهة ====================

document.querySelectorAll(".admin-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll(".admin-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    currentStatusFilter = "all";
    document.getElementById("statusFilter").value = "all";
    document.querySelectorAll(".admin-stat-card").forEach((c) => c.classList.remove("active"));
    document.getElementById("card-all").classList.add("active");

    // إظهار منطقة رفع نموذج الزيارة فقط داخل تبويب "طلبات الزيارة"
    const visitUploadAreaEl = document.getElementById("visitUploadArea");
    if (visitUploadAreaEl) {
      if (currentTab === "visit") {
        visitUploadAreaEl.style.display = "";
        loadVisitFormInfo();
      } else {
        visitUploadAreaEl.style.display = "none";
      }
    }

    renderTab();
  });
});

document.querySelectorAll(".admin-stat-card").forEach((card) => {
  card.addEventListener("click", () => {
    currentStatusFilter = card.dataset.filter;
    document.getElementById("statusFilter").value =
      ["new", "under_review", "approved", "rejected"].includes(currentStatusFilter) ? currentStatusFilter : "all";
    document.querySelectorAll(".admin-stat-card").forEach((c) => c.classList.remove("active"));
    card.classList.add("active");
    renderTab();
  });
});

document.getElementById("deptFilter").addEventListener("change", (e) => {
  currentDeptFilter = e.target.value;
  renderTab();
});

document.getElementById("statusFilter").addEventListener("change", (e) => {
  currentStatusFilter = e.target.value;
  document.querySelectorAll(".admin-stat-card").forEach((c) => c.classList.remove("active"));
  const matchCard = document.getElementById("card-" + currentStatusFilter);
  if (matchCard) matchCard.classList.add("active");
  renderTab();
});

let searchDebounce = null;
document.getElementById("searchInput").addEventListener("input", (e) => {
  searchQuery = e.target.value;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => renderTab(), 200);
});

document.getElementById("spCloseBtn").addEventListener("click", closeSidePanel);
document.getElementById("spOverlay").addEventListener("click", closeSidePanel);
document.getElementById("spPrintBtn").addEventListener("click", printActiveStudent);

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "EmployeeLogin.html";
});

// ==================== المصادقة ====================

// authStateReady() تنتظر حتى يتحقق Firebase من الجلسة المحفوظة
// قبل ما نشغّل onAuthStateChanged — هذا يمنع التوجيه الخاطئ للـ login
console.log("BEFORE AUTH");
auth.authStateReady().then(() => {
  onAuthStateChanged(auth, async (user) => {
    console.log("AUTH USER:", user?.email);
    try {
      if (!user) {
        window.location.replace("EmployeeLogin.html");
        return;
      }

      const q    = query(collection(db, "employees"), where("email", "==", user.email));
      const snap = await getDocs(q);

      if (snap.empty) {
        await signOut(auth);
        window.location.replace("EmployeeLogin.html");
        return;
      }

      const adminDoc = snap.docs[0];
      const data     = adminDoc.data();

      if (!data.isAdmin) {
        await signOut(auth);
        window.location.replace("EmployeeLogin.html");
        return;
      }

      currentAdminData = { docId: adminDoc.id, uid: user.uid, ...data };
      employeesCache[adminDoc.id] = data.fullName || "الأدمن";

      // مزامنة uid هذا الأدمن في مجموعة مخصصة (adminUids) تُستخدم فقط من
      // قواعد الأمان (Security Rules) للتحقق من صلاحية الأدمن عند الكتابة
      // المباشرة لقاعدة البيانات/التخزين (رفع/حذف نموذج الزيارة)
      try {
        await setDoc(doc(db, "adminUids", user.uid), { isAdmin: true, email: user.email }, { merge: true });
      } catch (syncErr) {
        console.error("adminUids sync error:", syncErr);
      }

      const adminNameEl = document.getElementById("adminName");
      if (adminNameEl) adminNameEl.textContent = data.fullName || "الأدمن";

      const adminNameWelcomeEl = document.getElementById("adminNameWelcome");
      if (adminNameWelcomeEl) adminNameWelcomeEl.textContent = data.fullName || "الأدمن";

      const adminEmailEl = document.getElementById("adminEmail");
      if (adminEmailEl) adminEmailEl.textContent = data.email || user.email || "-";

      setDates();
      await loadAllData();

    } catch (err) {
      console.error("Auth error:", err);
      await signOut(auth);
      window.location.replace("EmployeeLogin.html");
    }
  });
});
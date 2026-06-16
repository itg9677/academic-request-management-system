import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
<<<<<<< HEAD
  getFirestore, doc, getDoc, collection, query, where, getDocs,
  updateDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ==================== Firebase ====================

const firebaseConfig = {
  apiKey:            "AIzaSyDg4iYMZEdc8pjJU67KtXbSvhBaqdoP0iA",
  authDomain:        "studentsreq-d9ea1.firebaseapp.com",
  projectId:         "studentsreq-d9ea1",
  storageBucket:     "studentsreq-d9ea1.appspot.com",
  messagingSenderId: "375395162945",
  appId:             "1:375395162945:web:e3edb97c48a30ab6401fc0"
};

const app     = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);
=======
  doc, getDoc, collection, query, where, getDocs,
  updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
>>>>>>> d2d3df72632a0886aeda0bde01b7adee5a1f1288

// ==================== State ====================

let currentAdminData = null;

const studentsCache  = {};
const employeesCache = {};

const tabData = { addDrop: [], excuse: [], visit: [] };

let currentTab          = "addDrop";
let currentStatusFilter = "all";
let currentDeptFilter   = "all";
let searchQuery         = "";
<<<<<<< HEAD
let activeRequest       = null; // { tab, item } المعروض حاليًا في اللوحة الجانبية
=======
let activeRequest       = null;
>>>>>>> d2d3df72632a0886aeda0bde01b7adee5a1f1288

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
  role:           "نوع الحساب",
  uid:            "معرف المستخدم",
  createdAt:      "تاريخ التسجيل",
  updatedAt:      "تاريخ آخر تحديث",
  address:        "العنوان",
  city:           "المدينة",
  nationality:    "الجنسية",
  birthDate:      "تاريخ الميلاد",
  advisorName:    "المرشد الأكاديمي",
  track:          "المسار",
  plan:           "الخطة الدراسية",
};

<<<<<<< HEAD
=======
// حقول تقنية لا تُعرض
const hiddenFields = ["_uid", "password", "token", "fcmToken", "pushToken", "deviceId"];

const statusLabel = {
  pending:      "معلق",
  under_review: "قيد المراجعة",
  approved:     "مقبول",
  rejected:     "مرفوض"
};

>>>>>>> d2d3df72632a0886aeda0bde01b7adee5a1f1288
const reqTypeLabel   = { add: "اضافة", drop: "حذف", edit: "تعديل شعبة" };
const visitTypeLabel = { internal: "داخلية", external: "خارجية" };
const levelLabel     = {
  "1": "المستوى الأول", "2": "المستوى الثاني", "3": "المستوى الثالث", "4": "المستوى الرابع",
  "5": "المستوى الخامس", "6": "المستوى السادس", "7": "المستوى السابع", "8": "المستوى الثامن"
};

const tabConfig = {
  addDrop: { collectionName: "requests",      studentField: "studentUid", title: "طلبات الحذف والإضافة" },
<<<<<<< HEAD
  excuse:  { collectionName: "excuses",       studentField: "studentUid", title: "طلبات رفع الأعذار"    },
  visit:   { collectionName: "visitRequests", studentField: "uid",        title: "طلبات الزيارة"        }
=======
  excuse:  { collectionName: "excuses",       studentField: "studentUid", title: "طلبات رفع الأعذار"   },
  visit:   { collectionName: "visitRequests", studentField: "uid",        title: "طلبات الزيارة"       }
>>>>>>> d2d3df72632a0886aeda0bde01b7adee5a1f1288
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

<<<<<<< HEAD
// القسم المرتبط بالطلب
=======
>>>>>>> d2d3df72632a0886aeda0bde01b7adee5a1f1288
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

// ==================== عرض الجدول الرئيسي ====================

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

  document.getElementById("cnt-all").textContent      = filtered.length;
  document.getElementById("cnt-pending").textContent  = filtered.filter((it) => it.status === "pending").length;
  document.getElementById("cnt-approved").textContent = filtered.filter((it) => it.status === "approved").length;
  document.getElementById("cnt-rejected").textContent = filtered.filter((it) => it.status === "rejected").length;

  if (currentStatusFilter !== "all") {
    filtered = filtered.filter((it) => it.status === currentStatusFilter);
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

<<<<<<< HEAD
  // الترتيب: الأقدم أولاً، والطلبات المكتملة تنزل للأسفل
=======
>>>>>>> d2d3df72632a0886aeda0bde01b7adee5a1f1288
  filtered.sort((a, b) => {
    const ga = (a.status === "approved" || a.status === "rejected") ? 1 : 0;
    const gb = (b.status === "approved" || b.status === "rejected") ? 1 : 0;
    if (ga !== gb) return ga - gb;
    const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
    return ta - tb;
  });

<<<<<<< HEAD
  // الرسم
=======
>>>>>>> d2d3df72632a0886aeda0bde01b7adee5a1f1288
  const tbody     = document.getElementById("mainTbody");
  const emptyState = document.getElementById("emptyState");
  tbody.innerHTML = "";

  if (!filtered.length) {
    emptyState.style.display = "";
  } else {
    emptyState.style.display = "none";
    filtered.forEach((it) => tbody.appendChild(buildRow(currentTab, it)));
  }

  const deptLabel = currentDeptFilter === "all" ? "كل الأقسام" : currentDeptFilter;
  document.getElementById("tableTitle").textContent = cfg.title + " — " + deptLabel;

  const infoBar = document.getElementById("searchInfoBar");
  if (q) {
    infoBar.style.display = "";
    infoBar.textContent   = `نتائج البحث عن "${searchQuery.trim()}": ${filtered.length} طلب`;
  } else {
    infoBar.style.display = "none";
  }
}

function buildRow(tab, item) {
  const cfg     = tabConfig[tab];
  const student = studentsCache[item[cfg.studentField]] || {};
  const tr      = document.createElement("tr");
  tr.dataset.tab = tab;
  tr.dataset.id  = item.id;

  const initials  = (student.fullName || "??").slice(0, 2);
  const dept      = item.assignedDepartment || student.major || "-";
  const empName   = item.assignedEmployee ? employeesCache[item.assignedEmployee] : null;
  const statusKey = item.status || "pending";

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
    <td class="date-cell">${formatDate(item.createdAt)}</td>
    <td><span class="status-badge s-${statusKey}">${statusLabel[statusKey] || statusKey}</span></td>
    <td>${empName
      ? `<span class="emp-chip"><i class="ti ti-user"></i> ${esc(empName)}</span>`
      : '<span class="no-emp">لم يُعيّن بعد</span>'}</td>
    <td><button class="detail-btn">التفاصيل <i class="ti ti-chevron-left detail-chevron"></i></button></td>
  `;

  tr.addEventListener("click", () => openSidePanel(tab, item));
  return tr;
}

// ==================== اللوحة الجانبية ====================

function buildDetailRows(tab, item) {
  const statusKey  = item.status || "pending";
  const statusHtml = `<span class="status-badge s-${statusKey}">${statusLabel[statusKey] || statusKey}</span>`;

  if (tab === "addDrop") {
    let rows = `
      <tr><td class="sp-detail-label">نوع الطلب</td><td>${reqTypeLabel[item.requestType] || item.requestType || "-"}</td></tr>
      <tr><td class="sp-detail-label">المقرر</td><td>${esc(item.courseName || "-")} (${esc(item.courseCode || "-")})</td></tr>
    `;
    if (item.requestType === "edit") {
      rows += `<tr><td class="sp-detail-label">الشعبة المطلوبة</td><td>${esc(item.requestedSection || "-")}</td></tr>`;
    }
    rows += `
      <tr><td class="sp-detail-label">تاريخ الطلب</td><td>${formatDate(item.createdAt)}</td></tr>
      <tr><td class="sp-detail-label">الحالة</td><td>${statusHtml}</td></tr>
    `;
    return rows;
  }

  if (tab === "excuse") {
    const attach = item.attachmentUrl
      ? `<a href="${esc(item.attachmentUrl)}" target="_blank" rel="noopener">تحميل المرفق</a>`
      : "لا يوجد";
    return `
      <tr><td class="sp-detail-label">رمز المقرر</td><td>${esc(item.courseCode || "-")}</td></tr>
      <tr><td class="sp-detail-label">تاريخ الاختبار</td><td>${esc(item.examDate || "-")}</td></tr>
      <tr><td class="sp-detail-label">الملاحظات</td><td>${esc(item.notes || "-")}</td></tr>
      <tr><td class="sp-detail-label">المرفق</td><td>${attach}</td></tr>
      <tr><td class="sp-detail-label">تاريخ الطلب</td><td>${formatDate(item.createdAt)}</td></tr>
      <tr><td class="sp-detail-label">الحالة</td><td>${statusHtml}</td></tr>
    `;
  }

  // visit
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
  `;
}

function buildOtherRequestsTable(tab, item) {
  const cfg    = tabConfig[tab];
<<<<<<< HEAD
  const others = tabData[tab].filter((it) => it.id !== item.id && it[cfg.studentField] === item[cfg.studentField]);
=======
  const others = tabData[tab].filter(
    (it) => it.id !== item.id && it[cfg.studentField] === item[cfg.studentField]
  );
>>>>>>> d2d3df72632a0886aeda0bde01b7adee5a1f1288

  if (!others.length) return "";

  const rows = others.map((o) => {
    let label = "-";
    if (tab === "addDrop") label = `${reqTypeLabel[o.requestType] || o.requestType || "-"} — ${esc(o.courseCode || "")}`;
    else if (tab === "excuse") label = esc(o.courseCode || "-");
    else label = visitTypeLabel[o.visitType] || o.visitType || "-";

    const statusKey = o.status || "pending";
    return `
      <tr class="sp-other-row" data-id="${o.id}">
        <td>${label}</td>
        <td><span class="status-badge s-${statusKey}">${statusLabel[statusKey] || statusKey}</span></td>
        <td>${formatDate(o.createdAt)}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="sp-section-title">طلبات أخرى لنفس الطالب</div>
    <div class="sp-table-wrap">
      <table class="sp-table">
        <thead><tr><th>الطلب</th><th>الحالة</th><th>التاريخ</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function openSidePanel(tab, item) {
  activeRequest = { tab, item };
<<<<<<< HEAD
  const cfg     = tabConfig[tab];
  const student = studentsCache[item[cfg.studentField]] || {};
=======
  const cfg       = tabConfig[tab];
  const student   = studentsCache[item[cfg.studentField]] || {};
>>>>>>> d2d3df72632a0886aeda0bde01b7adee5a1f1288
  const statusKey = item.status || "pending";

  document.getElementById("spTitle").textContent = student.fullName || "تفاصيل الطالب";
  document.getElementById("spSub").textContent   = cfg.title;
<<<<<<< HEAD
=======

  // جميع حقول الطالب الموجودة فعلاً في فايرستور
  const allStudentRows = buildStudentAllFields(student);
>>>>>>> d2d3df72632a0886aeda0bde01b7adee5a1f1288

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
<<<<<<< HEAD
=======

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
>>>>>>> d2d3df72632a0886aeda0bde01b7adee5a1f1288

  let headerCols = "";
  let rows       = "";

  if (tab === "addDrop") {
    headerCols = "<th>نوع الطلب</th><th>المقرر</th><th>الشعبة المطلوبة</th><th>الحالة</th><th>التاريخ</th>";
    rows = items.map((r) => `
      <tr>
        <td>${reqTypeLabel[r.requestType] || r.requestType || "-"}</td>
        <td>${esc(r.courseName || "")} (${esc(r.courseCode || "")})</td>
        <td>${r.requestType === "edit" ? esc(r.requestedSection || "-") : "-"}</td>
        <td>${statusLabel[r.status] || r.status}</td>
        <td>${formatDate(r.createdAt)}</td>
      </tr>
    `).join("");
  } else if (tab === "excuse") {
    headerCols = "<th>رمز المقرر</th><th>تاريخ الاختبار</th><th>الملاحظات</th><th>الحالة</th><th>التاريخ</th>";
    rows = items.map((r) => `
      <tr>
        <td>${esc(r.courseCode || "-")}</td>
        <td>${esc(r.examDate || "-")}</td>
        <td>${esc(r.notes || "-")}</td>
        <td>${statusLabel[r.status] || r.status}</td>
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
        <td>${statusLabel[r.status] || r.status}</td>
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

// ==================== رفع نموذج الزيارة ====================

async function uploadVisitFile(file) {
  const btn    = document.getElementById("uploadVisitFileBtn");
  const nameEl = document.getElementById("uploadedFileName");

  btn.disabled    = true;
  btn.innerHTML   = '<i class="ti ti-loader-2 spin"></i> جاري الرفع...';
  nameEl.textContent = "";
  nameEl.style.color = "";

  try {
    // رفع الملف إلى Firebase Storage
    const storageRef  = ref(storage, `visitForms/${Date.now()}_${file.name}`);
    const uploadTask  = uploadBytesResumable(storageRef, file);

    await new Promise((resolve, reject) => {
      uploadTask.on("state_changed", null, reject, resolve);
    });

    const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

    // حفظ الرابط في Firestore → settings/visitForm
    await setDoc(doc(db, "settings", "visitForm"), {
      fileUrl:    downloadURL,
      fileName:   file.name,
      uploadedAt: new Date().toISOString(),
      uploadedBy: currentAdminData.fullName || "الأدمن"
    });

    nameEl.textContent = "✓ تم رفع: " + file.name;
    nameEl.style.color = "#2e7d32";

  } catch (err) {
    console.error("Upload error:", err);
    nameEl.textContent = "✗ فشل الرفع، حاول مجدداً";
    nameEl.style.color = "#c62828";
  } finally {
    btn.innerHTML  = '<i class="ti ti-upload"></i> رفع نموذج الزيارة (PDF)';
    btn.disabled   = false;
  }
}

document.getElementById("uploadVisitFileBtn").addEventListener("click", () => {
  document.getElementById("visitFileInput").click();
});

document.getElementById("visitFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file && file.type === "application/pdf") {
    uploadVisitFile(file);
  } else if (file) {
    alert("يرجى اختيار ملف PDF فقط.");
  }
  e.target.value = ""; // reset عشان تقدر ترفع نفس الملف مرة ثانية
});

// ==================== أحداث الواجهة ====================

document.querySelectorAll(".admin-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll(".admin-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
<<<<<<< HEAD

    // إظهار/إخفاء منطقة رفع الملف عند تبويب الزيارة فقط
    document.getElementById("visitUploadArea").style.display =
      currentTab === "visit" ? "flex" : "none";

    // إعادة فلتر الحالة للوضع الافتراضي عند تبديل التبويب
=======
>>>>>>> d2d3df72632a0886aeda0bde01b7adee5a1f1288
    currentStatusFilter = "all";
    document.getElementById("statusFilter").value = "all";
    document.querySelectorAll(".admin-stat-card").forEach((c) => c.classList.remove("active"));
    document.getElementById("card-all").classList.add("active");
    renderTab();
  });
});

document.querySelectorAll(".admin-stat-card").forEach((card) => {
  card.addEventListener("click", () => {
    currentStatusFilter = card.dataset.filter;
    document.getElementById("statusFilter").value =
      ["pending", "approved", "rejected"].includes(currentStatusFilter) ? currentStatusFilter : "all";
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
auth.authStateReady().then(() => {
  onAuthStateChanged(auth, async (user) => {
    try {
      if (!user) {
        window.location.replace("EmployeeLogin.html");
        return;
      }

<<<<<<< HEAD
    const q = query(
      collection(db, "employees"),
      where("email", "==", user.email)
    );
=======
      const q    = query(collection(db, "employees"), where("email", "==", user.email));
      const snap = await getDocs(q);
>>>>>>> d2d3df72632a0886aeda0bde01b7adee5a1f1288

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

      const adminNameEl = document.getElementById("adminName");
      if (adminNameEl) adminNameEl.textContent = data.fullName || "الأدمن";

      setDates();
      await loadAllData();

    } catch (err) {
      console.error("Auth error:", err);
      await signOut(auth);
      window.location.replace("EmployeeLogin.html");
    }
<<<<<<< HEAD

    const adminDoc = snap.docs[0];
    const data     = adminDoc.data();

    if (!data.isAdmin) {
      await signOut(auth);
      window.location.replace("EmployeeLogin.html");
      return;
    }

    currentAdminData = { docId: adminDoc.id, uid: user.uid, ...data };
    employeesCache[adminDoc.id] = data.fullName || "الأدمن";

    const adminNameEl = document.getElementById("adminName");
    if (adminNameEl) {
      adminNameEl.textContent = data.fullName || "الأدمن";
    }

    setDates();
    await loadAllData();

  } catch (err) {
    console.error("Auth error:", err);
    await signOut(auth);
    window.location.replace("EmployeeLogin.html");
  }
=======
  });
>>>>>>> d2d3df72632a0886aeda0bde01b7adee5a1f1288
});

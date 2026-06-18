import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, collection, query, where, getDocs,
  updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ==================== Firebase ====================

const firebaseConfig = {
  apiKey:            "AIzaSyDg4iYMZEdc8pjJU67KtXbSvhBaqdoP0iA",
  authDomain:        "studentsreq-d9ea1.firebaseapp.com",
  projectId:         "studentsreq-d9ea1",
  storageBucket:     "studentsreq-d9ea1.appspot.com",
  messagingSenderId: "375395162945",
  appId:             "1:375395162945:web:e3edb97c48a30ab6401fc0"
};

const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ==================== State ====================

let currentAdminData = null;

// كاش بيانات الطلاب والموظفين لتقليل القراءات من فايرستور
const studentsCache  = {};
const employeesCache = {};

// بيانات كل تبويب (تُحمّل مرة واحدة من فايرستور)
const tabData = { addDrop: [], excuse: [], visit: [] };

let currentTab        = "addDrop";
let currentStatusFilter = "all";
let currentDeptFilter   = "all";
let searchQuery       = "";
let activeRequest     = null; // { tab, item } المعروض حاليًا في اللوحة الجانبية

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

const statusLabel = {
  pending: "معلق",
  under_review: "قيد المراجعة",
  approved: "مقبول",
  rejected: "مرفوض"
};

const reqTypeLabel = { add: "اضافة", drop: "حذف", edit: "تعديل شعبة" };
const visitTypeLabel = { internal: "داخلية", external: "خارجية" };

const tabConfig = {
  addDrop: { collectionName: "requests",     studentField: "studentUid", title: "طلبات الحذف والإضافة" },
  excuse:  { collectionName: "excuses",      studentField: "uid", title: "طلبات رفع الأعذار" },
  visit:   { collectionName: "visitRequests", studentField: "uid",       title: "طلبات الزيارة" }
};

// يجلب بيانات الطالب ويخزّنها في الكاش (قراءة واحدة فقط لكل طالب)
async function getStudent(uid) {
  if (!uid) return null;
  if (studentsCache[uid]) return studentsCache[uid];
  try {
    const snap = await getDoc(doc(db, "students", uid));
    studentsCache[uid] = snap.exists() ? snap.data() : { fullName: "-", universityId: "-" };
  } catch (e) {
    studentsCache[uid] = { fullName: "-", universityId: "-" };
  }
  return studentsCache[uid];
}

// يجلب اسم الموظف المعالج ويخزّنه في الكاش (قراءة واحدة فقط لكل موظف)
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

// القسم المرتبط بالطلب: assignedDepartment إن وُجد، وإلا تخصص الطالب (لطلبات الزيارة)
function getReqDepartment(item, student) {
  return item.assignedDepartment || (student && student.major) || null;
}

// ==================== تحميل البيانات ====================

async function loadAllData() {
  const loadingEl  = document.getElementById("loadingState");
  const tableWrapEl = document.getElementById("tableWrap");

  loadingEl.style.display = "";
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
    loadingEl.style.display = "none";
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
  const cfg = tabConfig[currentTab];
  const items = tabData[currentTab];

  // تحميل بيانات الطلاب اللازمة (مع كاش)
  const uniqueStudentUids = [...new Set(items.map((it) => it[cfg.studentField]).filter(Boolean))];
  await Promise.all(uniqueStudentUids.map((uid) => getStudent(uid)));

  // تحميل أسماء الموظفين المعالجين (مع كاش)
  const uniqueEmpUids = [...new Set(items.map((it) => it.assignedEmployee).filter(Boolean))];
  await Promise.all(uniqueEmpUids.map((uid) => getEmployeeName(uid)));

  // فلترة حسب القسم
  let filtered = items.filter((it) => {
    if (currentDeptFilter === "all") return true;
    const student = studentsCache[it[cfg.studentField]] || {};
    return getReqDepartment(it, student) === currentDeptFilter;
  });

  // تحديث بطاقات الإحصائيات (قبل تطبيق فلتر الحالة)
  document.getElementById("cnt-all").textContent      = filtered.length;
  document.getElementById("cnt-pending").textContent  = filtered.filter((it) => it.status === "pending").length;
  document.getElementById("cnt-approved").textContent = filtered.filter((it) => it.status === "approved").length;
  document.getElementById("cnt-rejected").textContent = filtered.filter((it) => it.status === "rejected").length;

  // فلترة حسب الحالة
  if (currentStatusFilter !== "all") {
    filtered = filtered.filter((it) => it.status === currentStatusFilter);
  }

  // البحث باسم الطالب أو رقمه الجامعي
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter((it) => {
      const student = studentsCache[it[cfg.studentField]] || {};
      const name = (student.fullName || "").toLowerCase();
      const uid  = String(student.universityId || "").toLowerCase();
      return name.includes(q) || uid.includes(q);
    });
  }

  // الترتيب: الأقدم أولاً، والطلبات المكتملة (مقبول/مرفوض) تنزل للأسفل
  filtered.sort((a, b) => {
    const ga = (a.status === "approved" || a.status === "rejected") ? 1 : 0;
    const gb = (b.status === "approved" || b.status === "rejected") ? 1 : 0;
    if (ga !== gb) return ga - gb;
    const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
    return ta - tb;
  });

  // الرسم
  const tbody = document.getElementById("mainTbody");
  const emptyState = document.getElementById("emptyState");
  tbody.innerHTML = "";

  if (!filtered.length) {
    emptyState.style.display = "";
  } else {
    emptyState.style.display = "none";
    filtered.forEach((it) => tbody.appendChild(buildRow(currentTab, it)));
  }

  // عنوان الجدول
  const deptLabel = currentDeptFilter === "all" ? "كل الأقسام" : currentDeptFilter;
  document.getElementById("tableTitle").textContent = cfg.title + " — " + deptLabel;

  // شريط نتائج البحث
  const infoBar = document.getElementById("searchInfoBar");
  if (q) {
    infoBar.style.display = "";
    infoBar.textContent = `نتائج البحث عن "${searchQuery.trim()}": ${filtered.length} طلب`;
  } else {
    infoBar.style.display = "none";
  }
}

function buildRow(tab, item) {
  const cfg = tabConfig[tab];
  const student = studentsCache[item[cfg.studentField]] || {};

  const tr = document.createElement("tr");
  tr.dataset.tab = tab;
  tr.dataset.id = item.id;

  const initials = (student.fullName || "??").slice(0, 2);
  const dept = item.assignedDepartment || student.major || "-";
  const empName = item.assignedEmployee ? employeesCache[item.assignedEmployee] : null;
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
    <td class="uid-cell">${esc(student.universityId || "-")}</td>
    <td><span class="dept-chip">${esc(dept)}</span></td>
    <td class="date-cell">${formatDate(item.createdAt)}</td>
    <td><span class="status-badge s-${statusKey}">${statusLabel[statusKey] || statusKey}</span></td>
    <td>${empName ? `<span class="emp-chip"><i class="ti ti-user"></i> ${esc(empName)}</span>` : '<span class="no-emp">لم يُعيّن بعد</span>'}</td>
    <td><button class="detail-btn">التفاصيل <i class="ti ti-chevron-left detail-chevron"></i></button></td>
  `;

  tr.addEventListener("click", () => openSidePanel(tab, item));
  return tr;
}

// ==================== اللوحة الجانبية ====================

function buildDetailRows(tab, item) {
  const statusKey = item.status || "pending";
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
      <tr><td class="sp-detail-label">الملاحظات</td><td>${esc(item.reason || "-")}</td></tr>
      <tr><td class="sp-detail-label">المرفق</td><td>${attach}</td></tr>
      <tr><td class="sp-detail-label">تاريخ الطلب</td><td>${formatDate(item.createdAt)}</td></tr>
      <tr><td class="sp-detail-label">الحالة</td><td>${statusHtml}</td></tr>
    `;
  }

  // visit
  const courses = (item.courses || [])
    .map((c) => `${esc(c.courseName || "-")} (${esc(c.courseCode || "-")})`)
    .join("، ") || "-";

  return `
    <tr><td class="sp-detail-label">نوع الزيارة</td><td>${visitTypeLabel[item.visitType] || item.visitType || "-"}</td></tr>
    <tr><td class="sp-detail-label">المقررات</td><td>${courses}</td></tr>
    <tr><td class="sp-detail-label">تاريخ الطلب</td><td>${formatDate(item.createdAt)}</td></tr>
    <tr><td class="sp-detail-label">الحالة</td><td>${statusHtml}</td></tr>
  `;
}

function buildOtherRequestsTable(tab, item) {
  const cfg = tabConfig[tab];
  const others = tabData[tab].filter((it) => it.id !== item.id && it[cfg.studentField] === item[cfg.studentField]);

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
  const cfg = tabConfig[tab];
  const student = studentsCache[item[cfg.studentField]] || {};
  const statusKey = item.status || "pending";

  document.getElementById("spTitle").textContent = student.fullName || "تفاصيل الطالب";
  document.getElementById("spSub").textContent = cfg.title;

  document.getElementById("spBody").innerHTML = `
    <div class="sp-student-card">
      <div class="sp-student-name">
        <div class="sp-avatar">${esc((student.fullName || "??").slice(0, 2))}</div>
        <div>
          <div>${esc(student.fullName || "-")}</div>
          <div class="sp-phone">${esc(student.phoneNumber || "-")}</div>
        </div>
      </div>
      <div class="sp-info-row">
        <div class="sp-info-item"><i class="ti ti-id-badge-2"></i> ${esc(student.universityId || "-")}</div>
        <div class="sp-info-item"><i class="ti ti-school"></i> ${esc(student.major || "-")}</div>
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
  const cfg = tabConfig[tab];
  const buttons = document.querySelectorAll("#spBody .sp-action-btn");
  buttons.forEach((b) => (b.disabled = true));

  try {
    await updateDoc(doc(db, cfg.collectionName, item.id), {
      status: newStatus,
      assignedEmployee: currentAdminData.docId,
      updatedAt: serverTimestamp()
    });

    item.status = newStatus;
    item.assignedEmployee = currentAdminData.docId;
    employeesCache[currentAdminData.docId] = currentAdminData.fullName || "الأدمن";

    updateBadges();
    await renderTab();
    openSidePanel(tab, item); // إعادة فتح اللوحة ببيانات محدثة
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
  const cfg = tabConfig[tab];
  const student = studentsCache[item[cfg.studentField]] || {};
  const items = tabData[tab].filter((it) => it[cfg.studentField] === item[cfg.studentField]);

  let headerCols = "";
  let rows = "";

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
        <td>${esc(r.reason || "-")}</td>
        <td>${statusLabel[r.status] || r.status}</td>
        <td>${formatDate(r.createdAt)}</td>
      </tr>
    `).join("");
  } else {
    headerCols = "<th>نوع الزيارة</th><th>المقررات</th><th>الحالة</th><th>التاريخ</th>";
    rows = items.map((r) => `
      <tr>
        <td>${visitTypeLabel[r.visitType] || r.visitType || "-"}</td>
        <td>${(r.courses || []).map((c) => `${esc(c.courseName || "-")} (${esc(c.courseCode || "-")})`).join("، ") || "-"}</td>
        <td>${statusLabel[r.status] || r.status}</td>
        <td>${formatDate(r.createdAt)}</td>
      </tr>
    `).join("");
  }

  const styleBlock = `
    body{font-family:Arial,sans-serif;padding:30px;direction:rtl;}
    h2{color:#1a3a6b;border-bottom:3px solid #c8972b;padding-bottom:8px;}
    .info p{margin:5px 0;font-size:14px;}
    table{width:100%;border-collapse:collapse;margin-top:20px;font-size:13px;}
    th{background:#1a3a6b;color:white;padding:9px 12px;text-align:right;}
    td{padding:9px 12px;border-bottom:1px solid #e0e0e0;}
    tr:last-child td{border-bottom:none;}
    .footer{margin-top:30px;font-size:12px;color:#888;}
  `;

  const printHTML = `
    <html dir="rtl" lang="ar"><head><meta charset="UTF-8"/>
    <title>طباعة بيانات الطالب</title>
    <style>${styleBlock}</style></head><body>
    <h2>بيانات الطالب - نظام الخدمات الطلابية</h2>
    <div class="info">
      <p><strong>الاسم:</strong> ${esc(student.fullName || "-")}</p>
      <p><strong>الرقم الجامعي:</strong> ${esc(student.universityId || "-")}</p>
      <p><strong>التخصص:</strong> ${esc(student.major || "-")}</p>
      <p><strong>رقم الجوال:</strong> ${esc(student.phoneNumber || "-")}</p>
      <p><strong>التاريخ:</strong> ${new Date().toLocaleDateString("ar-SA")}</p>
    </div>
    <table><thead><tr>${headerCols}</tr></thead><tbody>${rows}</tbody></table>
    <div class="footer">طُبع بواسطة: ${esc(currentAdminData.fullName || "الأدمن")} - مدير النظام</div>
    </body></html>
  `;

  const win = window.open("", "_blank");
  win.document.write(printHTML);
  win.document.close();
  win.print();
}

// ==================== أحداث الواجهة ====================

// التبويبات
document.querySelectorAll(".admin-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;

    document.querySelectorAll(".admin-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");

    // إعادة فلتر الحالة للوضع الافتراضي عند تبديل التبويب
    currentStatusFilter = "all";
    document.getElementById("statusFilter").value = "all";
    document.querySelectorAll(".admin-stat-card").forEach((c) => c.classList.remove("active"));
    document.getElementById("card-all").classList.add("active");

    renderTab();
  });
});

// بطاقات الإحصائيات (كفلاتر سريعة على الحالة)
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

// فلتر القسم
document.getElementById("deptFilter").addEventListener("change", (e) => {
  currentDeptFilter = e.target.value;
  renderTab();
});

// فلتر الحالة
document.getElementById("statusFilter").addEventListener("change", (e) => {
  currentStatusFilter = e.target.value;

  document.querySelectorAll(".admin-stat-card").forEach((c) => c.classList.remove("active"));
  const matchCard = document.getElementById("card-" + currentStatusFilter);
  if (matchCard) matchCard.classList.add("active");

  renderTab();
});

// البحث
let searchDebounce = null;
document.getElementById("searchInput").addEventListener("input", (e) => {
  searchQuery = e.target.value;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => renderTab(), 200);
});

// اللوحة الجانبية: الإغلاق
document.getElementById("spCloseBtn").addEventListener("click", closeSidePanel);
document.getElementById("spOverlay").addEventListener("click", closeSidePanel);

// اللوحة الجانبية: الطباعة
document.getElementById("spPrintBtn").addEventListener("click", printActiveStudent);

// تسجيل الخروج
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "EmployeeLogin.html";
});

// ==================== المصادقة ====================

onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) {
      window.location.replace("EmployeeLogin.html");
      return;
    }

    // 🔴 بدل doc مباشرة → نستخدم Query لأن الـ docId مو uid
    const q = query(
      collection(db, "employees"),
      where("email", "==", user.email)
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      await signOut(auth);
      window.location.replace("EmployeeLogin.html");
      return;
    }

    const adminDoc = snap.docs[0];
    const data = adminDoc.data();

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
});
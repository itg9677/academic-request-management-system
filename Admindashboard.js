import { auth, db, storage } from "./firebase.js";
import { getCurrentSemester, getAllSemesters, activateSemester } from "./semester.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs,
  updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// imports خاصة بميزة نقل صلاحية الأدمن (تطبيق Firebase ثانوي مؤقت)
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

console.log("FILE LOADED");

// ==================== State ====================
// ==================== تحميل بيانات الأدمن ====================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "loginPage.html"; // أو اسم صفحة تسجيل الدخول عندك
    return;
  }

  try {
    // جلب بيانات الموظف من Firestore
    const snap = await getDoc(doc(db, "employees", user.uid));

    if (snap.exists()) {
      currentAdminData = {
        docId: user.uid,
        ...snap.data()
      };

      // حفظ اسم الموظف في الكاش
      employeesCache[user.uid] = currentAdminData.fullName || "موظف";

      // عرض الاسم في الصفحة
      document.getElementById("adminName").textContent = currentAdminData.fullName || "";
      document.getElementById("adminEmail").textContent = currentAdminData.email || "";
      document.getElementById("adminNameWelcome").textContent = currentAdminData.fullName || "";

      // تحميل البيانات بعد تحميل بيانات الأدمن
      loadAllData();

    } else {
      console.error("لم يتم العثور على بيانات الموظف في employees/");
    }

  } catch (err) {
    console.error("خطأ في تحميل بيانات الأدمن:", err);
  }
});

let currentAdminData = null;

const studentsCache  = {};
const employeesCache = {};

const tabData = { addDrop: [], excuse: [], visit: [], complaints: [] };

let currentTab          = "addDrop";
let currentStatusFilter = "all";
let currentDeptFilter   = "all";
let currentExcuseDept      = "all";
let currentExcuseExamType  = "all";
let currentExcuseStatus    = "all";
let searchQuery         = "";
let activeRequest       = null;
let currentSemesterData   = null;
let allSemestersCache     = [];   // كاش لكل الفصول (نستخدمه في inferSemesterFromDate)

// ==================== استنتاج الفصل من تاريخ الطلب ====================
// تُستخدم للطلبات القديمة التي ليس لها فيلد semester
function inferSemesterFromDate(createdAt) {
  if (!createdAt) return null;
  const d = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
  if (isNaN(d)) return null;
  for (const s of allSemestersCache) {
    const start = s.startDate?.toDate ? s.startDate.toDate() : (s.startDate ? new Date(s.startDate) : null);
    const end   = s.endDate?.toDate   ? s.endDate.toDate()   : (s.endDate   ? new Date(s.endDate)   : null);
    if (!start || !end) continue;
    if (d >= start && d <= end) return s.semester;
  }
  return null;
}

// تُعيد رقم الفصل للطلب: من الفيلد لو موجود، وإلا تستنتجه من تاريخ الطلب
function getItemSemester(item) {
  if (item.semester != null) return item.semester;
  return inferSemesterFromDate(item.createdAt);
}
let selectedSemesterFilter = "current"; // "current" أو رقم فصل محدد من الأرشيف

// ==================== إدارة الحالة النشطة في السايد بانل ====================

function setActiveSidebarItem(activeId) {
  // إزالة active من جميع عناصر السايد بانل
  document.querySelectorAll(".sb-nav-item").forEach((item) => {
    item.classList.remove("active");
  });
  // إضافة active للعنصر المحدد
  const el = document.getElementById(activeId);
  if (el) el.classList.add("active");
}

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
  addDrop:    { collectionName: "requests",         studentField: "studentUid", title: "طلبات الحذف والإضافة" },
  excuse:     { collectionName: "excuses",          studentField: "uid",        title: "طلبات رفع الأعذار"   },
  visit:      { collectionName: "visitRequests",    studentField: "uid",        title: "طلبات الزيارة"       },
  complaints: { collectionName: "complaints",       studentField: "studentUid", title: "الشكاوى والاقتراحات" }
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
  await loadAllEmployeeNames();
async function loadAllEmployeeNames() {
  const allEmpUids = new Set();

  // نجمع كل الموظفين الذين عالجوا طلبات
  [...tabData.addDrop, ...tabData.excuse, ...tabData.visit].forEach(item => {
    if (item.assignedEmployee) {
      allEmpUids.add(item.assignedEmployee);
    }
  });

  // نحمل أسماءهم من Firestore
  await Promise.all([...allEmpUids].map(uid => getEmployeeName(uid)));
}

  updateDashboardStats();
  buildCharts();


  loadingEl.style.display  = "";
  tableWrapEl.style.display = "none";

  try {

    const reqQuery = query(
      collection(db, "requests"),
      where("requestType", "in", ["add", "drop", "edit"])
    );

    const [reqSnap, excSnap, visSnap, compSnap] = await Promise.all([
      getDocs(reqQuery),
      getDocs(collection(db, "excuses")),
      getDocs(collection(db, "visitRequests")),
      getDocs(collection(db, "complaints"))
    ]);

    tabData.addDrop    = reqSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    tabData.excuse     = excSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    tabData.visit      = visSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    tabData.complaints = compSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

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
  document.getElementById("badge-addDrop").textContent    = tabData.addDrop.length;
  document.getElementById("badge-excuse").textContent     = tabData.excuse.length;
  document.getElementById("badge-visit").textContent      = tabData.visit.length;
  const compBadge = document.getElementById("badge-complaints");
  if (compBadge) compBadge.textContent = tabData.complaints.length;
}

// ==================== إدارة الفصل الدراسي ====================

// يجلب الفصل الحالي ويعبّئ قائمة الفصول المنسدلة - يُستدعى مرة عند الدخول
async function initSemesterData() {
  try {
    currentSemesterData = await getCurrentSemester(true);
    allSemestersCache   = await getAllSemesters();   // ← نحمل كل الفصول للـ infer
    await populateSemesterFilter();
  } catch (err) {
    console.error("initSemesterData error:", err);
  }
}

async function populateSemesterFilter() {
  const sel = document.getElementById("semesterFilter");
  if (!sel) return;

  const history = await getAllSemesters();

  sel.innerHTML = `<option value="current">الفصل الحالي${currentSemesterData?.name ? " - " + esc(currentSemesterData.name) : ""}</option>`;

  history.forEach((s) => {
    // لا نكرر الفصل الحالي في القائمة لو كان موجوداً بالأرشيف أيضاً
    if (currentSemesterData && s.semester === currentSemesterData.semester) return;
    const opt = document.createElement("option");
    opt.value = s.semester;
    opt.textContent = s.name || s.semester;
    sel.appendChild(opt);
  });

  sel.value = selectedSemesterFilter;
}

// تصنيف فصل بناءً على التواريخ مقارنةً بتاريخ اليوم
function classifySemester(s) {
  const now   = new Date();
  const start = s.startDate && s.startDate.toDate ? s.startDate.toDate() : (s.startDate ? new Date(s.startDate) : null);
  const end   = s.endDate   && s.endDate.toDate   ? s.endDate.toDate()   : (s.endDate   ? new Date(s.endDate)   : null);
  if (!start || !end) return "unknown";
  if (now < start) return "upcoming";
  if (now > end)   return "past";
  return "active";
}

// يعرض بيانات الفصل الحالي + الأرشيف داخل قسم "إدارة الفصل الدراسي"
async function loadSemesterInfo() {
  currentSemesterData = await getCurrentSemester(true);

  await populateSemesterFilter();

  const allSemesters = await getAllSemesters();
  const now = new Date();

  // تصنيف كل الفصول
  const active   = [];
  const upcoming = [];
  const past     = [];

  allSemesters.forEach((s) => {
    const type = classifySemester(s);
    if (type === "active")   active.push(s);
    else if (type === "upcoming") upcoming.push(s);
    else                     past.push(s);
  });

  // ترتيب القادمة: الأقرب أولاً | السابقة: الأحدث أولاً
  upcoming.sort((a, b) => {
    const aS = a.startDate?.toDate ? a.startDate.toDate() : new Date(a.startDate);
    const bS = b.startDate?.toDate ? b.startDate.toDate() : new Date(b.startDate);
    return aS - bS;
  });
  past.sort((a, b) => {
    const aE = a.endDate?.toDate ? a.endDate.toDate() : new Date(a.endDate);
    const bE = b.endDate?.toDate ? b.endDate.toDate() : new Date(b.endDate);
    return bE - aE;
  });

  // بناء كارد واحد
  function buildSemCard(s, badgeHtml, badgeStyle) {
    const daysLeft = (() => {
      const end = s.endDate?.toDate ? s.endDate.toDate() : new Date(s.endDate);
      const start = s.startDate?.toDate ? s.startDate.toDate() : new Date(s.startDate);
      const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
      const diffStart = Math.ceil((start - now) / (1000 * 60 * 60 * 24));
      if (classifySemester(s) === "active")   return `<span style="font-size:12px;color:#888;">يتبقى ${diff} يوم</span>`;
      if (classifySemester(s) === "upcoming") return `<span style="font-size:12px;color:#888;">يبدأ بعد ${diffStart} يوم</span>`;
      return "";
    })();

    return `
      <div class="dash-card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <div style="flex:1;">
          <div class="dash-card-label" style="font-size:15px;font-weight:600;">${esc(s.name || s.semester)}</div>
          <div class="dash-card-sub" style="margin-top:4px;">${formatDate(s.startDate)} → ${formatDate(s.endDate)}</div>
          ${daysLeft ? `<div style="margin-top:4px;">${daysLeft}</div>` : ""}
        </div>
        <span class="status-badge" style="${badgeStyle}">${badgeHtml}</span>
      </div>`;
  }

  // تحديث الكارد العلوي (الفصل المفعّل يدوياً)
  const nameEl  = document.getElementById("currentSemesterName");
  const datesEl = document.getElementById("currentSemesterDates");
  if (nameEl)  nameEl.textContent = currentSemesterData?.name || "لم يتم تفعيل فصل بعد";
  if (datesEl) {
    if (currentSemesterData) {
      const type = classifySemester(currentSemesterData);
      const typeLabel = type === "active" ? " — جارٍ حالياً ✅" : type === "upcoming" ? " — قادم 🔜" : " — منتهٍ ⚠️";
      datesEl.textContent = `${formatDate(currentSemesterData.startDate)} → ${formatDate(currentSemesterData.endDate)}${typeLabel}`;
    } else {
      datesEl.textContent = "-";
    }
  }

  const historyListEl = document.getElementById("semesterHistoryList");
  if (!historyListEl) return;

  let html = "";

  // --- الفصل الحالي (نشط) ---
  if (active.length) {
    html += `<div class="sem-section-title" style="margin:0 0 8px;font-weight:700;color:#1a7f37;font-size:13px;">
      <i class="ti ti-circle-check"></i> الفصل الجاري
    </div>`;
    html += active.map((s) => buildSemCard(s, "جارٍ ✅", "background:#d4edda;color:#155724;border:none;")).join("");
  }

  // --- الفصول القادمة ---
  if (upcoming.length) {
    html += `<div class="sem-section-title" style="margin:18px 0 8px;font-weight:700;color:#1a3a6b;font-size:13px;">
      <i class="ti ti-clock"></i> الفصول القادمة
    </div>`;
    html += upcoming.map((s) => buildSemCard(s, "قادم 🔜", "background:#cce5ff;color:#004085;border:none;")).join("");
  }

  // --- الفصول السابقة ---
  if (past.length) {
    html += `<div class="sem-section-title" style="margin:18px 0 8px;font-weight:700;color:#856404;font-size:13px;">
      <i class="ti ti-history"></i> الفصول السابقة
    </div>`;
    html += past.map((s) => buildSemCard(s, "منتهٍ", "background:#fff3cd;color:#856404;border:none;")).join("");
  }

  if (!html) {
    html = `<div class="admin-empty" style="padding:12px;">لا توجد فصول محفوظة بعد</div>`;
  }

  historyListEl.innerHTML = html;
}

// تفعيل فصل جديد من النموذج
document.getElementById("semesterForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const msgEl = document.getElementById("semesterMsg");
  const btn   = document.getElementById("activateSemesterBtn");

  const name   = document.getElementById("semName").value.trim();
  const number = document.getElementById("semNumber").value.trim();
  const start  = document.getElementById("semStart").value;
  const end    = document.getElementById("semEnd").value;

  if (!name || !number || !start || !end) {
    if (msgEl) { msgEl.textContent = "يرجى تعبئة جميع الحقول"; msgEl.style.color = "#c0392b"; }
    return;
  }

  btn.disabled = true;
  btn.textContent = "جاري التفعيل...";

  try {
    await activateSemester({
      name,
      semester: number,
      startDate: new Date(start),
      endDate: new Date(end)
    });

    if (msgEl) { msgEl.textContent = `تم تفعيل "${name}" بنجاح ✅`; msgEl.style.color = "#1a7f37"; }

    document.getElementById("semesterForm").reset();

    selectedSemesterFilter = "current";
    await loadSemesterInfo();
    await loadAllData();

  } catch (err) {
    console.error("activateSemester error:", err);
    if (msgEl) { msgEl.textContent = "حدث خطأ أثناء التفعيل: " + err.message; msgEl.style.color = "#c0392b"; }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> تفعيل الفصل';
  }
});

// تغيير الفصل المعروض في الجداول (الحالي أو فصل سابق)
document.getElementById("semesterFilter")?.addEventListener("change", (e) => {
  selectedSemesterFilter = e.target.value;
  renderTab();
});

function updateStatCards(items) {
  const newCount = items.filter((r) => getEffectiveStatus(r) === "new").length;
  const underReviewCount = items.filter((r) => getEffectiveStatus(r) === "under_review").length;
  const approvedCount = items.filter((r) => r.status === "approved").length;
  const rejectedCount = items.filter((r) => r.status === "rejected").length;

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

  // تأكد من إظهار الجدول ومنطقة البحث عند كل render
  const tableWrapEl = document.getElementById("tableWrap");
  const searchRowEl = document.querySelector(".admin-search-row");
  if (tableWrapEl) tableWrapEl.style.display = "";
  if (searchRowEl) searchRowEl.style.display = "";

  const uniqueStudentUids = [...new Set(items.map((it) => it[cfg.studentField]).filter(Boolean))];
  await Promise.all(uniqueStudentUids.map((uid) => getStudent(uid)));

  const uniqueEmpUids = [...new Set(items.map((it) => it.assignedEmployee).filter(Boolean))];
  await Promise.all(uniqueEmpUids.map((uid) => getEmployeeName(uid)));

  let filtered = items.filter((it) => {
    const itemSem = getItemSemester(it);
    const semOk = selectedSemesterFilter === "current"
      ? (!currentSemesterData || itemSem == null || itemSem === currentSemesterData.semester)
      : (itemSem == null || itemSem === Number(selectedSemesterFilter));
    if (!semOk) return false;
    if (currentDeptFilter === "all") return true;
    const student = studentsCache[it[cfg.studentField]] || {};
    return getReqDepartment(it, student) === currentDeptFilter;
  });

 updateStatCards(filtered);
 
  // فلاتر خاصة بتبويب الأعذار
  if (currentTab === "excuse") {
    if (currentExcuseDept !== "all") {
      filtered = filtered.filter(it => {
        const student = studentsCache[it[cfg.studentField]] || {};
        const dept = it.assignedDepartment || student.major || student.department || "";
        return dept === currentExcuseDept;
      });
    }
    if (currentExcuseExamType !== "all") {
      filtered = filtered.filter(it => it.examType === currentExcuseExamType);
    }
    if (currentExcuseStatus !== "all") {
      filtered = filtered.filter(it => getEffectiveStatus(it) === currentExcuseStatus);
    }
  }

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

  // إظهار / إخفاء فلاتر + زر تصدير الأعذار (مثل الموظف)
  const excuseFiltersWrap = document.getElementById("excuseFiltersWrap");
  if (excuseFiltersWrap) {
    excuseFiltersWrap.style.display = (currentTab === "excuse") ? "" : "none";
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
    <td class="uid-cell">${esc(student.universityId || "-")}</td>
    <td><span class="dept-chip">${esc(dept)}</span></td>
    <td><span class="req-count-badge">${requests.length}</span></td>
    <td><button class="detail-btn">التفاصيل <i class="ti ti-chevron-left detail-chevron"></i></button></td>
  `;

  // فتح اللوحة بأول طلب مطابق للفلتر الحالي (الأعلى أولوية)
  tr.addEventListener("click", () => {
    // نرشح طلبات هذا الطالب بالفلتر الحالي لنختار أول واحد يظهر
    let filteredRequests = requests;
    if (currentStatusFilter !== "all") {
      filteredRequests = requests.filter((it) => getEffectiveStatus(it) === currentStatusFilter);
    }
    const itemToOpen = filteredRequests[0] || requests[0];
    openSidePanel(tab, itemToOpen);
  });
  return tr;
}

// ==================== اللوحة الجانبية ====================

function buildDetailRows(tab, item) {
  const statusKey  = getEffectiveStatus(item);
  const statusHtml = `<span class="status-badge s-${statusKey}">${statusLabel[statusKey] || statusKey}</span>`;

  if (tab === "addDrop") {
const empName = employeesCache[item.assignedEmployee] || "-";
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

  if (tab === "complaints") {
    const compEmpName = item.assignedEmployee ? (employeesCache[item.assignedEmployee] || "-") : "-";
    const typeLabel   = item.type === "complaint" ? "شكوى" : item.type === "suggestion" ? "اقتراح" : (item.type || "-");
    return `
      <tr><td class="sp-detail-label">النوع</td><td><strong>${esc(typeLabel)}</strong></td></tr>
      <tr><td class="sp-detail-label">الموضوع</td><td>${esc(item.subject || item.title || "-")}</td></tr>
      <tr><td class="sp-detail-label">التفاصيل</td><td style="white-space:pre-wrap;">${esc(item.message || item.body || item.content || "-")}</td></tr>
      <tr><td class="sp-detail-label">تاريخ الإرسال</td><td>${formatDate(item.createdAt)}</td></tr>
      <tr><td class="sp-detail-label">الحالة</td><td>${statusHtml}</td></tr>
      <tr><td class="sp-detail-label">الموظف المعالج</td><td>${esc(compEmpName)}</td></tr>
    `;
  }

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

  // تصفية باقي طلبات الطالب بنفس الفلاتر المفعّلة حالياً
  let others = tabData[tab].filter(
    (it) => it.id !== item.id && it[cfg.studentField] === item[cfg.studentField]
  );

  // فلتر الحالة
  if (currentStatusFilter !== "all") {
    others = others.filter((it) => getEffectiveStatus(it) === currentStatusFilter);
  }

  // فلتر القسم (للزيارة والطلبات)
  if (currentDeptFilter !== "all") {
    others = others.filter((it) => {
      const student = studentsCache[it[cfg.studentField]] || {};
      return getReqDepartment(it, student) === currentDeptFilter;
    });
  }

  // فلتر القسم والمقر لطلبات الزيارة
  if (tab === "visit") {
    const deptVal  = document.getElementById("visitDeptSelect")?.value  || "";
    const placeVal = document.getElementById("visitPlaceSelect")?.value || "";
    if (deptVal) {
      const deptName = getVisitDeptName(deptVal);
      others = others.filter((it) => {
        const student = studentsCache[it[cfg.studentField]] || {};
        return (it.assignedDepartment || student.major || "") === deptName;
      });
    }
    if (placeVal) {
      const placeName = getVisitPlaceName(placeVal);
      others = others.filter((it) => (it.visitPlace || "") === placeName);
    }
  }

  others.sort((a, b) => {
    const aTime = a.createdAt?.toMillis?.() ?? 0;
    const bTime = b.createdAt?.toMillis?.() ?? 0;
    return bTime - aTime;
  });

  if (!others.length) return "";

  // لو مش addDrop: جدول واحد بدون تقسيم
  if (tab !== "addDrop") {
    const rows = others.map((o) => {
      let label = tab === "excuse"
        ? `${esc(o.courseCode || "-")} — ${examTypeLabel[o.examType] || esc(o.examType || "-")}`
        : visitTypeLabel[o.visitType] || o.visitType || "-";
      const sk = getEffectiveStatus(o);
      return `
        <tr class="sp-other-row sp-other-clickable" data-id="${o.id}" style="cursor:pointer;">
          <td>${label}</td>
          <td><span class="status-badge s-${sk}">${statusLabel[sk] || sk}</span></td>
          <td>${formatDate(o.createdAt)}</td>
          <td style="color:#1a3a6b;font-size:0.85rem;">عرض ←</td>
        </tr>`;
    }).join("");
    return `
      <div class="sp-section-title">طلبات أخرى لنفس الطالب (${others.length})</div>
      <div class="sp-table-wrap">
        <table class="sp-table sp-other-table">
          <thead><tr><th>الطلب</th><th>الحالة</th><th>التاريخ</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // addDrop: تقسيم — مواد تخصص vs مواد حرة/مشتركة
  const specRequests   = others.filter(o => o.assignedDepartment?.trim() !== "شؤون الطالبات");
  const sharedRequests = others.filter(o => o.assignedDepartment?.trim() === "شؤون الطالبات");

  // استخرج اسم قسم الطالب من الكاش
  const studentUidKey = item[cfg.studentField];
  const studentObj    = studentsCache[studentUidKey] || {};
  const studentDept   = studentObj.major || studentObj.department || "القسم";

  function buildRows(list) {
    return list.map(o => {
      const label = `${reqTypeLabel[o.requestType] || o.requestType || "-"} — ${esc(o.courseName || o.courseCode || "")}`;
      const sk    = getEffectiveStatus(o);
      return `
        <tr class="sp-other-row sp-other-clickable" data-id="${o.id}" style="cursor:pointer;">
          <td>${label}</td>
          <td><span class="status-badge s-${sk}">${statusLabel[sk] || sk}</span></td>
          <td>${formatDate(o.createdAt)}</td>
          <td style="color:#1a3a6b;font-size:0.85rem;">عرض ←</td>
        </tr>`;
    }).join("");
  }

  function buildTable({ list, icon, headerClass, titleClass, title, ownerLabel, ownerClass, countClass }) {
    if (!list.length) return "";
    const ownerTagHtml = ownerLabel
      ? `<span class="sp-other-owner-tag ${ownerClass}">
           <i class="ti ti-building" style="font-size:11px;"></i>
           ${ownerLabel}
         </span>`
      : "";
    return `
      <div class="sp-other-table-block">
        <div class="sp-other-table-header ${headerClass}">
          <i class="ti ${icon}" aria-hidden="true"></i>
          <span class="sp-other-table-title ${titleClass}">${title}</span>
          <span class="sp-other-count-badge ${countClass}">${list.length}</span>
          ${ownerTagHtml}
        </div>
        <div class="sp-table-wrap">
          <table class="sp-table sp-other-table">
            <thead><tr><th>الطلب</th><th>الحالة</th><th>التاريخ</th><th></th></tr></thead>
            <tbody>${buildRows(list)}</tbody>
          </table>
        </div>
      </div>`;
  }

  const specTable = buildTable({
    list:        specRequests,
    icon:        "ti-school",
    headerClass: "sp-other-header-spec",
    titleClass:  "sp-other-title-spec",
    title:       "مواد التخصص",
    ownerLabel:  studentDept,
    ownerClass:  "sp-other-owner-other",
    countClass:  "sp-other-count-spec",
  });

  const sharedTable = buildTable({
    list:        sharedRequests,
    icon:        "ti-layers-intersect",
    headerClass: "sp-other-header-free",
    titleClass:  "sp-other-title-free",
    title:       "المواد الحرة والمشتركة",
    ownerLabel:  "شؤون الطالبات",
    ownerClass:  "sp-other-owner-other",
    countClass:  "sp-other-count-free",
  });

  return `
    <div class="sp-section-title">طلبات أخرى لنفس الطالب (${others.length})</div>
    ${specTable}
    ${sharedTable}
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

  // عنوان فرعي يعكس الفلتر الحالي
  let subTitle = cfg.title;
  if (currentStatusFilter !== "all") {
    subTitle += ` — ${statusLabel[currentStatusFilter] || currentStatusFilter}`;
  }
  document.getElementById("spSub").textContent = subTitle;

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

  // ارتفاع اللوحة الجانبية لأعلى عند كل نقر
  const spBodyScrollEl = document.getElementById("spBody");
  if (spBodyScrollEl) spBodyScrollEl.scrollTop = 0;
}

function closeSidePanel() {
  document.getElementById("sidePanel").classList.remove("open");
  document.getElementById("spOverlay").classList.remove("show");
  document.querySelector(".admin-main").classList.remove("panel-open");
  activeRequest = null;
}

// 🔥 دالة تعرض اسم الموظف بدل الـ UID
function getEmpName(uid) {
  return employeesCache[uid]?.fullName || uid;
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

    // 🔥 أهم تعديل — نخزن الاسم ككائن وليس نص
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

function updateDashboardStats() {
  const allItems = [
    ...tabData.addDrop,
    ...tabData.excuse,
    ...tabData.visit
  ];

  const total = allItems.length;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);

  let todayCount = 0;
  let weekCount  = 0;

  let approvedCount = 0;
  let rejectedCount = 0;
  let underReviewCount = 0;

  const deptCounts = {};
  const employeeCounts = {};

  allItems.forEach((item) => {
    const created = item.createdAt && item.createdAt.toDate ? item.createdAt.toDate() : null;
    if (created) {
      if (created >= startOfToday) todayCount++;
      if (created >= startOfWeek)  weekCount++;
    }

    const status = getEffectiveStatus(item);
    if (status === "approved") approvedCount++;
    if (status === "rejected") rejectedCount++;
    if (status === "under_review") underReviewCount++;

    const cfg = tabConfig.addDrop;
    const studentUid = item[cfg.studentField] || item.uid || item.studentUid;
    const student = studentsCache[studentUid] || {};
    const dept = getReqDepartment(item, student) || "غير محدد";
    deptCounts[dept] = (deptCounts[dept] || 0) + 1;

    if (item.assignedEmployee) {
      employeeCounts[item.assignedEmployee] =
        (employeeCounts[item.assignedEmployee] || 0) + 1;
    }
  });

  const processed = approvedCount + rejectedCount;
  const acceptedRate = processed ? Math.round((approvedCount / processed) * 100) : 0;

  let topDept = "-";
  let topDeptCount = 0;
  Object.entries(deptCounts).forEach(([dept, count]) => {
    if (count > topDeptCount) {
      topDeptCount = count;
      topDept = dept;
    }
  });

  let topEmpId = null;
  let topEmpCount = 0;
  Object.entries(employeeCounts).forEach(([uid, count]) => {
    if (count > topEmpCount) {
      topEmpCount = count;
      topEmpId = uid;
    }
  });

  // 🔥 تعديل عرض اسم الموظف
 const topEmpName = employeesCache[topEmpId] || topEmpId;


  document.getElementById("dash-total-requests").textContent      = total;
  document.getElementById("dash-today-requests").textContent      = todayCount;
  document.getElementById("dash-week-requests").textContent       = weekCount;
  document.getElementById("dash-accepted-rate").textContent       = acceptedRate + "%";
  document.getElementById("dash-top-dept").textContent            = topDept;
  document.getElementById("dash-top-dept-count").textContent      = topDeptCount + " طلب";
  document.getElementById("dash-top-employee").textContent        = topEmpName;
  document.getElementById("dash-top-employee-count").textContent  = topEmpCount + " طلب";
  document.getElementById("dash-under-review").textContent        = underReviewCount;
  document.getElementById("dash-rejected").textContent            = rejectedCount;
}

let chartRequestsByDay = null;
let chartRequestsByDept = null;
let chartRequestsByEmployee = null;

function buildCharts() {
  const allItems = [
    ...tabData.addDrop,
    ...tabData.excuse,
    ...tabData.visit
  ];

  const daysMap = {};
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = d.toLocaleDateString("ar-SA-u-ca-gregory");
    daysMap[key] = 0;
  }

  allItems.forEach((item) => {
    const created = item.createdAt && item.createdAt.toDate ? item.createdAt.toDate() : null;
    if (!created) return;
    const key = created.toLocaleDateString("ar-SA-u-ca-gregory");
    if (key in daysMap) {
      daysMap[key]++;
    }
  });

  const dayLabels = Object.keys(daysMap);
  const dayValues = Object.values(daysMap);

  const ctxDay = document.getElementById("chartRequestsByDay").getContext("2d");
  if (chartRequestsByDay) chartRequestsByDay.destroy();
  chartRequestsByDay = new Chart(ctxDay, {
    type: "line",
    data: {
      labels: dayLabels,
      datasets: [{
        label: "عدد الطلبات",
        data: dayValues,
        borderColor: "#1a3a6b",
        backgroundColor: "rgba(26,58,107,0.12)",
        tension: 0.3,
        fill: true,
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 6 } },
        y: { beginAtZero: true }
      }
    }
  });

  // ===== 2) توزيع الطلبات حسب الأقسام - يعرض كل الأقسام دائماً ويبرز المختار =====
  const allItemsForDept = [...tabData.addDrop, ...tabData.excuse, ...tabData.visit];
  const deptCounts = {};
  allItemsForDept.forEach((item) => {
    const cfg = tabConfig.addDrop;
    const studentUid = item[cfg.studentField] || item.uid || item.studentUid;
    const student = studentsCache[studentUid] || {};
    const dept = getReqDepartment(item, student) || "غير محدد";
    deptCounts[dept] = (deptCounts[dept] || 0) + 1;
  });

  const deptLabels = Object.keys(deptCounts);
  const deptValues = Object.values(deptCounts);
  // تلوين القسم المختار بذهبي والباقي بأزرق فاتح
  const deptColors = deptLabels.map((d) =>
    currentStatsDeptFilter === "all" || d === currentStatsDeptFilter ? "#c8972b" : "rgba(200,151,43,0.25)"
  );

  const ctxDept = document.getElementById("chartRequestsByDept").getContext("2d");
  if (chartRequestsByDept) chartRequestsByDept.destroy();
  chartRequestsByDept = new Chart(ctxDept, {
    type: "bar",
    data: {
      labels: deptLabels,
      datasets: [{ label: "عدد الطلبات", data: deptValues, backgroundColor: deptColors }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { autoSkip: false } }, y: { beginAtZero: true } }
    }
  });

  const employeeCounts = {};
  allItems.forEach((item) => {
    if (item.assignedEmployee) {
      employeeCounts[item.assignedEmployee] =
        (employeeCounts[item.assignedEmployee] || 0) + 1;
    }
  });

  // 🔥 تعديل عرض أسماء الموظفين في الرسم البياني
  const empLabels = Object.keys(employeeCounts).map(uid => employeesCache[uid] || uid);


  const empValues = Object.values(employeeCounts);

  const ctxEmp = document.getElementById("chartRequestsByEmployee").getContext("2d");
  if (chartRequestsByEmployee) chartRequestsByEmployee.destroy();
  chartRequestsByEmployee = new Chart(ctxEmp, {
    type: "bar",
    data: {
      labels: empLabels,
      datasets: [{
        label: "عدد الطلبات المعالجة",
        data: empValues,
        backgroundColor: "#1a3a6b",
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { autoSkip: false } },
        y: { beginAtZero: true }
      }
    }
  });
}
// ==================== الطباعة ====================

function printActiveStudent() {
  if (!activeRequest) return;
  const { tab, item } = activeRequest;
  const cfg     = tabConfig[tab];
  const student = studentsCache[item[cfg.studentField]] || {};

  // طلبات الطالب مفلترة بنفس الفلاتر الحالية
  let items = tabData[tab].filter((it) => it[cfg.studentField] === item[cfg.studentField]);

  if (currentStatusFilter !== "all") {
    items = items.filter((it) => getEffectiveStatus(it) === currentStatusFilter);
  }
  if (currentDeptFilter !== "all") {
    items = items.filter((it) => {
      const st = studentsCache[it[cfg.studentField]] || {};
      return getReqDepartment(it, st) === currentDeptFilter;
    });
  }
  // فلتر القسم والمقر لطلبات الزيارة
  if (tab === "visit") {
    const deptVal  = document.getElementById("visitDeptSelect")?.value  || "";
    const placeVal = document.getElementById("visitPlaceSelect")?.value || "";
    if (deptVal) {
      const deptName = getVisitDeptName(deptVal);
      items = items.filter((it) => {
        const st = studentsCache[it[cfg.studentField]] || {};
        return (it.assignedDepartment || st.major || "") === deptName;
      });
    }
    if (placeVal) {
      const placeName = getVisitPlaceName(placeVal);
      items = items.filter((it) => (it.visitPlace || "") === placeName);
    }
  }

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

// ==================== فلترة الأقسام في صفحة الإحصائيات ====================

let currentStatsDeptFilter = "all";

function renderDeptFilterForStats() {
  const allItems = [...tabData.addDrop, ...tabData.excuse, ...tabData.visit];

  // استخراج قائمة الأقسام الموجودة فعلاً
  const depts = new Set();
  allItems.forEach((item) => {
    const cfg = tabConfig.addDrop;
    const studentUid = item[cfg.studentField] || item.uid || item.studentUid;
    const student = studentsCache[studentUid] || {};
    const dept = getReqDepartment(item, student);
    if (dept) depts.add(dept);
  });

  // بناء شريط الفلترة إذا لم يكن موجوداً
  let filterBar = document.getElementById("statsDeptFilterBar");
  if (!filterBar) {
    filterBar = document.createElement("div");
    filterBar.id = "statsDeptFilterBar";
    filterBar.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px;align-items:center;";
    // إدراجه في بداية dashboardSection
    const dashSec = document.getElementById("dashboardSection");
    if (dashSec) dashSec.insertBefore(filterBar, dashSec.firstChild);
  }

  const deptList = ["all", ...depts];
  filterBar.innerHTML = deptList.map((d) => `
    <button class="stats-dept-pill ${currentStatsDeptFilter === d ? "active" : ""}"
      data-dept="${d}"
      style="padding:7px 16px;border-radius:20px;border:2px solid ${currentStatsDeptFilter === d ? "#1a3a6b" : "#ddd"};
             background:${currentStatsDeptFilter === d ? "#1a3a6b" : "#fff"};
             color:${currentStatsDeptFilter === d ? "#fff" : "#333"};
             cursor:pointer;font-family:inherit;font-size:13px;transition:all 0.2s;">
      ${d === "all" ? "كل الأقسام" : d}
    </button>
  `).join("");

  filterBar.querySelectorAll(".stats-dept-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentStatsDeptFilter = btn.dataset.dept;
      renderDeptFilterForStats();
      updateDashboardStatsFiltered();
      buildChartsFiltered();
    });
  });

  filterBar.style.display = "";
}

function getFilteredStatsItems() {
  const allItems = [...tabData.addDrop, ...tabData.excuse, ...tabData.visit];
  if (currentStatsDeptFilter === "all") return allItems;
  return allItems.filter((item) => {
    const cfg = tabConfig.addDrop;
    const studentUid = item[cfg.studentField] || item.uid || item.studentUid;
    const student = studentsCache[studentUid] || {};
    const dept = getReqDepartment(item, student);
    return dept === currentStatsDeptFilter;
  });
}

function updateDashboardStatsFiltered() {
  const allItems = getFilteredStatsItems();
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);

  let todayCount = 0, weekCount = 0, approvedCount = 0, rejectedCount = 0, underReviewCount = 0;
  const deptCounts = {}, employeeCounts = {};

  allItems.forEach((item) => {
    const created = item.createdAt && item.createdAt.toDate ? item.createdAt.toDate() : null;
    if (created) {
      if (created >= startOfToday) todayCount++;
      if (created >= startOfWeek) weekCount++;
    }
    const status = getEffectiveStatus(item);
    if (status === "approved") approvedCount++;
    if (status === "rejected") rejectedCount++;
    if (status === "under_review") underReviewCount++;

    const cfg = tabConfig.addDrop;
    const studentUid = item[cfg.studentField] || item.uid || item.studentUid;
    const student = studentsCache[studentUid] || {};
    const dept = getReqDepartment(item, student) || "غير محدد";
    deptCounts[dept] = (deptCounts[dept] || 0) + 1;

    if (item.assignedEmployee) {
      employeeCounts[item.assignedEmployee] = (employeeCounts[item.assignedEmployee] || 0) + 1;
    }
  });

  const processed = approvedCount + rejectedCount;
  const acceptedRate = processed ? Math.round((approvedCount / processed) * 100) : 0;

  let topDept = "-", topDeptCount = 0;
  Object.entries(deptCounts).forEach(([dept, count]) => {
    if (count > topDeptCount) { topDeptCount = count; topDept = dept; }
  });

  let topEmpId = null, topEmpCount = 0;
  Object.entries(employeeCounts).forEach(([uid, count]) => {
    if (count > topEmpCount) { topEmpCount = count; topEmpId = uid; }
  });
  const topEmpName = topEmpId ? (employeesCache[topEmpId] || topEmpId) : "-";

  document.getElementById("dash-total-requests").textContent     = allItems.length;
  document.getElementById("dash-today-requests").textContent     = todayCount;
  document.getElementById("dash-week-requests").textContent      = weekCount;
  document.getElementById("dash-accepted-rate").textContent      = acceptedRate + "%";
  document.getElementById("dash-top-dept").textContent           = topDept;
  document.getElementById("dash-top-dept-count").textContent     = topDeptCount + " طلب";
  document.getElementById("dash-top-employee").textContent       = topEmpName;
  document.getElementById("dash-top-employee-count").textContent = topEmpCount + " طلب";
  document.getElementById("dash-under-review").textContent       = underReviewCount;
  document.getElementById("dash-rejected").textContent           = rejectedCount;
}

function buildChartsFiltered() {
  const allItems = getFilteredStatsItems();

  // ===== 1) آخر 30 يوم =====
  const daysMap = {};
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    daysMap[d.toLocaleDateString("ar-SA-u-ca-gregory")] = 0;
  }
  allItems.forEach((item) => {
    const created = item.createdAt && item.createdAt.toDate ? item.createdAt.toDate() : null;
    if (!created) return;
    const key = created.toLocaleDateString("ar-SA-u-ca-gregory");
    if (key in daysMap) daysMap[key]++;
  });

  const ctxDay = document.getElementById("chartRequestsByDay").getContext("2d");
  if (chartRequestsByDay) chartRequestsByDay.destroy();
  chartRequestsByDay = new Chart(ctxDay, {
    type: "line",
    data: {
      labels: Object.keys(daysMap),
      datasets: [{ label: "عدد الطلبات", data: Object.values(daysMap), borderColor: "#1a3a6b", backgroundColor: "rgba(26,58,107,0.12)", tension: 0.3, fill: true }]
    },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 6 } }, y: { beginAtZero: true } } }
  });

  // ===== 2) حسب الأقسام =====
  const deptCounts = {};
  allItems.forEach((item) => {
    const cfg = tabConfig.addDrop;
    const studentUid = item[cfg.studentField] || item.uid || item.studentUid;
    const student = studentsCache[studentUid] || {};
    const dept = getReqDepartment(item, student) || "غير محدد";
    deptCounts[dept] = (deptCounts[dept] || 0) + 1;
  });

  const ctxDept = document.getElementById("chartRequestsByDept").getContext("2d");
  if (chartRequestsByDept) chartRequestsByDept.destroy();
  chartRequestsByDept = new Chart(ctxDept, {
    type: "bar",
    data: { labels: Object.keys(deptCounts), datasets: [{ label: "عدد الطلبات", data: Object.values(deptCounts), backgroundColor: "#c8972b" }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { autoSkip: false } }, y: { beginAtZero: true } } }
  });

  // ===== 3) أداء الموظفين =====
  const employeeCounts = {};
  allItems.forEach((item) => {
    if (item.assignedEmployee) employeeCounts[item.assignedEmployee] = (employeeCounts[item.assignedEmployee] || 0) + 1;
  });

  const ctxEmp = document.getElementById("chartRequestsByEmployee").getContext("2d");
  if (chartRequestsByEmployee) chartRequestsByEmployee.destroy();
  chartRequestsByEmployee = new Chart(ctxEmp, {
    type: "bar",
    data: { labels: Object.keys(employeeCounts).map((uid) => employeesCache[uid] || uid), datasets: [{ label: "عدد الطلبات المعالجة", data: Object.values(employeeCounts), backgroundColor: "#1a3a6b" }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { autoSkip: false } }, y: { beginAtZero: true } } }
  });
}



function getVisitDeptName(dept) {
  const names = {
    physics: "فيزياء",
    chemistry: "كيمياء",
    statistics: "إحصاء",
    math: "رياضيات",
    biology: "أحياء"
  };
  return names[dept] || dept;
}

function getVisitPlaceName(place) {
  const names = {
    badaya: "البدايع",
    unaizah: "عنيزة",
    rass: "الرس",
    asyah: "الاسياح",
    bukayriyah: "البكيرية",
    riyadh_alkhabra: "رياض الخبراء",
    mithnab: "المذنب",
    uqlat_suqur: "عقلة صقور",
    nihaniyah: "النيهانية"
  };
  return names[place] || place;
}

function getVisitFormInfo(dept, place) {

  if (!dept || !place) return null;

  return {
    docId: `visitForm_${dept}_${place}`,
    path: `visitForms/${dept}_${place}.pdf`,
    name: `${getVisitDeptName(dept)} - ${getVisitPlaceName(place)}`
  };
}
const visitFormDocRef = () => doc(db, "settings", "visitForm");

async function loadVisitFormInfo() {

  const deptSelect  = document.getElementById("visitDeptSelect");
  const placeSelect = document.getElementById("visitPlaceSelect");
  const nameEl = document.getElementById("uploadedFileName");

  if (!deptSelect || !placeSelect || !nameEl) return;

  const dept  = deptSelect.value;
  const place = placeSelect.value;

  if (!dept || !place) {
    nameEl.innerHTML =
      `<span style="color:#888">اختاري القسم والمقر أولاً</span>`;
    return;
  }

  const info = getVisitFormInfo(dept, place);

  try {

    const snap = await getDoc(
      doc(db, "settings", info.docId)
    );

    if (snap.exists()) {

      const data = snap.data();

      nameEl.innerHTML = `
        <span style="
          display:inline-flex;
          align-items:center;
          gap:6px;
          background:#eef3ff;
          border-radius:8px;
          padding:5px 10px;
        ">
          📄 ${data.fileName}

          <button
            id="removeVisitFileBtn"
            style="
              border:none;
              background:none;
              cursor:pointer;
              color:red;
            ">
            🗑
          </button>
        </span>
      `;

      document
        .getElementById("removeVisitFileBtn")
        ?.addEventListener("click", () =>
          removeVisitForm(dept, place)
        );

    } else {

      nameEl.innerHTML =
        `<span style="color:#888">لا يوجد ملف مرفوع لهذا القسم والمقر</span>`;
    }

  } catch (err) {

    console.error(err);

    nameEl.innerHTML =
      `<span style="color:red">تعذر تحميل الملف</span>`;
  }
}

async function uploadVisitForm(file) {

  const dept  = document.getElementById("visitDeptSelect").value;
  const place = document.getElementById("visitPlaceSelect").value;

  if (!dept || !place) {
    alert("اختاري القسم والمقر أولاً");
    return;
  }

  if (file.type !== "application/pdf") {
    alert("يسمح بملفات PDF فقط");
    return;
  }

  const info = getVisitFormInfo(dept, place);

  try {

    const storageRef =
      ref(storage, info.path);

    await uploadBytes(storageRef, file);

    const fileUrl =
      await getDownloadURL(storageRef);

    await setDoc(
      doc(db, "settings", info.docId),
      {
        department: dept,
        place,
        fileName: file.name,
        fileUrl,
        uploadedAt: serverTimestamp(),
        uploadedBy:
          currentAdminData?.fullName || "الأدمن"
      }
    );

    alert(`تم رفع نموذج ${info.name} بنجاح`);

    loadVisitFormInfo();

  } catch (err) {

    console.error(err);

    alert("فشل رفع الملف");
  }
}

async function removeVisitForm(dept, place) {

  if (!confirm("هل تريدين حذف الملف؟"))
    return;

  const info = getVisitFormInfo(dept, place);

  try {

    await deleteObject(
      ref(storage, info.path)
    ).catch(() => {});

    await deleteDoc(
      doc(db, "settings", info.docId)
    );

    loadVisitFormInfo();

  } catch (err) {

    console.error(err);

    alert("تعذر حذف الملف");
  }
}

const uploadVisitFileBtnEl = document.getElementById("uploadVisitFileBtn");
const visitFileInputEl     = document.getElementById("visitFileInput");
document
  .getElementById("visitDeptSelect")
  ?.addEventListener("change", () => {
      loadVisitFormInfo();
  });
document
  .getElementById("visitPlaceSelect")
  ?.addEventListener("change", () => {
      loadVisitFormInfo();
  });

if (uploadVisitFileBtnEl && visitFileInputEl) {
  uploadVisitFileBtnEl.addEventListener("click", () => visitFileInputEl.click());

  visitFileInputEl.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) uploadVisitForm(file);
    e.target.value = "";
  });
}

// ==================== نقل صلاحية الأدمن ====================
// نستخدم تطبيق Firebase ثانوي (Secondary App) بنفس الكونفق، عشان إنشاء
// حساب Auth جديد لا يؤثر على جلسة الأدمن الحالي (Firebase تلقائياً يسجّل
// دخول بآخر حساب يتم إنشاؤه إذا استخدمنا نفس instance الأساسي).
const firebaseConfigForTransfer = {
  apiKey: "AIzaSyDg4iYMZEdc8pjJU67KtXbSvhBaqdoP0iA",
  authDomain: "studentsreq-d9ea1.firebaseapp.com",
  projectId: "studentsreq-d9ea1",
  storageBucket: "studentsreq-d9ea1.firebasestorage.app",
  messagingSenderId: "375395162945",
  appId: "1:375395162945:web:e3edb97c48a30ab6401fc0"
};

async function createAdminAccountSafely(email, password) {
  // اسم فريد لتجنب تعارض مع أي instance ثانوي آخر مفتوح بنفس الجلسة
  const secondaryApp = initializeApp(firebaseConfigForTransfer, "secondary-" + Date.now());
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    return cred.user.uid;
  } finally {
    await deleteApp(secondaryApp).catch(() => {});
  }
}

function openTransferModal() {
  const overlayEl = document.getElementById("transferAdminOverlay");
  const modalEl   = document.getElementById("transferAdminModal");
  const errorEl   = document.getElementById("ta_error");
  const formEl    = document.getElementById("transferAdminForm");
  if (!overlayEl || !modalEl) return;
  overlayEl.style.display = "block";
  modalEl.style.display   = "block";
  if (errorEl) errorEl.style.display = "none";
  if (formEl) formEl.reset();
}

function closeTransferModal() {
  const overlayEl = document.getElementById("transferAdminOverlay");
  const modalEl   = document.getElementById("transferAdminModal");
  if (overlayEl) overlayEl.style.display = "none";
  if (modalEl)   modalEl.style.display   = "none";
}

async function handleTransferAdmin(e) {
  e.preventDefault();

  const fullName       = document.getElementById("ta_fullName").value.trim();
  const phone          = document.getElementById("ta_phone").value.trim();
  const employeeNumber = document.getElementById("ta_employeeNumber").value.trim();
  const email          = document.getElementById("ta_email").value.trim();
  const password       = document.getElementById("ta_password").value;

  const errorEl   = document.getElementById("ta_error");
  const submitBtn = document.getElementById("ta_submitBtn");

  errorEl.style.display = "none";
  submitBtn.disabled = true;
  submitBtn.textContent = "جارٍ التنفيذ...";

  try {
    let newUid;
    let employeeAlreadyExists = false;

    // البحث عن موظف موجود بنفس الإيميل
    const dupEmailQ = query(
      collection(db, "employees"),
      where("email", "==", email)
    );
    const dupEmailSnap = await getDocs(dupEmailQ);

    if (!dupEmailSnap.empty) {

      // الموظف موجود مسبقاً → نرقّيه لأدمن فقط (بدون إنشاء حساب جديد)
      employeeAlreadyExists = true;
      const existingDoc = dupEmailSnap.docs[0];
      newUid = existingDoc.id;

      await updateDoc(doc(db, "employees", newUid), {
        isAdmin: true,
        adminGrantedAt: serverTimestamp()
      });

    } else {

      // تأكد ما يوجد رقم وظيفي مكرر قبل إنشاء حساب جديد
      const dupEmpNumQ = query(collection(db, "employees"), where("employeeNumber", "==", employeeNumber));
      const dupEmpNumSnap = await getDocs(dupEmpNumQ);
      if (!dupEmpNumSnap.empty) {
        throw new Error("هذا الرقم الوظيفي مستخدم لموظف آخر بالفعل");
      }

      // إنشاء حساب Auth جديد بدون كسر جلسة الأدمن الحالي
      newUid = await createAdminAccountSafely(email, password);

      await setDoc(doc(db, "employees", newUid), {
        fullName,
        phone,
        employeeNumber,
        email,
        isAdmin: true,
        createdAt: serverTimestamp(),
        createdVia: "transferAdmin"
      });
    }

    // مزامنة adminUids (تستخدمها قواعد الأمان)
    await setDoc(doc(db, "adminUids", newUid), { isAdmin: true, email }, { merge: true });

    // سحب صلاحية الأدمن الحالي
    if (currentAdminData?.docId) {
      await updateDoc(doc(db, "employees", currentAdminData.docId), {
        isAdmin: false,
        adminRevokedAt: serverTimestamp()
      });
      await deleteDoc(doc(db, "adminUids", currentAdminData.uid)).catch(() => {});
    }

    // تسجيل عملية النقل بسجل تاريخي
    await setDoc(doc(collection(db, "adminTransferLogs")), {
      fromAdminId:      currentAdminData?.docId || null,
      fromAdminName:    currentAdminData?.fullName || null,
      toAdminId:        newUid,
      toAdminName:      fullName,
      toEmployeeNumber: employeeNumber,
      transferredAt:    serverTimestamp()
    });

    if (employeeAlreadyExists) {
      alert(`تم نقل صلاحية الأدمن إلى الموظف الموجود مسبقاً "${fullName}" بنجاح`);
    } else {
      alert(`تم نقل صلاحية الأدمن إلى "${fullName}" بنجاح.\n\nالإيميل: ${email}\nكلمة المرور: ${password}`);
    }

    closeTransferModal();

    await signOut(auth);
    window.location.href = "EmployeeLogin.html";

  } catch (err) {
    console.error("Transfer admin error:", err);
    let msg = err.message || "حدث خطأ غير متوقع";
    if (err.code === "auth/email-already-in-use") msg = "هذا البريد الإلكتروني مستخدم مسبقاً في نظام الدخول";
    if (err.code === "auth/weak-password")         msg = "كلمة المرور ضعيفة جداً";
    if (err.code === "auth/invalid-email")         msg = "صيغة البريد الإلكتروني غير صحيحة";
    errorEl.textContent = msg;
    errorEl.style.display = "block";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "تأكيد ونقل الصلاحية";
  }
}

document.getElementById("transferAdminBtn")?.addEventListener("click", openTransferModal);
document.getElementById("ta_cancelBtn")?.addEventListener("click", closeTransferModal);
document.getElementById("transferAdminForm")?.addEventListener("submit", handleTransferAdmin);

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

    // إعادة إظهار الجدول ومنطقة البحث (قد تكون اختفت عند فتح الإحصائيات أو الفصل)
    const tableWrapEl2 = document.getElementById("tableWrap");
    if (tableWrapEl2) tableWrapEl2.style.display = "";
    const searchRowEl = document.querySelector(".admin-search-row");
    if (searchRowEl) searchRowEl.style.display = "";

    // إخفاء فلتر أقسام الإحصائيات
    const filterBar = document.getElementById("statsDeptFilterBar");
    if (filterBar) filterBar.style.display = "none";

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

    // إخفاء فلتر الأقسام في تبويبي الأعذار والزيارة (لا علاقة لهم بالقسم)
    const deptFilterWrapEl = document.getElementById("deptFilterWrap");
    if (deptFilterWrapEl) {
      deptFilterWrapEl.style.display = currentTab === "addDrop" ? "" : "none";
      if (currentTab !== "addDrop") {
        currentDeptFilter = "all";
      }
    }

    // إخفاء قسم إدارة الفصل الدراسي عند فتح أي تبويب طلبات
    const semesterSectionEl = document.getElementById("semesterSection");
    if (semesterSectionEl) semesterSectionEl.style.display = "none";

    // إخفاء قسم الإحصائيات
    const dashboardSectionEl = document.getElementById("dashboardSection");
    if (dashboardSectionEl) dashboardSectionEl.style.display = "none";

    // إظهار كاردات الفلتر (الكل / جديد / قيد المراجعة / مقبول / مرفوض)
    const statsGridEl = document.querySelector(".admin-stats-grid");
    if (statsGridEl) statsGridEl.style.display = "";

    // تفعيل لون التبويب في السايد بانل
    document.querySelectorAll(".sb-nav-item").forEach((i) => i.classList.remove("active"));
    btn.classList.add("active");

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

// ==================== تصدير Excel الأعذار ====================

async function exportExcusesToExcel() {
  const cfg   = tabConfig["excuse"];
  const items = [...tabData.excuse];

  if (!items.length) {
    alert("لا توجد بيانات أعذار للتصدير.");
    return;
  }

  // جلب بيانات أي طالبة غير موجودة في الكاش
  const missingUids = [...new Set(
    items.map(it => it[cfg.studentField]).filter(uid => uid && !studentsCache[uid])
  )];
  if (missingUids.length) {
    await Promise.all(missingUids.map(uid => getStudent(uid)));
  }

  // تحميل مكتبة SheetJS إن لم تكن محملة
  if (!window.XLSX) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
      s.onload  = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // كل طلب = صف — كل عمود في خانته المستقلة
  const data = [
    ["الرقم الجامعي", "اسم الطالبة", "التخصص", "نوع الاختبار", "اسم المقرر", "تاريخ الغياب", "الحالة"]
  ];

  items.forEach(r => {
    const student   = studentsCache[r[cfg.studentField]] || {};
    const statusKey = getEffectiveStatus(r);
    data.push([
      student.studentId  || student.universityId || "-",
      student.fullName   || "-",
      student.major      || student.department   || "-",
      examTypeLabel[r.examType] || r.examType    || "-",
      r.courseName       || r.courseCode         || "-",
      r.absenceDate      || r.examDate           || "-",
      statusLabel[statusKey]    || statusKey
    ]);
  });

  const ws = window.XLSX.utils.aoa_to_sheet(data);

  // عرض مناسب للأعمدة
  ws["!cols"] = [
    { wch: 16 }, // الرقم الجامعي
    { wch: 26 }, // اسم الطالبة
    { wch: 14 }, // التخصص
    { wch: 22 }, // نوع الاختبار
    { wch: 28 }, // اسم المقرر
    { wch: 16 }, // تاريخ الغياب
    { wch: 14 }, // الحالة
  ];

  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "طلبات الأعذار");

  const today = new Date().toLocaleDateString("ar-SA-u-ca-gregory").replace(/\//g, "-");
  window.XLSX.writeFile(wb, `طلبات_الأعذار_${today}.xlsx`);
}

// ربط زر التصدير
const exportExcuseBtn = document.getElementById("exportExcuseExcelBtn");
if (exportExcuseBtn) {
  exportExcuseBtn.addEventListener("click", async () => {
    exportExcuseBtn.disabled = true;
    exportExcuseBtn.innerHTML = '<i class="ti ti-loader-2 spin"></i> جاري التصدير...';
    try {
      await exportExcusesToExcel();
    } finally {
      exportExcuseBtn.disabled = false;
      exportExcuseBtn.innerHTML = '<i class="ti ti-file-spreadsheet"></i> تصدير Excel';
    }
  });
}

// ==================== فلاتر الأعذار الإضافية ====================

document.getElementById("excuseDeptFilter")?.addEventListener("change", (e) => {
  currentExcuseDept = e.target.value;
  renderTab();
});

document.getElementById("excuseExamTypeFilter")?.addEventListener("change", (e) => {
  currentExcuseExamType = e.target.value;
  renderTab();
});

document.getElementById("excuseStatusExportFilter")?.addEventListener("change", (e) => {
  currentExcuseStatus = e.target.value;
  renderTab();
});

document.getElementById("spCloseBtn").addEventListener("click", closeSidePanel);
document.getElementById("spOverlay").addEventListener("click", closeSidePanel);
document.getElementById("spPrintBtn").addEventListener("click", printActiveStudent);

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "EmployeeLogin.html";
});
document.getElementById("taCloseBtn")?.addEventListener("click", closeTransferModal);

document.getElementById("transferAdminOverlay")?.addEventListener("click", closeTransferModal);

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
// ====== عرض صفحة الإحصائيات ======

const navStats = document.getElementById("navStats");
const dashboardSection = document.getElementById("dashboardSection");
const statsGrid = document.querySelector(".admin-stats-grid");
const semesterSection = document.getElementById("semesterSection");
const navSemester = document.getElementById("navSemester");

// 🔥 دالة تعرض اسم الموظف بدل الـ UID
function getEmpName(uid) {
  return employeesCache[uid]?.fullName || uid;
}

// إظهار الإحصائيات
navStats.addEventListener("click", () => {
  dashboardSection.style.display = "";
  statsGrid.style.display = "none";   // إخفاء فلاتر الحالة
  if (semesterSection) semesterSection.style.display = "none";

  // إخفاء منطقة البحث والجدول
  const searchRowEl = document.querySelector(".admin-search-row");
  if (searchRowEl) searchRowEl.style.display = "none";
  const tableWrapEl2 = document.getElementById("tableWrap");
  if (tableWrapEl2) tableWrapEl2.style.display = "none";
  const loadingEl2 = document.getElementById("loadingState");
  if (loadingEl2) loadingEl2.style.display = "none";
  const visitUploadAreaEl = document.getElementById("visitUploadArea");
  if (visitUploadAreaEl) visitUploadAreaEl.style.display = "none";

  setActiveSidebarItem("navStats");
  renderDeptFilterForStats();
});

// إظهار قسم إدارة الفصل الدراسي
if (navSemester) {
  navSemester.addEventListener("click", async () => {
    dashboardSection.style.display = "none";
    statsGrid.style.display = "none";   // إخفاء فلاتر الحالة
    if (semesterSection) semesterSection.style.display = "";

    // إخفاء منطقة البحث والجدول
    const searchRowEl = document.querySelector(".admin-search-row");
    if (searchRowEl) searchRowEl.style.display = "none";
    const tableWrapEl2 = document.getElementById("tableWrap");
    if (tableWrapEl2) tableWrapEl2.style.display = "none";
    const loadingEl2 = document.getElementById("loadingState");
    if (loadingEl2) loadingEl2.style.display = "none";
    const visitUploadAreaEl = document.getElementById("visitUploadArea");
    if (visitUploadAreaEl) visitUploadAreaEl.style.display = "none";

    setActiveSidebarItem("navSemester");
    await loadSemesterInfo();
  });
}

// ملاحظة: handler التبويبات الرئيسي موجود في قسم "أحداث الواجهة" أعلاه

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

    // 🔥 أهم تعديل — نخزن الاسم ككائن وليس نص
    employeesCache[currentAdminData.docId] = {
      fullName: currentAdminData.fullName || "الأدمن"
    };

    updateBadges();
    await renderTab();
    openSidePanel(tab, item);
  } catch (err) {
    console.error(err);
    alert("حدث خطأ: " + err.message);
    buttons.forEach((b) => (b.disabled = false));
  }
}

function updateDashboardStats() {
  const allItems = [
    ...tabData.addDrop,
    ...tabData.excuse,
    ...tabData.visit
  ];

  const total = allItems.length;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);

  let todayCount = 0;
  let weekCount  = 0;

  let approvedCount = 0;
  let rejectedCount = 0;
  let underReviewCount = 0;

  const deptCounts = {};
  const employeeCounts = {};

  allItems.forEach((item) => {
    const created = item.createdAt && item.createdAt.toDate ? item.createdAt.toDate() : null;
    if (created) {
      if (created >= startOfToday) todayCount++;
      if (created >= startOfWeek)  weekCount++;
    }

    const status = getEffectiveStatus(item);
    if (status === "approved") approvedCount++;
    if (status === "rejected") rejectedCount++;
    if (status === "under_review") underReviewCount++;

    const cfg = tabConfig.addDrop;
    const studentUid = item[cfg.studentField] || item.uid || item.studentUid;
    const student = studentsCache[studentUid] || {};
    const dept = getReqDepartment(item, student) || "غير محدد";
    deptCounts[dept] = (deptCounts[dept] || 0) + 1;

    if (item.assignedEmployee) {
      employeeCounts[item.assignedEmployee] =
        (employeeCounts[item.assignedEmployee] || 0) + 1;
    }
  });

  const processed = approvedCount + rejectedCount;
  const acceptedRate = processed ? Math.round((approvedCount / processed) * 100) : 0;

  let topDept = "-";
  let topDeptCount = 0;
  Object.entries(deptCounts).forEach(([dept, count]) => {
    if (count > topDeptCount) {
      topDeptCount = count;
      topDept = dept;
    }
  });

  let topEmpId = null;
  let topEmpCount = 0;
  Object.entries(employeeCounts).forEach(([uid, count]) => {
    if (count > topEmpCount) {
      topEmpCount = count;
      topEmpId = uid;
    }
  });

  // 🔥 تعديل عرض اسم الموظف
  const topEmpName = topEmpId
    ? (employeesCache[topEmpId]?.fullName || topEmpId)
    : "-";

  document.getElementById("dash-total-requests").textContent      = total;
  document.getElementById("dash-today-requests").textContent      = todayCount;
  document.getElementById("dash-week-requests").textContent       = weekCount;
  document.getElementById("dash-accepted-rate").textContent       = acceptedRate + "%";
  document.getElementById("dash-top-dept").textContent            = topDept;
  document.getElementById("dash-top-dept-count").textContent      = topDeptCount + " طلب";
  document.getElementById("dash-top-employee").textContent        = topEmpName;
  document.getElementById("dash-top-employee-count").textContent  = topEmpCount + " طلب";
  document.getElementById("dash-under-review").textContent        = underReviewCount;
  document.getElementById("dash-rejected").textContent            = rejectedCount;
}

let chartRequestsByDay = null;
let chartRequestsByDept = null;
let chartRequestsByEmployee = null;

function buildCharts() {
  const allItems = [
    ...tabData.addDrop,
    ...tabData.excuse,
    ...tabData.visit
  ];

  const daysMap = {};
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = d.toLocaleDateString("ar-SA-u-ca-gregory");
    daysMap[key] = 0;
  }

  allItems.forEach((item) => {
    const created = item.createdAt && item.createdAt.toDate ? item.createdAt.toDate() : null;
    if (!created) return;
    const key = created.toLocaleDateString("ar-SA-u-ca-gregory");
    if (key in daysMap) {
      daysMap[key]++;
    }
  });

  const dayLabels = Object.keys(daysMap);
  const dayValues = Object.values(daysMap);

  const ctxDay = document.getElementById("chartRequestsByDay").getContext("2d");
  if (chartRequestsByDay) chartRequestsByDay.destroy();
  chartRequestsByDay = new Chart(ctxDay, {
    type: "line",
    data: {
      labels: dayLabels,
      datasets: [{
        label: "عدد الطلبات",
        data: dayValues,
        borderColor: "#1a3a6b",
        backgroundColor: "rgba(26,58,107,0.12)",
        tension: 0.3,
        fill: true,
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 6 } },
        y: { beginAtZero: true }
      }
    }
  });

  const deptCounts = {};
  allItems.forEach((item) => {
    const cfg = tabConfig.addDrop;
    const studentUid = item[cfg.studentField] || item.uid || item.studentUid;
    const student = studentsCache[studentUid] || {};
    const dept = getReqDepartment(item, student) || "غير محدد";
    deptCounts[dept] = (deptCounts[dept] || 0) + 1;
  });

  const deptLabels = Object.keys(deptCounts);
  const deptValues = Object.values(deptCounts);

  const ctxDept = document.getElementById("chartRequestsByDept").getContext("2d");
  if (chartRequestsByDept) chartRequestsByDept.destroy();
  chartRequestsByDept = new Chart(ctxDept, {
    type: "bar",
    data: {
      labels: deptLabels,
      datasets: [{
        label: "عدد الطلبات",
        data: deptValues,
        backgroundColor: "#c8972b",
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { autoSkip: false } },
        y: { beginAtZero: true }
      }
    }
  });

  const employeeCounts = {};
  allItems.forEach((item) => {
    if (item.assignedEmployee) {
      employeeCounts[item.assignedEmployee] =
        (employeeCounts[item.assignedEmployee] || 0) + 1;
    }
  });

  // 🔥 تعديل عرض أسماء الموظفين في الرسم البياني
  const empLabels = Object.keys(employeeCounts).map((uid) => {
    return employeesCache[uid]?.fullName || uid;
  });

  const empValues = Object.values(employeeCounts);

  const ctxEmp = document.getElementById("chartRequestsByEmployee").getContext("2d");
  if (chartRequestsByEmployee) chartRequestsByEmployee.destroy();
  chartRequestsByEmployee = new Chart(ctxEmp, {
    type: "bar",
    data: {
      labels: empLabels,
      datasets: [{
        label: "عدد الطلبات المعالجة",
        data: empValues,
        backgroundColor: "#1a3a6b",
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { autoSkip: false } },
        y: { beginAtZero: true }
      }
    }
  });
}




// لوحة التحكم (navHome) قابلة للضغط - تعيد للتبويب الافتراضي
const navHome = document.getElementById("navHome");
if (navHome) {
  navHome.style.cursor = "pointer";
  navHome.addEventListener("click", () => {
    // إخفاء الأقسام الأخرى
    if (dashboardSection) dashboardSection.style.display = "none";
    if (semesterSection)  semesterSection.style.display  = "none";

    // إخفاء فلتر الأقسام للإحصائيات
    const filterBar = document.getElementById("statsDeptFilterBar");
    if (filterBar) filterBar.style.display = "none";

    // إظهار الكاردز والجدول والبحث
    if (statsGrid) statsGrid.style.display = "";
    const searchRowEl = document.querySelector(".admin-search-row");
    if (searchRowEl) searchRowEl.style.display = "";

    // تفعيل تبويب الحذف والإضافة (الافتراضي)
    currentTab = "addDrop";
    document.querySelectorAll(".sb-nav-item").forEach((i) => i.classList.remove("active"));
    navHome.classList.add("active");

    const firstTab = document.querySelector(".admin-tab[data-tab='addDrop']");
    if (firstTab) {
      document.querySelectorAll(".admin-tab").forEach((t) => t.classList.remove("active"));
      firstTab.classList.add("active");
    }

    // إخفاء زيارة upload area
    const visitUploadAreaEl = document.getElementById("visitUploadArea");
    if (visitUploadAreaEl) visitUploadAreaEl.style.display = "none";

    // إعادة تعيين الفلاتر
    currentStatusFilter = "all";
    currentDeptFilter = "all";
    document.querySelectorAll(".admin-stat-card").forEach((c) => c.classList.remove("active"));
    const cardAll = document.getElementById("card-all");
    if (cardAll) cardAll.classList.add("active");

    renderTab();
  });
}

// ==================== مزامنة uid هذا الأدمن ====================
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
      await initSemesterData();
      await loadAllData();

    } catch (err) {
      console.error("Auth error:", err);
      await signOut(auth);
      window.location.replace("EmployeeLogin.html");
    }
  });
});
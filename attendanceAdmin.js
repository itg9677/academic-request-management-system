import { auth, db } from "./firebase.js";

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ============================================================
   attendanceAdmin.js — تبويب متابعة الحضور (واجهة الأدمن)
   ============================================================
   • عرض غياب اليوم تلقائيًا + خيار نطاق تاريخ
   • فلترة أقسام (الكل، كيمياء، فيزياء، أحشاء، رياضيات، إحصاء، أعضاء خارجيين)
   • طباعة رسمية بالشعار + "تم التحضير بواسطة"
   • إعطاء/سحب صلاحية التحضير من الموظفين
   • تحديد تاريخ بداية الفصل الدراسي — يُستخدم بواجهة الموظف لإجباره على
     تسجيل كل أيام الأسبوع (أحد–خميس) الناقصة بالترتيب قبل أي يوم لاحق
============================================================ */

const ATT_DEPARTMENTS = [
  { value: "all",         label: "الكل" },
  { value: "كيمياء",       label: "كيمياء" },
  { value: "فيزياء",       label: "فيزياء" },
  { value: "أحياء",        label: "أحياء" },
  { value: "رياضيات",     label: "رياضيات" },
  { value: "إحصاء",       label: "إحصاء" },
  { value: "أعضاء خارجيين", label: "أعضاء خارجيين" }
];

let attAdminMode = "today";  // "today" | "range"
let attAdminDept = "all";
let attAdminRecords = [];
let attStatsPeriod = "week"; // "week" | "month" | "custom"
let attStatsCustomFrom = "";
let attStatsCustomTo = "";
let attStatsOpen = true; // هل الإحصائيات مفتوحة — تبدأ مفتوحة دائمًا بدون الحاجة للضغط عليها
let attStatsRecords = []; // آخر سجلات تم جلبها لحساب الإحصائيات — تُستخدم لعرض تفاصيل أعضاء كل قسم
let attAdminNameFilter = ""; // نص البحث الحالي لفلترة الجدول باسم العضو
let attEmployeesList = []; // قائمة الأعضاء (name + employeeNumber) من مجموعة employees — لاقتراحات البحث
let attSemesterStart = ""; // تاريخ بداية الفصل الدراسي — YYYY-MM-DD

// ==================== أدوات مساعدة ====================
function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function formatDateAr(dateStr) {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    const days = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
    return `${days[d.getDay()]}، ${d.toLocaleDateString("ar-SA-u-ca-gregory")}`;
  } catch { return dateStr; }
}

function esc(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// يستخرج قائمة المقررات من سجل المتغيب — يدعم الصيغة الجديدة (courses: [...])
// والصيغة القديمة (course/section مباشرة) للسجلات المحفوظة سابقًا
function getAbsCourses(abs) {
  if (Array.isArray(abs.courses) && abs.courses.length > 0) {
    return abs.courses;
  }
  if (abs.course) {
    return [{ course: abs.course, section: abs.section || "" }];
  }
  return [{ course: "-", section: "" }];
}

// يبني نص كل مقررات العضو مجمّعة بسطر واحد، مثال: "رياضيات101 — شعبة 2، فيزياء201 — شعبة 1"
function formatCoursesText(abs) {
  return getAbsCourses(abs)
    .map(c => `${c.course || "-"}${c.section ? " — شعبة " + c.section : ""}`)
    .join("، ");
}

// سبب الغياب — قد يكون غير موجود بسجلات قديمة قبل إضافة هذه الميزة
function getAbsReason(abs) {
  return abs.reason || "-";
}

// ==================== قائمة الأعضاء لفلتر البحث بالاسم ====================
async function loadAttEmployeesList() {
  try {
    const snap = await getDocs(collection(db, "departmentMembers"));
    attEmployeesList = snap.docs
      .map(d => d.data())
      .filter(data => data.active !== false) // نستبعد الأعضاء غير الفعّالين فقط
      .map(data => ({
        name: data.name || "-",
        employeeNumber: data.employeeNumber || "-",
        department: data.department || ""
      }));
  } catch (err) {
    console.error("خطأ تحميل قائمة الأعضاء:", err);
    attEmployeesList = [];
  }
}

// يفلتر صفوف جدول الغياب المعروضة حسب نص البحث الحالي (اسم العضو أو رقمه الوظيفي)
function applyAttNameFilter(rows) {
  const term = attAdminNameFilter.trim();
  if (!term) return rows;
  return rows.filter(r =>
    String(r.name || "").includes(term) ||
    String(r.employeeNumber || "").includes(term)
  );
}

// ==================== فتح تبويب الحضور ====================
// flag يحدد هل قسم الحضور مفتوح حالياً
let attAdminOpen = false;

export async function openAttendanceAdmin() {
  attAdminOpen = true;

  // إخفاء كل عناصر الجدول العام وباقي الأقسام
  const idsToHide = ["dashboardSection","semesterSection","tableWrap","loadingState","visitUploadArea"];
  idsToHide.forEach(id => { const el=document.getElementById(id); if(el) el.style.display="none"; });

  // نستثني عناصر قسم الشكاوى تمامًا هنا، لأن قسمه يُخفى/يُظهر بالكامل عبر
  // complaintsSection نفسه — تعديل عناصره الداخلية من هنا كان يسبب بقاء
  // جدول الشكاوى مطفي دائمًا حتى بعد إعادة فتح تبويب الشكاوى.
  document.querySelectorAll(".admin-search-row").forEach(el => {
    if (!el.closest("#complaintsSection")) el.style.display = "none";
  });
  document.querySelectorAll(".admin-stats-grid").forEach(el => {
    if (!el.closest("#complaintsSection")) el.style.display = "none";
  });

  // إخفاء admin-table-card التي تخص الجدول الرئيسي (ليس قسم الحضور ولا الشكاوى)
  document.querySelectorAll(".admin-table-card").forEach(el => {
    if (!el.closest("#attendanceSectionAdmin") && !el.closest("#complaintsSection")) el.style.display = "none";
  });

  // إظهار قسم الحضور بشكل صريح (بدون تراكم على style.cssText مع كل فتح)
  const section = document.getElementById("attendanceSectionAdmin");
  if (section) {
    section.style.setProperty("display", "block", "important");
    // إعادة إظهار عناصره الداخلية بشكل صريح، في حال أُطفئت سابقًا من منطق
    // تبويب الشكاوى (showComplaintsSection) قبل هذا الإصلاح
    section.querySelectorAll(".admin-table-card, .admin-search-row, .admin-stats-grid").forEach(el => {
      el.style.display = "";
    });
  }

  // تعيين التاريخ الافتراضي
  const today = getTodayStr();
  const fromInput = document.getElementById("attRangeFrom");
  const toInput   = document.getElementById("attRangeTo");
  if (fromInput && !fromInput.value) fromInput.value = today;
  if (toInput   && !toInput.value)   toInput.value   = today;

  // تحميل البيانات
  await loadAttRecords();
  renderAttAdmin();
  await loadAttSemesterStart();
  renderSemesterStartBox();
  await loadPermissionList();
  await loadAttStats();
  await loadAttEmployeesList();
}

// يُستدعى من Admindashboard.js عند مغادرة تبويب الحضور
export function closeAttendanceAdmin() {
  attAdminOpen = false;
  const section = document.getElementById("attendanceSectionAdmin");
  if (section) section.style.setProperty("display", "none", "important");
}

// يُستدعى من hideComplaintsSection بعد تعديله في Admindashboard.js
// لمنع إعادة إظهار admin-table-card عند إخفاء الشكاوى بينما الحضور مفتوح
export function isAttendanceAdminOpen() {
  return attAdminOpen;
}

// ==================== بداية الفصل الدراسي ====================
async function loadAttSemesterStart() {
  try {
    const snap = await getDoc(doc(db, "attendanceSettings", "global"));
    attSemesterStart = snap.exists() ? (snap.data().semesterStartDate || "") : "";
  } catch (err) {
    console.error("خطأ تحميل بداية الفصل الدراسي:", err);
    attSemesterStart = "";
  }
}

function renderSemesterStartBox() {
  let box = document.getElementById("attSemesterStartBox");
  const adminSection = document.getElementById("attendanceSectionAdmin");
  if (!box) {
    if (!adminSection) return;
    box = document.createElement("div");
    box.id = "attSemesterStartBox";
    box.className = "att-permission-card"; // إعادة استخدام نفس تنسيق بطاقات القسم
    const permCard = adminSection.querySelector(".att-permission-card");
    if (permCard && permCard.parentNode === adminSection) {
      adminSection.insertBefore(box, permCard);
    } else {
      adminSection.appendChild(box);
    }
  }

  box.innerHTML = `
    <h3 style="margin:0 0 10px;">بداية الفصل الدراسي (لتحضير الموظفين)</h3>
    <p style="font-size:13px;color:#64748b;margin:0 0 10px;">
      يُستخدم هذا التاريخ لإجبار الموظفين المخوّلين بالتحضير على تسجيل كل أيام الأسبوع
      (الأحد–الخميس) بدءًا منه بالترتيب، قبل السماح لهم بتسجيل أي يوم لاحق.
    </p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <input type="date" id="attSemesterStartInput" value="${esc(attSemesterStart)}" />
      <button class="att-save-btn" id="attSemesterStartSaveBtn" style="width:auto;padding:8px 16px;">
        <i class="ti ti-device-floppy"></i> حفظ
      </button>
      ${attSemesterStart
        ? `<span style="font-size:13px;color:#16a34a;">الحالي: ${esc(formatDateAr(attSemesterStart))}</span>`
        : `<span style="font-size:13px;color:#dc2626;">لم يتم التحديد بعد</span>`}
    </div>
  `;

  const saveBtn = box.querySelector("#attSemesterStartSaveBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const input = box.querySelector("#attSemesterStartInput");
      const val = input ? input.value : "";
      if (!val) { alert("الرجاء اختيار تاريخ"); return; }
      try {
        await setDoc(doc(db, "attendanceSettings", "global"), {
          semesterStartDate: val,
          updatedBy: auth.currentUser.uid,
          updatedAt: serverTimestamp()
        }, { merge: true });
        attSemesterStart = val;
        alert("تم حفظ تاريخ بداية الفصل الدراسي");
        renderSemesterStartBox();
      } catch (err) {
        console.error("خطأ حفظ بداية الفصل الدراسي:", err);
        alert("حدث خطأ أثناء الحفظ");
      }
    });
  }
}

// ==================== تحميل السجلات ====================
async function loadAttRecords() {
  const today = getTodayStr();
  let q;

  if (attAdminMode === "today") {
    q = query(collection(db, "attendanceRecords"), where("date", "==", today));
  } else {
    const from = document.getElementById("attRangeFrom")?.value || today;
    const to   = document.getElementById("attRangeTo")?.value   || today;
    q = query(
      collection(db, "attendanceRecords"),
      where("date", ">=", from),
      where("date", "<=", to)
    );
  }

  try {
    const snap = await getDocs(q);
    attAdminRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // فلترة حسب القسم
    if (attAdminDept !== "all") {
      attAdminRecords = attAdminRecords.filter(r => r.department === attAdminDept);
    }

    // ترتيب بالتاريخ (الأحدث أولاً)
    attAdminRecords.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  } catch (err) {
    console.error("خطأ تحميل سجلات الحضور:", err);
    attAdminRecords = [];
  }
}

// ==================== عرض السجلات ====================
function renderAttAdmin() {
  const tbody = document.getElementById("attAdminTbody");
  if (!tbody) return;

  if (attAdminRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px;">لا توجد سجلات غياب</td></tr>`;
    updateAttCountBar(0);
    return;
  }

  // استخراج كل المتغيبين من كل السجلات
  let rows = [];
  attAdminRecords.forEach(rec => {
    if (rec.allPresent) return; // تخطى "الكل حاضر"
    (rec.absentees || []).forEach(abs => {
      rows.push({
        date:           rec.date,
        department:     rec.department,
        recordedByName: rec.recordedByName || "-",
        name:           abs.name           || "-",
        employeeNumber: abs.employeeNumber || "-",
        reason:         getAbsReason(abs),
        coursesText:    formatCoursesText(abs)
      });
    });
  });

  rows = applyAttNameFilter(rows);

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px;">لا يوجد متغيبون في هذا النطاق</td></tr>`;
    updateAttCountBar(0);
    return;
  }

  let count = 1;
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${count++}</td>
      <td>${formatDateAr(r.date)}</td>
      <td>${esc(r.department)}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(r.employeeNumber)}</td>
      <td>${esc(r.reason)}</td>
      <td>${esc(r.coursesText)}</td>
    </tr>
  `).join("");

  // تحديث شريط عدد المتغيبين
  updateAttCountBar(rows.length);
}

// ==================== شريط عدد المتغيبين ====================
function updateAttCountBar(count) {
  let bar = document.getElementById("attCountBar");
  if (!bar) {
    // إنشاء الشريط إذا لم يوجد
    const tableCard = document.querySelector("#attendanceSectionAdmin .admin-table-card");
    if (tableCard && tableCard.parentNode) {
      bar = document.createElement("div");
      bar.id = "attCountBar";
      bar.className = "att-count-bar";
      tableCard.parentNode.insertBefore(bar, tableCard);
    }
  }
  if (bar) {
    const deptText = attAdminDept === "all" ? "جميع الأقسام" : attAdminDept;
    bar.innerHTML = `<i class="ti ti-users"></i> عدد المتغيبين — ${esc(deptText)}: <span class="att-count-num">${count}</span>`;
  }
}

// ==================== إحصائيات الأقسام ====================
async function loadAttStats() {
  const now = new Date();
  let startStr, endStr;

  if (attStatsPeriod === "week") {
    const day = now.getDay();
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - day);
    startStr = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,"0")}-${String(startDate.getDate()).padStart(2,"0")}`;
    endStr = getTodayStr();
  } else if (attStatsPeriod === "month") {
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    startStr = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,"0")}-${String(startDate.getDate()).padStart(2,"0")}`;
    endStr = getTodayStr();
  } else {
    if (!attStatsCustomFrom || !attStatsCustomTo) { renderAttStats({}); return; }
    startStr = attStatsCustomFrom;
    endStr = attStatsCustomTo;
  }

  try {
    const q = query(
      collection(db, "attendanceRecords"),
      where("date", ">=", startStr),
      where("date", "<=", endStr)
    );
    const snap = await getDocs(q);
    const records = snap.docs.map(d => d.data());
    attStatsRecords = records; // نحتفظ بالسجلات الخام لعرض تفاصيل الأعضاء عند الضغط

    const deptStats = {};
    const DEPTS = ["كيمياء", "فيزياء", "أحياء", "رياضيات", "إحصاء", "أعضاء خارجيين"];

    DEPTS.forEach(d => { deptStats[d] = { allPresentDays: 0, absenteeCount: 0, totalDays: 0 }; });

    records.forEach(rec => {
      const dept = rec.department;
      if (!deptStats[dept]) return;
      deptStats[dept].totalDays++;
      if (rec.allPresent) {
        deptStats[dept].allPresentDays++;
      } else if (rec.absentees) {
        deptStats[dept].absenteeCount += rec.absentees.length;
      }
    });

    renderAttStats(deptStats)
  } catch (err) {
    console.error("خطأ تحميل إحصائيات الحضور:", err);
  }
}

function renderAttStats(deptStats) {
  let container = document.getElementById("attStatsSection");
  if (!container) {
    const adminSection = document.getElementById("attendanceSectionAdmin");
    if (adminSection) {
      container = document.createElement("div");
      container.id = "attStatsSection";
      container.className = "att-stats-section att-stats-section-top";
      // الكارد فوق كل شيء بقسم الحضور — مباشرة بعد العنوان وقبل الفلاتر والجدول وباقي البطاقات
      const header = adminSection.querySelector(".attendance-header");
      if (header && header.parentNode === adminSection) {
        header.after(container);
      } else {
        adminSection.insertBefore(container, adminSection.firstChild);
      }
    }
  }
  if (!container) return;

  const deptArr = Object.entries(deptStats).map(([dept, s]) => {
    // نسبة الانضباط: (أيام الكل حاضر / إجمالي الأيام المسجلة) × 100
    // لو فيه غياب بس مو يوم كامل، نحسب النسبة من الأيام الكاملة
    const rate = s.totalDays > 0 ? Math.round((s.allPresentDays / s.totalDays) * 100) : 0;
    return { dept, ...s, rate };
  });

  deptArr.sort((a, b) => b.rate - a.rate);

  const periodLabel = attStatsPeriod === "week" ? "هذا الأسبوع"
                    : attStatsPeriod === "month" ? "هذا الشهر"
                    : "نطاق مخصص";

  const openClass = attStatsOpen ? " open" : "";

  let html = `
    <div class="att-stats-header${openClass}" id="attStatsHeader">
      <h3>إحصائيات انضباط الأقسام — ${periodLabel}</h3>
      <span class="att-stats-arrow"><i class="ti ti-chevron-down"></i></span>
    </div>
    <div class="att-stats-body${openClass}" id="attStatsBody">
      <div class="att-stats-toggle">
        <button class="att-stats-period-btn ${attStatsPeriod === "week" ? "active" : ""}" data-period="week">هذا الأسبوع</button>
        <button class="att-stats-period-btn ${attStatsPeriod === "month" ? "active" : ""}" data-period="month">هذا الشهر</button>
        <button class="att-stats-period-btn ${attStatsPeriod === "custom" ? "active" : ""}" data-period="custom">تحديد نطاق</button>
      </div>
      <div class="att-stats-custom-range" id="attStatsCustomRange" style="${attStatsPeriod === "custom" ? "display:flex" : "display:none"}">
        <label>من</label>
        <input type="date" id="attStatsFrom" value="${attStatsCustomFrom}" />
        <label>إلى</label>
        <input type="date" id="attStatsTo" value="${attStatsCustomTo}" />
        <button class="att-stats-apply-btn" id="attStatsApplyBtn"><i class="ti ti-check"></i> تطبيق</button>
      </div>
      <div class="att-stats-grid">
  `;

  deptArr.forEach((d, i) => {
    const cls = i === 0 && d.rate > 0 ? "best" : (i === deptArr.length - 1 && d.totalDays > 0 && d.absenteeCount > 0 ? "worst" : "");
    const rateLabel = d.totalDays > 0 ? `${d.rate}%` : "لا يوجد";
    const hasData = d.totalDays > 0;
    html += `
      <div class="att-stat-card ${cls}" data-dept="${esc(d.dept)}" title="اضغط لعرض تفاصيل أعضاء القسم">
        <div class="att-stat-dept">${esc(d.dept)}</div>
        <div class="att-stat-value">${rateLabel}</div>
        <div class="att-stat-label">${d.totalDays > 0 ? d.totalDays + " يوم مسجل · " + d.allPresentDays + " يوم كامل · " + d.absenteeCount + " غياب" : "لم يُسجل حضور في هذه الفترة"}</div>
      </div>
    `;
  });

  html += `</div></div>`;
  container.innerHTML = html;

  // ربط زر الطي/الفتح — يظل مفتوح حتى يغلقه اليوزر
  const header = container.querySelector("#attStatsHeader");
  const body = container.querySelector("#attStatsBody");
  if (header && body) {
    header.addEventListener("click", () => {
      header.classList.toggle("open");
      body.classList.toggle("open");
      attStatsOpen = body.classList.contains("open");
    });
  }

  // ربط الضغط على كارد كل قسم لعرض تفاصيل أعضائه
  container.querySelectorAll(".att-stat-card").forEach(card => {
    card.addEventListener("click", () => {
      openDeptDetailModal(card.dataset.dept, periodLabel);
    });
  });

  // ربط أزرار الفلترة
  container.querySelectorAll(".att-stats-period-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const period = btn.dataset.period;
      attStatsPeriod = period;

      const rangeDiv = container.querySelector("#attStatsCustomRange");
      if (rangeDiv) {
        rangeDiv.style.display = period === "custom" ? "flex" : "none";
      }

      container.querySelectorAll(".att-stats-period-btn").forEach(b =>
        b.classList.toggle("active", b.dataset.period === period)
      );

      const label = period === "week" ? "هذا الأسبوع"
                  : period === "month" ? "هذا الشهر"
                  : "نطاق مخصص";
      const h3 = container.querySelector("#attStatsHeader h3");
      if (h3) h3.textContent = `إحصائيات انضباط الأقسام — ${label}`;

      if (period === "custom") return;
      await loadAttStats();
    });
  });

  // زر تطبيق النطاق المخصص
  const applyBtn = container.querySelector("#attStatsApplyBtn");
  if (applyBtn) {
    applyBtn.addEventListener("click", async () => {
      const fromInput = container.querySelector("#attStatsFrom");
      const toInput = container.querySelector("#attStatsTo");
      attStatsCustomFrom = fromInput ? fromInput.value : "";
      attStatsCustomTo = toInput ? toInput.value : "";
      if (!attStatsCustomFrom || !attStatsCustomTo) return;
      attStatsPeriod = "custom";
      await loadAttStats();
    });
  }
}

// ==================== تفاصيل أعضاء القسم (عند الضغط على كارد الإحصائيات) ====================
// لكل عضو ظهر في سجلات الغياب داخل القسم: اسمه، رقمه الوظيفي، عدد مرات غيابه
// ونسبة غيابه = (عدد مرات الغياب ÷ إجمالي الأيام المسجلة للقسم) × 100
// (نفس أساس حساب نسبة انضباط القسم نفسه، فتكون النِسب قابلة للمقارنة مع بعضها)
function getDeptEmployeeStats(dept) {
  const recs = attStatsRecords.filter(r => r.department === dept);
  const totalDays = recs.length;
  const empMap = {};

  recs.forEach(rec => {
    if (rec.allPresent) return;
    (rec.absentees || []).forEach(abs => {
      const key = `${abs.employeeNumber || "-"}|${abs.name || "-"}`;
      if (!empMap[key]) {
        empMap[key] = {
          name: abs.name || "-",
          employeeNumber: abs.employeeNumber || "-",
          absentCount: 0
        };
      }
      empMap[key].absentCount++;
    });
  });

  const list = Object.values(empMap).map(e => ({
    ...e,
    rate: totalDays > 0 ? Math.round((e.absentCount / totalDays) * 100) : 0
  }));

  list.sort((a, b) => b.rate - a.rate); // الأعلى غيابًا أولاً
  return { totalDays, list };
}

// كل أيام غياب عضو معيّن داخل القسم مع مقرراته وسبب/نوع عذره في كل يوم
function getMemberAbsenceDetails(dept, employeeNumber, name) {
  const recs = attStatsRecords.filter(r => r.department === dept);
  const totalDays = recs.length;
  const absences = [];

  recs.forEach(rec => {
    if (rec.allPresent) return;
    (rec.absentees || []).forEach(abs => {
      const empNum = abs.employeeNumber || "-";
      const empName = abs.name || "-";
      if (empNum === employeeNumber && empName === name) {
        absences.push({
          date: rec.date,
          coursesText: formatCoursesText(abs),
          reason: getAbsReason(abs)
        });
      }
    });
  });

  absences.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const rate = totalDays > 0 ? Math.round((absences.length / totalDays) * 100) : 0;
  return { totalDays, absences, rate };
}

// ينشئ (إذا لزم) نافذة التفاصيل المشتركة بين عرض القسم وعرض العضو
function ensureAttDeptModal() {
  let overlay = document.getElementById("attDeptModalOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "attDeptModalOverlay";
  overlay.className = "att-dept-modal-overlay";
  overlay.innerHTML = `
    <div class="att-dept-modal" id="attDeptModal">
      <div class="att-dept-modal-header">
        <button class="att-dept-modal-back" id="attDeptModalBackBtn" style="display:none;">
          <i class="ti ti-arrow-right"></i> رجوع
        </button>
        <h3 id="attDeptModalTitle">تفاصيل القسم</h3>
        <button class="sp-close-btn" id="attDeptModalCloseBtn" aria-label="إغلاق">
          <i class="ti ti-x"></i>
        </button>
      </div>
      <div class="att-dept-modal-body" id="attDeptModalBody"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeDeptDetailModal();
  });
  overlay.querySelector("#attDeptModalCloseBtn").addEventListener("click", closeDeptDetailModal);

  return overlay;
}

// المستوى الأول: قائمة أعضاء القسم ونسبة غياب كل واحد منهم
function openDeptDetailModal(dept, periodLabel) {
  const overlay = ensureAttDeptModal();
  overlay.dataset.dept = dept;
  overlay.dataset.period = periodLabel || "";

  const backBtn = overlay.querySelector("#attDeptModalBackBtn");
  if (backBtn) backBtn.style.display = "none";

  const { list } = getDeptEmployeeStats(dept);

  const titleEl = overlay.querySelector("#attDeptModalTitle");
  if (titleEl) titleEl.textContent = `قسم ${dept} — ${periodLabel || ""}`;

  const bodyEl = overlay.querySelector("#attDeptModalBody");
  if (bodyEl) {
    if (list.length === 0) {
      bodyEl.innerHTML = `<div style="text-align:center;color:#94a3b8;padding:30px;">لا يوجد غياب مسجل لهذا القسم في هذه الفترة</div>`;
    } else {
      bodyEl.innerHTML = `
        <table class="att-table">
          <thead>
            <tr>
              <th>اسم العضو</th>
              <th>الرقم الوظيفي</th>
              <th>نسبة الغياب</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(e => `
              <tr class="att-dept-emp-row" data-emp-number="${esc(e.employeeNumber)}" data-emp-name="${esc(e.name)}" title="اضغط لعرض تفاصيل غياب هذا العضو">
                <td>${esc(e.name)}</td>
                <td>${esc(e.employeeNumber)}</td>
                <td>${e.rate}%</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
      bodyEl.querySelectorAll(".att-dept-emp-row").forEach(row => {
        row.addEventListener("click", () => {
          openMemberDetailModal(dept, row.dataset.empNumber, row.dataset.empName, periodLabel);
        });
      });
    }
  }

  overlay.classList.add("open");
}

// المستوى الثاني: تفاصيل غياب عضو معيّن — تواريخ الغياب، المقررات، ونوع العذر في كل يوم
function openMemberDetailModal(dept, employeeNumber, name, periodLabel) {
  const overlay = ensureAttDeptModal();

  const backBtn = overlay.querySelector("#attDeptModalBackBtn");
  if (backBtn) {
    backBtn.style.display = "";
    backBtn.onclick = () => openDeptDetailModal(dept, periodLabel);
  }

  const { totalDays, absences, rate } = getMemberAbsenceDetails(dept, employeeNumber, name);

  const titleEl = overlay.querySelector("#attDeptModalTitle");
  if (titleEl) titleEl.textContent = `${name} (${employeeNumber}) — ${dept}`;

  const bodyEl = overlay.querySelector("#attDeptModalBody");
  if (bodyEl) {
    const rateLine = `
      <div style="margin-bottom:14px;font-size:14px;color:#475569;">
        نسبة الغياب: <strong style="color:#1a3a6b;">${rate}%</strong>
        (${absences.length} غياب من أصل ${totalDays} يوم مسجل للقسم)
      </div>
    `;
    if (absences.length === 0) {
      bodyEl.innerHTML = rateLine + `<div style="text-align:center;color:#94a3b8;padding:20px;">لا يوجد غياب مسجل لهذا العضو في هذه الفترة</div>`;
    } else {
      bodyEl.innerHTML = rateLine + `
        <table class="att-table">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>المقررات</th>
              <th>نوع العذر</th>
            </tr>
          </thead>
          <tbody>
            ${absences.map(a => `
              <tr>
                <td>${formatDateAr(a.date)}</td>
                <td>${esc(a.coursesText)}</td>
                <td>${esc(a.reason)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    }
  }

  overlay.classList.add("open");
}

function closeDeptDetailModal() {
  const overlay = document.getElementById("attDeptModalOverlay");
  if (overlay) overlay.classList.remove("open");
}

// ==================== الطباعة الرسمية ====================
function printAttReport() {
  let rows = [];
  attAdminRecords.forEach(rec => {
    if (rec.allPresent) return;
    (rec.absentees || []).forEach(abs => {
      rows.push({
        date:           rec.date,
        department:     rec.department,
        recordedByName: rec.recordedByName || "-",
        name:           abs.name           || "-",
        employeeNumber: abs.employeeNumber || "-",
        reason:         getAbsReason(abs),
        coursesText:    formatCoursesText(abs)
      });
    });
  });

  rows = applyAttNameFilter(rows);

  if (rows.length === 0) {
    alert("لا يوجد متغيبون للطباعة");
    return;
  }

  // تجميع أسماء الموظفين المحضّرين
  const recorders = [...new Set(attAdminRecords.map(r => r.recordedByName).filter(n => n && n !== "-"))];

  let dateRangeText = attAdminMode === "today"
    ? formatDateAr(getTodayStr())
    : `من ${formatDateAr(document.getElementById("attRangeFrom")?.value)} إلى ${formatDateAr(document.getElementById("attRangeTo")?.value)}`;

  let deptText = attAdminDept === "all" ? "جميع الأقسام" : attAdminDept;
  const memberFilterText = attAdminNameFilter.trim();

  let count = 1;
  const rowsHTML = rows.map(r => `
    <tr>
      <td>${count++}</td>
      <td>${esc(r.department)}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(r.employeeNumber)}</td>
      <td>${esc(r.reason)}</td>
      <td>${esc(r.coursesText)}</td>
      <td>${formatDateAr(r.date)}</td>
    </tr>
  `).join("");

  const printHTML = `
    <div class="att-print-doc">
      <div class="att-print-logo">
        <img src="images/Qassim_University_logo.svg.png" alt="جامعة القصيم" />
      </div>
      <div class="att-print-title">جامعة القصيم — كلية العلوم</div>
      <div class="att-print-subtitle">تقرير غياب أعضاء هيئة التدريس</div>
      <div class="att-print-meta">
        <span><strong>النطاق:</strong> ${dateRangeText}</span>
        <span><strong>القسم:</strong> ${deptText}</span>
        ${memberFilterText ? `<span><strong>العضو:</strong> ${esc(memberFilterText)}</span>` : ""}
        <span><strong>تاريخ الطباعة:</strong> ${formatDateAr(getTodayStr())}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>القسم</th>
            <th>اسم العضو</th>
            <th>الرقم الوظيفي</th>
            <th>سبب الغياب</th>
            <th>المقررات</th>
            <th>التاريخ</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>
      <div class="att-print-footer">
        تم التحضير بواسطة: ${recorders.join("، ")}
      </div>
    </div>
  `;

  const printArea = document.getElementById("attPrintArea");
  if (printArea) {
    printArea.innerHTML = printHTML;
    printArea.style.display = "block";
    window.print();
    setTimeout(() => { printArea.style.display = "none"; }, 500);
  }
}

// ==================== صلاحيات التحضير ====================
async function loadPermissionList() {
  const listEl = document.getElementById("attPermissionList");
  if (!listEl) return;

  try {
    const snap = await getDocs(collection(db, "attendancePermissions"));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (items.length === 0) {
      listEl.innerHTML = `<div style="color:#94a3b8;font-size:13px;text-align:center;padding:12px;">لا يوجد موظفون مخوّلون</div>`;
      return;
    }

    listEl.innerHTML = items.map(item => `
      <div class="att-permission-item">
        <div class="att-perm-info">
          <span class="att-perm-name">${esc(item.employeeName || item.id)}</span>
          <span class="att-perm-dept">${esc(item.trackingDepartment || "-")}</span>
        </div>
        <button class="att-revoke-btn" data-uid="${esc(item.id)}">سحب الصلاحية</button>
      </div>
    `).join("");

    // ربط أزرار السحب
    listEl.querySelectorAll(".att-revoke-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("هل تريد سحب صلاحية التحضير من هذا الموظف؟")) return;
        try {
          await deleteDoc(doc(db, "attendancePermissions", btn.dataset.uid));
          await loadPermissionList();
        } catch (err) {
          console.error("خطأ سحب الصلاحية:", err);
          alert("حدث خطأ");
        }
      });
    });
  } catch (err) {
    console.error("خطأ تحميل قائمة الصلاحيات:", err);
  }
}

async function grantPermission() {
  const empNum = document.getElementById("attPermEmpNum").value.trim();
  const trackDept = document.getElementById("attPermDept").value;

  if (!empNum || !trackDept) {
    alert("أدخل الرقم الوظيفي واختر القسم");
    return;
  }

  try {
    // البحث في employees عن employeeNumber — نجرب كنص وكرقم
    // (لأن الرقم الوظيفي قد يكون مخزن كنص أو كرقم)
    let empSnap = await getDocs(query(
      collection(db, "employees"),
      where("employeeId", "==", empNum)
    ));

    // لو ما لقينا كنص، نجرب كرقم
    if (empSnap.empty && !isNaN(empNum)) {
      empSnap = await getDocs(query(
        collection(db, "employees"),
        where("employeeId", "==", Number(empNum))
      ));
    }

    // لو ما لقينا، نجرب البحث في employeeLookup (المفتاح هو الرقم الوظيفي)
    if (empSnap.empty) {
      const lookupSnap = await getDocs(query(
        collection(db, "employeeLookup"),
        where("__name__", ">=", empNum),
        where("__name__", "<=", empNum + "")
      ));
      if (!lookupSnap.empty) {
        // وجدنا في lookup — نبحث عن الإيميل ونطابقه مع employees
        for (const lookupDoc of lookupSnap.docs) {
          const empEmail = lookupDoc.data().email;
          if (empEmail) {
            const byEmail = await getDocs(query(
              collection(db, "employees"),
              where("email", "==", empEmail)
            ));
            if (!byEmail.empty) {
              empSnap = byEmail;
              break;
            }
          }
        }
      }
    }

    if (empSnap.empty) {
      alert("لم يتم العثور على موظف بهذا الرقم الوظيفي. تأكد من الرقم وحاول مجددًا.");
      return;
    }

    const empDoc = empSnap.docs[0];
    const empData = empDoc.data();
    const empUid = empDoc.id;
    const empName = empData.fullName || "-";

    // حفظ الصلاحية
    await setDoc(doc(db, "attendancePermissions", empUid), {
      employeeNumber:     empData.employeeId || empNum,
      employeeName:       empName,
      trackingDepartment: trackDept,
      grantedBy:          auth.currentUser.uid,
      grantedAt:          serverTimestamp()
    });

    // تفريغ الحقول
    document.getElementById("attPermEmpNum").value = "";
    document.getElementById("attPermDept").value = "";

    alert("تم منح صلاحية التحضير بنجاح");
    await loadPermissionList();

  } catch (err) {
    console.error("خطأ منح الصلاحية:", err);
    alert("حدث خطأ أثناء منح الصلاحية");
  }
}

// ==================== ربط الأحداث ====================
export function bindAttendanceAdminEvents() {

  // تبديل الوضع: اليوم / نطاق
  document.querySelectorAll(".att-mode-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      attAdminMode = btn.dataset.mode;
      document.querySelectorAll(".att-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const rangeDiv = document.getElementById("attDateRange");
      if (rangeDiv) rangeDiv.style.display = attAdminMode === "range" ? "flex" : "none";

      await loadAttRecords();
      renderAttAdmin();
      await loadAttStats();
    });
  });

  // فلتر القسم
  const deptSelect = document.getElementById("attAdminDeptFilter");
  if (deptSelect) {
    deptSelect.addEventListener("change", async () => {
      attAdminDept = deptSelect.value;
      await loadAttRecords();
      renderAttAdmin();
      await loadAttStats();
    });
  }

  // فلتر البحث باسم العضو (يفلتر الجدول والطباعة مباشرة بدون إعادة تحميل من فايربيس)
  const nameInput = document.getElementById("attAdminNameFilter");
  const nameSuggestions = document.getElementById("attAdminNameSuggestions");
  const nameClearBtn = document.getElementById("attAdminNameFilterClear");

  function hideNameSuggestions() {
    if (nameSuggestions) { nameSuggestions.style.display = "none"; nameSuggestions.innerHTML = ""; }
  }

  function updateNameClearBtn() {
    if (nameClearBtn) nameClearBtn.style.display = attAdminNameFilter.trim() ? "flex" : "none";
  }

  if (nameInput) {
    nameInput.addEventListener("input", () => {
      attAdminNameFilter = nameInput.value;
      updateNameClearBtn();
      renderAttAdmin();

      const term = nameInput.value.trim();
      if (!term || !nameSuggestions) { hideNameSuggestions(); return; }

      const matches = attEmployeesList.filter(e => e.name.includes(term)).slice(0, 8);
      if (matches.length === 0) {
        nameSuggestions.innerHTML = `<div class="att-autocomplete-empty">لا يوجد عضو مطابق</div>`;
      } else {
        nameSuggestions.innerHTML = matches.map(e => `
          <div class="att-autocomplete-item" data-name="${esc(e.name)}">
            <span>${esc(e.name)}</span>
            <span class="att-ac-num">${esc(e.employeeNumber)}</span>
          </div>
        `).join("");
        nameSuggestions.querySelectorAll(".att-autocomplete-item").forEach(item => {
          item.addEventListener("click", () => {
            nameInput.value = item.dataset.name;
            attAdminNameFilter = item.dataset.name;
            updateNameClearBtn();
            hideNameSuggestions();
            renderAttAdmin();
          });
        });
      }
      nameSuggestions.style.display = "block";
    });

    nameInput.addEventListener("blur", () => {
      // تأخير بسيط عشان الضغط على اقتراح يسجَّل قبل الإخفاء
      setTimeout(hideNameSuggestions, 150);
    });
  }

  if (nameClearBtn) {
    nameClearBtn.addEventListener("click", () => {
      attAdminNameFilter = "";
      if (nameInput) nameInput.value = "";
      updateNameClearBtn();
      hideNameSuggestions();
      renderAttAdmin();
    });
  }

  // تطبيق النطاق
  const applyBtn = document.getElementById("attApplyRange");
  if (applyBtn) {
    applyBtn.addEventListener("click", async () => {
      await loadAttRecords();
      renderAttAdmin();
      await loadAttStats();
    });
  }

  // طباعة
  const printBtn = document.getElementById("attPrintBtn");
  if (printBtn) {
    printBtn.addEventListener("click", printAttReport);
  }

  // منح صلاحية
  const grantBtn = document.getElementById("attGrantPermBtn");
  if (grantBtn) {
    grantBtn.addEventListener("click", grantPermission);
  }
}
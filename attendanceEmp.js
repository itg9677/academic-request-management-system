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
   attendanceEmp.js — تبويب متابعة الحضور (واجهة الموظف)
   ============================================================
   • يظهر فقط إذا كان الموظف لديه صلاحية تحضير (attendancePermissions)
   • بدون فلترة أقسام — كل موظف مسؤول عن قسم محدد فقط
   • زرّان: "الكل حاضر" / "الكل حاضر ما عدا"
   • تاريخ يوم التحضير قابل للاختيار (وليس اليوم الحالي دائمًا)
   • لو فيه أيام أسبوع سابقة (الأحد–الخميس) بعد بداية الفصل الدراسي
     بدون تحضير مسجّل، يُجبر الموظف على تسجيلها بالترتيب أولًا
   • عند تسجيل غياب موظف يجب اختيار سبب الغياب: اضطراري / بعذر / بدون عذر
============================================================ */

let attPermission = null;   // { trackingDepartment, employeeName, employeeNumber }
let attRecordId   = null;   // معرّف سجل يوم التحضير المحدد (لو موجود)
let attAbsentees  = [];     // [{ name, employeeNumber, reason, courses: [{course, section}] }] — القائمة الرسمية بالجدول
let attPending    = [];     // نفس الشكل — قائمة مؤقتة لما يتم إضافته قبل الضغط على "حفظ التحضير"
let attAllPresent = false;
let attEditingIdx = -1;  // index of absentee being edited (-1 = not editing)
let attCurrentReason = null; // سبب الغياب المختار حاليًا بالفورم قبل الإضافة

let attSemesterStart = ""; // تاريخ بداية الفصل الدراسي (يحدده الأدمن) — YYYY-MM-DD
let attSelectedDate  = ""; // تاريخ يوم التحضير المحدد حاليًا — YYYY-MM-DD
let attMissingDates  = []; // أيام الأسبوع (أحد–خميس) الناقصة قبل attSelectedDate والتي يجب تسجيلها أولًا

const REASONS = ["اضطراري", "بعذر", "بدون عذر"];

// أعضاء القسم الفعّالون (بالمقر الرئيسي) — من بيانات الأعضاء التي يرفعها الأدمن (Excel)
// لو ما فيه بيانات مرفوعة للقسم بعد، تبقى القائمة فاضية ويُترك حقل الاسم حقل كتابة حرة كما كان
let attActiveMembers = []; // [{ name, employeeNumber }]

const DEPARTMENTS = ["كيمياء", "فيزياء", "أحياء", "رياضيات", "إحصاء", "أعضاء خارجيين"];

// ==================== التاريخ اليوم ====================
function getTodayStr() {
  const d = new Date();
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function formatDateArabic(dateStr) {
  if (!dateStr) return "-";
  const [y, m, dd] = dateStr.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  const days = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
  return `${days[d.getDay()]}، ${d.toLocaleDateString("ar-SA-u-ca-gregory")}`;
}

// أيام الأسبوع المطلوب تسجيل تحضيرها: الأحد–الخميس (بدون الجمعة=5 والسبت=6)
function isRequiredWeekday(dateStr) {
  const [y, m, dd] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, dd).getDay();
  return day !== 5 && day !== 6;
}

function addDaysStr(dateStr, days) {
  const [y, m, dd] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, dd);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const ddd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${ddd}`;
}

function getYesterdayStr() {
  return addDaysStr(getTodayStr(), -1);
}

// ==================== التحقق من الصلاحية ====================
async function checkAttPermission(userUid) {
  try {
    const snap = await getDoc(doc(db, "attendancePermissions", userUid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      trackingDepartment: data.trackingDepartment || "-",
      employeeName:       data.employeeName       || "-",
      employeeNumber:     data.employeeNumber     || "-"
    };
  } catch (err) {
    console.error("خطأ فحص صلاحية التحضير:", err);
    return null;
  }
}

// ==================== تحميل أعضاء القسم الفعّالين (بالمقر الرئيسي) ====================
async function loadDepartmentMembers() {
  attActiveMembers = [];
  if (!attPermission) return;

  try {
    const q = query(
      collection(db, "departmentMembers"),
      where("department", "==", attPermission.trackingDepartment),
      where("active", "==", true)
    );
    const snap = await getDocs(q);
    attActiveMembers = snap.docs
      .map(d => d.data())
      .map(m => ({ name: m.name || "-", employeeNumber: m.employeeNumber || "-" }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  } catch (err) {
    console.error("خطأ تحميل بيانات أعضاء القسم:", err);
    attActiveMembers = [];
  }
}

// ==================== بداية الفصل الدراسي (يحدده الأدمن) ====================
async function loadSemesterStart() {
  try {
    const snap = await getDoc(doc(db, "attendanceSettings", "global"));
    attSemesterStart = snap.exists() ? (snap.data().semesterStartDate || "") : "";
  } catch (err) {
    console.error("خطأ تحميل بداية الفصل الدراسي:", err);
    attSemesterStart = "";
  }
}

// ==================== حساب أيام الأسبوع الناقصة قبل اليوم المحدد ====================
// يبحث عن كل يوم أسبوعي (أحد–خميس) بين بداية الفصل والأمس لهذا القسم
// وليس له سجل محفوظ في attendanceRecords — هذه الأيام يجب تسجيلها أولًا
async function computeMissingDates() {
  attMissingDates = [];
  if (!attPermission || !attSemesterStart) return;

  const yesterday = getYesterdayStr();
  if (attSemesterStart > yesterday) return; // لم يبدأ أي يوم أسبوعي بعد بداية الفصل

  let existingDates = new Set();
  try {
    const q = query(
      collection(db, "attendanceRecords"),
      where("department", "==", attPermission.trackingDepartment),
      where("date", ">=", attSemesterStart),
      where("date", "<=", yesterday)
    );
    const snap = await getDocs(q);
    snap.docs.forEach(d => existingDates.add(d.data().date));
  } catch (err) {
    console.error("خطأ فحص الأيام الناقصة:", err);
    return;
  }

  let cursor = attSemesterStart;
  while (cursor <= yesterday) {
    if (isRequiredWeekday(cursor) && !existingDates.has(cursor)) {
      attMissingDates.push(cursor);
    }
    cursor = addDaysStr(cursor, 1);
  }
}

// ==================== إظهار/إخفاء التبويب ====================
export async function initAttendanceEmp(userUid, empData) {
  attPermission = await checkAttPermission(userUid);

  if (!attPermission) return false;

  // إظهار تبويب الحضور في السايدبار
  const navItem = document.getElementById("navAttendanceEmp");
  if (navItem) navItem.style.display = "";

  // إظهار قسم الحضور في الصفحة
  const section = document.getElementById("attendanceSectionEmp");
  if (section) section.style.display = "";

  // تعبئة معلومات القسم
  const deptEl = document.getElementById("attEmpDept");
  if (deptEl) deptEl.textContent = attPermission.trackingDepartment;

  // تحميل قائمة أعضاء القسم الفعّالين (لو الأدمن رفع بيانات الأعضاء لهذا القسم)
  await loadDepartmentMembers();

  return true;
}

// ==================== فتح تبويب الحضور ====================
export async function openAttendanceTab() {
  const section = document.getElementById("attendanceSectionEmp");
  if (!section) return;

  // تفريغ أي مقررات كانت قيد الإضافة ولم تُحفظ
  attPending = [];
  attCurrentReason = null;

  // تحديث قائمة أعضاء القسم الفعّالين (في حال حدّث الأدمن الملف بعد آخر دخول)
  await loadDepartmentMembers();

  // تحميل بداية الفصل الدراسي، وحساب أي أيام أسبوعية سابقة ناقصة
  await loadSemesterStart();
  await computeMissingDates();

  const today = getTodayStr();
  // لو فيه يوم ناقص، نجبر الموظف يبدأ منه؛ وإلا نفتح على اليوم الحالي
  attSelectedDate = attMissingDates.length > 0 ? attMissingDates[0] : today;

  applyDatePickerConstraints();

  const dateEl = document.getElementById("attEmpDate");
  if (dateEl) dateEl.textContent = formatDateArabic(attSelectedDate);

  renderMissingBanner();

  // تحميل سجل اليوم المحدد
  await loadRecordForDate(attSelectedDate);

  renderAttState();
}

// يحدث حقل اختيار التاريخ (min/max/value) حسب بداية الفصل والأيام الناقصة
function applyDatePickerConstraints() {
  const dateInput = document.getElementById("attDatePicker");
  if (!dateInput) return;
  const today = getTodayStr();
  dateInput.min = attSemesterStart || "";
  dateInput.max = attMissingDates.length > 0 ? attMissingDates[0] : today;
  dateInput.value = attSelectedDate;
}

// يعرض/يخفي تنبيه الأيام الناقصة
function renderMissingBanner() {
  const banner = document.getElementById("attMissingBanner");
  if (!banner) return;
  if (attMissingDates.length === 0) {
    banner.style.display = "none";
    banner.innerHTML = "";
    return;
  }
  banner.style.display = "flex";
  banner.innerHTML = `
    <i class="ti ti-alert-triangle"></i>
    <span>لديك ${attMissingDates.length} يوم عمل بدون تحضير مسجّل. يجب تسجيل تحضير يوم
      <strong>${esc(formatDateArabic(attMissingDates[0]))}</strong> أولًا قبل الانتقال لأي يوم لاحق.</span>
  `;
}

// يُستدعى بعد حفظ جزئي (إضافة متغيب واحد أثناء نفس اليوم) — يحدّث تنبيه الأيام
// الناقصة وحدود اختيار التاريخ فقط، بدون تحريك attSelectedDate — يبقى المستخدم
// بنفس اليوم لإكمال إضافة بقية المتغيبين قبل الانتقال
async function refreshMissingState() {
  await computeMissingDates();
  applyDatePickerConstraints();
  renderMissingBanner();
}

// يُستدعى بعد الحفظ النهائي لليوم — يعيد فحص الأيام الناقصة وينتقل تلقائيًا
// لأقدم يوم ناقص تالٍ (أو يبقى/يرجع لليوم الحالي لو ما فيه أيام ناقصة)
async function afterSuccessfulSave() {
  await computeMissingDates();
  const today = getTodayStr();
  attSelectedDate = attMissingDates.length > 0 ? attMissingDates[0] : attSelectedDate;
  if (attMissingDates.length === 0 && attSelectedDate > today) attSelectedDate = today;

  applyDatePickerConstraints();
  renderMissingBanner();

  const dateEl = document.getElementById("attEmpDate");
  if (dateEl) dateEl.textContent = formatDateArabic(attSelectedDate);

  await loadRecordForDate(attSelectedDate);
}

// ==================== تحميل سجل يوم التحضير المحدد ====================
async function loadRecordForDate(dateStr) {
  if (!attPermission || !dateStr) return;

  try {
    const q = query(
      collection(db, "attendanceRecords"),
      where("date", "==", dateStr),
      where("department", "==", attPermission.trackingDepartment)
    );
    const snap = await getDocs(q);

    if (!snap.empty) {
      const docData = snap.docs[0];
      const data = docData.data();
      attRecordId   = docData.id;
      attAllPresent = data.allPresent || false;
      attAbsentees  = data.absentees || [];
    } else {
      attRecordId   = null;
      attAllPresent = false;
      attAbsentees  = [];
    }
  } catch (err) {
    console.error("خطأ تحميل سجل التاريخ المحدد:", err);
  }
}

// يُظهر قسم المتغيبين تلقائيًا لو فيه متغيبون محفوظون لليوم المحدد
function syncAbsentSectionVisibility() {
  const absSec    = document.getElementById("attAbsentSection");
  const allBtn    = document.getElementById("attBtnAllPresent");
  const exceptBtn = document.getElementById("attBtnExcept");
  if (!absSec) return;

  if (attAbsentees.length > 0 && !attAllPresent) {
    absSec.style.setProperty("display", "block", "important");
    if (exceptBtn) exceptBtn.classList.add("done");
    if (allBtn) allBtn.classList.remove("done");
  } else {
    absSec.style.display = "none";
  }
}

// ==================== حفظ السجل ====================
async function saveRecord() {
  if (!attPermission) return false;
  if (!attSelectedDate) {
    alert("الرجاء تحديد تاريخ يوم التحضير قبل الحفظ");
    return false;
  }

  const recordData = {
    date:              attSelectedDate,
    department:        attPermission.trackingDepartment,
    recordedBy:        auth.currentUser.uid,
    recordedByName:   attPermission.employeeName,
    allPresent:        attAllPresent,
    absentees:         attAbsentees,
    updatedAt:         serverTimestamp()
  };

  try {
    if (attRecordId) {
      // تحديث السجل الموجود
      await setDoc(doc(db, "attendanceRecords", attRecordId), recordData, { merge: true });
    } else {
      // إنشاء سجل جديد
      const ref = doc(collection(db, "attendanceRecords"));
      recordData.createdAt = serverTimestamp();
      await setDoc(ref, recordData);
      attRecordId = ref.id;
    }
    return true;
  } catch (err) {
    console.error("خطأ حفظ السجل:", err);
    alert("حدث خطأ أثناء الحفظ");
    return false;
  }
}

// ==================== العرض ====================
function renderAttState() {
  const statusEl  = document.getElementById("attEmpStatus");
  const allBtn    = document.getElementById("attBtnAllPresent");
  const exceptBtn = document.getElementById("attBtnExcept");
  const absSec    = document.getElementById("attAbsentSection");

  if (attRecordId) {
    if (attAllPresent) {
      statusEl.className = "att-status att-status-saved";
      statusEl.textContent = "✓ تم تسجيل: الكل حاضر";
      allBtn.classList.add("done");
      exceptBtn.classList.remove("done");
    } else if (attAbsentees.length > 0) {
      statusEl.className = "att-status att-status-saved";
      statusEl.textContent = `✓ تم تسجيل: ${attAbsentees.length} متغيب`;
      exceptBtn.classList.add("done");
      allBtn.classList.remove("done");
    } else {
      statusEl.className = "att-status att-status-pending";
      statusEl.textContent = "لم يتم تسجيل التحضير بعد";
    }
  } else {
    statusEl.className = "att-status att-status-pending";
    statusEl.textContent = "لم يتم تسجيل التحضير بعد";
    allBtn.classList.remove("done");
    exceptBtn.classList.remove("done");
  }

  syncAbsentSectionVisibility();
  renderAbsenteesTable();
  renderPendingPreview();
}

function renderAbsenteesTable() {
  const container = document.getElementById("attAbsentCards");
  if (!container) return;

  // إظهار/إخفاء رأس المتغيبين
  const absenteesHeader = document.getElementById("attAbsenteesHeader");
  if (absenteesHeader) {
    absenteesHeader.style.display = attAbsentees.length > 0 ? "flex" : "none";
  }

  if (attAbsentees.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = attAbsentees.map((a, i) => `
    <div class="att-absentee-card ${attEditingIdx === i ? "att-editing-card" : ""}" data-idx="${i}">
      <div class="att-card-header">
        <div class="att-card-identity">
          <span class="att-card-name">${esc(a.name)}</span>
          <span class="att-card-num">${esc(a.employeeNumber)}</span>
          ${a.reason ? reasonBadge(a.reason) : ""}
        </div>
        <div class="att-card-actions">
          <button class="att-edit-btn" data-idx="${i}" title="تعديل"><i class="ti ti-edit"></i></button>
          <button class="att-remove-btn" data-idx="${i}" title="حذف"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      <div class="att-card-courses">
        ${(a.courses || []).map((c, ci) => `
          <span class="att-course-chip">
            ${esc(c.course)}${c.section ? " · ش" + esc(c.section) : ""}
            <span class="att-chip-x" data-idx="${i}" data-cidx="${ci}">×</span>
          </span>
        `).join("")}
      </div>
    </div>
  `).join("");

  // حذف مقرر واحد (chip × )
  container.querySelectorAll(".att-chip-x").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx  = parseInt(btn.dataset.idx);
      const cidx = parseInt(btn.dataset.cidx);
      attAbsentees[idx].courses.splice(cidx, 1);
      if (attAbsentees[idx].courses.length === 0) {
        attAbsentees.splice(idx, 1);
      }
      attAllPresent = false;
      renderAttState();
    });
  });

  // تعديل بطاقة كاملة
  container.querySelectorAll(".att-edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx);
      const a = attAbsentees[idx];
      if (!a) return;

      attEditingIdx = idx;
      attCurrentReason = a.reason || null;
      stageCurrentFormEntry(false);

      const nameEl = document.getElementById("attAbsName");
      const numEl  = document.getElementById("attAbsEmpNum");
      const crsEl  = document.getElementById("attAbsCourse");
      const secEl  = document.getElementById("attAbsSection");

      const reasonGroup = document.getElementById("attReasonGroup");
      if (reasonGroup) {
        reasonGroup.querySelectorAll(".att-reason-btn").forEach(b =>
          b.classList.toggle("active", b.dataset.reason === attCurrentReason)
        );
      }

      if (nameEl) nameEl.value = a.name;
      if (numEl)  numEl.value  = a.employeeNumber;
      if (a.courses && a.courses.length > 0) {
        if (crsEl) crsEl.value = a.courses[0].course || "";
        if (secEl) secEl.value = a.courses[0].section || "";
      }

      // نقل باقي المقررات للقائمة المؤقتة
      if (a.courses && a.courses.length > 1) {
        for (let ci = 1; ci < a.courses.length; ci++) {
          const dup = attPending.findIndex(p => p.employeeNumber === a.employeeNumber && p.name === a.name);
          if (dup !== -1) {
            attPending[dup].courses.push(a.courses[ci]);
          } else {
            attPending.push({ name: a.name, employeeNumber: a.employeeNumber, courses: [a.courses[ci]] });
          }
        }
      }
      attAbsentees.splice(idx, 1);
      attAllPresent = false;

      const addBtn = document.getElementById("attAddAbsentBtn");
      if (addBtn) {
        addBtn.innerHTML = '<i class="ti ti-check"></i> تحديث';
        addBtn.classList.add("att-editing-active");
      }

      renderAttState();
      renderPendingPreview();
      if (nameEl) nameEl.focus();
    });
  });

  // حذف بطاقة كاملة
  container.querySelectorAll(".att-remove-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx);
      attAbsentees.splice(idx, 1);
      attAllPresent = false;
      if (attEditingIdx === idx) attEditingIdx = -1;
      renderAttState();
    });
  });

  // تحديث عداد المتغيبين
  const countEl = document.getElementById("attAbsenteesCount");
  if (countEl) countEl.textContent = attAbsentees.length;
}

function renderPendingPreview() {
  const wrap = document.getElementById("attPendingWrap");
  const list = document.getElementById("attPendingList");
  if (!wrap || !list) return;

  if (attPending.length === 0) {
    wrap.style.display = "none";
    list.innerHTML = "";
    return;
  }

  wrap.style.display = "block";

  // نجمع كل المقررات المضافة مؤقتاً (لنفس الموظف المكتوب بالحقل أو لأي موظف)
  // نعرضها كـ chips في صف واحد داخل الفورم
  const allChips = [];
  attPending.forEach((a, i) => {
    a.courses.forEach((c, ci) => {
      allChips.push({ name: a.name, empNum: a.employeeNumber, course: c.course, section: c.section, idx: i, cidx: ci });
    });
  });

  list.innerHTML = `
    <div class="att-pending-chips-row">
      ${allChips.map(ch => `
        <span class="att-course-chip pending-chip" title="${esc(ch.name)} — ${esc(ch.empNum)}">
          ${esc(ch.course)}${ch.section ? " – شعبة " + esc(ch.section) : ""}
          <span class="att-chip-x" data-idx="${ch.idx}" data-cidx="${ch.cidx}">×</span>
        </span>
      `).join("")}
    </div>
  `;

  list.querySelectorAll(".att-chip-x").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx  = parseInt(btn.dataset.idx);
      const cidx = parseInt(btn.dataset.cidx);
      attPending[idx].courses.splice(cidx, 1);
      if (attPending[idx].courses.length === 0) {
        attPending.splice(idx, 1);
      }
      renderPendingPreview();
    });
  });
}

function esc(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// شارة صغيرة تعرض سبب الغياب بلون مميز (ألوان inline لأن ملف التنسيق غير متوفر هنا)
function reasonBadge(reason) {
  const colors = { "اضطراري": "#f59e0b", "بعذر": "#3b82f6", "بدون عذر": "#ef4444" };
  const color = colors[reason] || "#64748b";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;color:#fff;background:${color};margin-inline-start:6px;">${esc(reason)}</span>`;
}

// يقرأ حقول النموذج الحالية ويضيفها للقائمة المؤقتة (attPending)
// showAlerts=true تظهر رسائل تنبيه لو الحقول ناقصة؛ لو الحقول فاضية تمامًا يتجاهل بصمت
function stageCurrentFormEntry(showAlerts) {
  const nameEl = document.getElementById("attAbsName");
  const numEl  = document.getElementById("attAbsEmpNum");
  const crsEl  = document.getElementById("attAbsCourse");
  const secEl  = document.getElementById("attAbsSection");

  const name   = nameEl?.value.trim();
  const empNum = numEl?.value.trim();
  const course = crsEl?.value.trim();
  const section= secEl?.value.trim();

  // ما فيه شي مكتوب بالحقول — عادي، ما نسوي شي
  if (!name && !empNum && !course && !section && !attCurrentReason) return false;

  if (!name || !empNum) {
    if (showAlerts) alert("الاسم والرقم الوظيفي مطلوبان");
    return false;
  }
  if (!attCurrentReason) {
    if (showAlerts) alert("الرجاء اختيار سبب الغياب (اضطراري / بعذر / بدون عذر)");
    return false;
  }
  if (!course) {
    if (showAlerts) alert("الرجاء إدخال اسم المقرر");
    return false;
  }

  // البحث عن العضو (بنفس الاسم والرقم الوظيفي) في القائمة المؤقتة لإضافة المقرر له بدلاً من تكرار اسمه
  const idx = attPending.findIndex(a => a.employeeNumber === empNum && a.name === name);

  if (idx !== -1) {
    attPending[idx].reason = attCurrentReason; // تحديث السبب لو تغيّر
    // تفادي تكرار نفس المقرر والشعبة لنفس العضو
    const isDup = attPending[idx].courses.some(c => c.course === course && c.section === section);
    if (!isDup) {
      attPending[idx].courses.push({ course, section });
    }
  } else {
    attPending.push({ name, employeeNumber: empNum, reason: attCurrentReason, courses: [{ course, section }] });
  }

  // تفريغ حقلي المقرر والشعبة فقط — إبقاء الاسم والرقم الوظيفي لإضافة مقرر آخر بسهولة
  if (crsEl) crsEl.value = "";
  if (secEl) secEl.value = "";

  // لو كنا في وضع التعديل، نReset زر الإضافة
  if (attEditingIdx >= 0) {
    attEditingIdx = -1;
    const addBtn = document.getElementById("attAddAbsentBtn");
    if (addBtn) {
      addBtn.innerHTML = '<i class="ti ti-plus"></i> إضافة';
      addBtn.classList.remove("att-editing-active");
    }
  }

  return true;
}

// ==================== اقتراحات أسماء الأعضاء (autocomplete) ====================
// تعمل فقط لو فيه بيانات أعضاء مرفوعة لهذا القسم (attActiveMembers غير فاضية)،
// وإلا يبقى حقل الاسم حقل كتابة حرة تمامًا كما كان سابقًا (بدون أي تغيير بالسلوك)
function bindMemberAutocomplete() {
  const nameEl = document.getElementById("attAbsName");
  const numEl  = document.getElementById("attAbsEmpNum");
  const listEl = document.getElementById("attNameSuggestions");
  if (!nameEl || !numEl || !listEl) return;

  function hideList() { listEl.style.display = "none"; listEl.innerHTML = ""; }

  function selectMember(m) {
    nameEl.value = m.name;
    numEl.value  = m.employeeNumber;
    numEl.setAttribute("readonly", "readonly");
    hideList();
  }

  function renderSuggestions(filterText) {
    if (!attActiveMembers.length) { hideList(); return; }

    const q = (filterText || "").trim();
    const matches = q
      ? attActiveMembers.filter(m => m.name.includes(q) || m.employeeNumber.includes(q))
      : attActiveMembers;

    if (!matches.length) {
      listEl.innerHTML = `<div class="att-autocomplete-empty">لا يوجد عضو مطابق ضمن بيانات القسم المرفوعة — يمكنك إكمال الاسم يدويًا</div>`;
      listEl.style.display = "block";
      return;
    }

    listEl.innerHTML = matches.slice(0, 30).map(m => `
      <div class="att-autocomplete-item" data-num="${esc(m.employeeNumber)}">
        <span>${esc(m.name)}</span>
        <span class="att-ac-num">${esc(m.employeeNumber)}</span>
      </div>
    `).join("");
    listEl.style.display = "block";

    listEl.querySelectorAll(".att-autocomplete-item").forEach(item => {
      item.addEventListener("mousedown", (e) => {
        e.preventDefault(); // يمنع فقدان تركيز الحقل قبل اختيار العنصر
        const m = matches.find(x => x.employeeNumber === item.dataset.num);
        if (m) selectMember(m);
      });
    });
  }

  nameEl.addEventListener("input", () => {
    // أي تعديل يدوي على الاسم يلغي القفل عن حقل الرقم الوظيفي
    numEl.removeAttribute("readonly");
    renderSuggestions(nameEl.value);
  });
  nameEl.addEventListener("focus", () => renderSuggestions(nameEl.value));
  nameEl.addEventListener("blur", () => setTimeout(hideList, 120));
}

// ==================== أزرار سبب الغياب ====================
function bindReasonButtons() {
  const group = document.getElementById("attReasonGroup");
  if (!group) return;
  group.addEventListener("click", (e) => {
    const btn = e.target.closest(".att-reason-btn");
    if (!btn) return;
    attCurrentReason = btn.dataset.reason;
    group.querySelectorAll(".att-reason-btn").forEach(b => b.classList.toggle("active", b === btn));
  });
}

// ==================== تغيير تاريخ يوم التحضير ====================
function bindDatePicker() {
  const dateInput = document.getElementById("attDatePicker");
  if (!dateInput) return;

  dateInput.addEventListener("change", async () => {
    let val = dateInput.value;
    if (!val) { dateInput.value = attSelectedDate; return; }

    // امنع اختيار يوم لاحق طالما فيه يوم أسبوعي سابق لم يُسجَّل بعد
    if (attMissingDates.length > 0 && val > attMissingDates[0]) {
      alert(`يجب تسجيل تحضير يوم ${formatDateArabic(attMissingDates[0])} أولًا قبل الانتقال لأي يوم لاحق.`);
      val = attMissingDates[0];
    }
    // امنع اختيار تاريخ قبل بداية الفصل الدراسي
    if (attSemesterStart && val < attSemesterStart) {
      alert("لا يمكن اختيار تاريخ قبل بداية الفصل الدراسي");
      val = attSemesterStart;
    }

    attSelectedDate = val;
    dateInput.value = val;

    const dateEl = document.getElementById("attEmpDate");
    if (dateEl) dateEl.textContent = formatDateArabic(attSelectedDate);

    attPending = [];
    attCurrentReason = null;
    const grp = document.getElementById("attReasonGroup");
    if (grp) grp.querySelectorAll(".att-reason-btn").forEach(b => b.classList.remove("active"));

    await loadRecordForDate(attSelectedDate);
    renderAttState();
  });
}

// ==================== ربط الأحداث ====================
// flag لمنع الربط المكرر
let attEventsBound = false;

export function bindAttendanceEvents() {
  if (attEventsBound) return;
  attEventsBound = true;

  bindMemberAutocomplete();
  bindReasonButtons();
  bindDatePicker();

  // الكل حاضر
  const allBtn = document.getElementById("attBtnAllPresent");
  if (allBtn) {
    allBtn.addEventListener("click", async () => {
      attAllPresent = true;
      attAbsentees = [];
      attPending = [];
      const ok = await saveRecord();
      if (ok) {
        await afterSuccessfulSave();
        renderAttState();
      }
    });
  }

  // الكل حاضر ما عدا
  const exceptBtn = document.getElementById("attBtnExcept");
  if (exceptBtn) {
    exceptBtn.addEventListener("click", () => {
      attAllPresent = false;
      const sec = document.getElementById("attAbsentSection");
      if (sec) {
        // إظهار القسم بشكل صريح
        sec.style.display = "block";
        sec.style.cssText += ";display:block !important;";
      }
      // إزالة التأثير "done" عن زر الكل حاضر
      if (allBtn) allBtn.classList.remove("done");
      exceptBtn.classList.add("done");
    });
  }

  // إضافة متغيب / إضافة مقرر آخر لنفس العضو — إلى القائمة المؤقتة فقط (لا يظهر بالجدول إلا بعد الحفظ)
  const addBtn = document.getElementById("attAddAbsentBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      stageCurrentFormEntry(true);
      renderPendingPreview();
    });
  }

  // ======= دالة مشتركة: دمج attPending في attAbsentees ثم حفظ =======
  // advanceDate=true (الحفظ النهائي): ينتقل تلقائيًا لأقدم يوم ناقص تالٍ
  // advanceDate=false (الحفظ الجزئي أثناء الإضافة): يبقى بنفس اليوم لإكمال إضافة بقية المتغيبين
  async function commitAndSave(advanceDate) {
    stageCurrentFormEntry(true);

    if (attPending.length === 0 && attAbsentees.length === 0) {
      alert("أضف متغيبًا واحدًا على الأقل أو استخدم زر «الكل حاضر»");
      return false;
    }

    attPending.forEach(p => {
      const idx = attAbsentees.findIndex(a => a.employeeNumber === p.employeeNumber && a.name === p.name);
      if (idx !== -1) {
        attAbsentees[idx].reason = p.reason || attAbsentees[idx].reason;
        p.courses.forEach(c => {
          const isDup = attAbsentees[idx].courses.some(ec => ec.course === c.course && ec.section === c.section);
          if (!isDup) attAbsentees[idx].courses.push(c);
        });
      } else {
        attAbsentees.push({ name: p.name, employeeNumber: p.employeeNumber, reason: p.reason, courses: [...p.courses] });
      }
    });
    attPending = [];
    attAllPresent = false;

    const ok = await saveRecord();
    if (ok) {
      const elName = document.getElementById("attAbsName");
      const elNum  = document.getElementById("attAbsEmpNum");
      const elCrs  = document.getElementById("attAbsCourse");
      const elSec  = document.getElementById("attAbsSection");
      if (elName) elName.value = "";
      if (elNum)  { elNum.value  = ""; elNum.removeAttribute("readonly"); }
      if (elCrs)  elCrs.value  = "";
      if (elSec)  elSec.value  = "";

      attCurrentReason = null;
      const grp = document.getElementById("attReasonGroup");
      if (grp) grp.querySelectorAll(".att-reason-btn").forEach(b => b.classList.remove("active"));

      if (advanceDate) {
        await afterSuccessfulSave();
      } else {
        await refreshMissingState();
      }
      renderAttState();
    }
    return ok;
  }

  // زر "حفظ التحضير النهائي" (أسفل القائمة) — ينهي تحضير اليوم وينتقل تلقائيًا
  // لليوم الناقص التالي إن وجد
  const saveBtn = document.getElementById("attSaveAbsentBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      await commitAndSave(true);
    });
  }

  // زر "حفظ" داخل الفورم (يضيف المتغيب الحالي ويحفظ) — يبقى بنفس اليوم عشان
  // تقدرين تكملين إضافة بقية المتغيبين قبل ما تنتقلين
  const saveInlineBtn = document.getElementById("attSaveInlineBtn");
  if (saveInlineBtn) {
    saveInlineBtn.addEventListener("click", async () => {
      await commitAndSave(false);
    });
  }
}
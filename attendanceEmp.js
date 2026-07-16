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
   • يمكن التعديل طول اليوم
============================================================ */

let attPermission = null;   // { trackingDepartment, employeeName, employeeNumber }
let attRecordId   = null;   // معرّف سجل اليوم (لو موجود)
let attAbsentees  = [];     // [{ name, employeeNumber, course, section }]
let attAllPresent = false;

const DEPARTMENTS = ["كيمياء", "فيزياء", "أحياء", "رياضيات", "إحصاء", "أعضاء خارجيين"];

// ==================== التاريخ اليوم ====================
function getTodayStr() {
  const d = new Date();
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function formatTodayArabic() {
  const d = new Date();
  const days = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
  return `${days[d.getDay()]}، ${d.toLocaleDateString("ar-SA-u-ca-gregory")}`;
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

  return true;
}

// ==================== فتح تبويب الحضور ====================
export async function openAttendanceTab() {
  const section = document.getElementById("attendanceSectionEmp");
  if (!section) return;

  // إخفاء قسم المتغيبين افتراضيًا (يظهر عند الضغط على "الكل حاضر ما عدا")
  const absSec = document.getElementById("attAbsentSection");
  if (absSec) absSec.style.display = "none";

  // عرض التاريخ
  const dateEl = document.getElementById("attEmpDate");
  if (dateEl) dateEl.textContent = formatTodayArabic();

  // تحميل سجل اليوم
  await loadTodayRecord();

  renderAttState();
}

// ==================== تحميل سجل اليوم ====================
async function loadTodayRecord() {
  if (!attPermission) return;
  const today = getTodayStr();

  try {
    const q = query(
      collection(db, "attendanceRecords"),
      where("date", "==", today),
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
    console.error("خطأ تحميل سجل اليوم:", err);
  }
}

// ==================== حفظ السجل ====================
async function saveRecord() {
  if (!attPermission) return;
  const today = getTodayStr();

  const recordData = {
    date:              today,
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
    renderAttState();
  } catch (err) {
    console.error("خطأ حفظ السجل:", err);
    alert("حدث خطأ أثناء الحفظ");
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

  renderAbsenteesTable();
}

function renderAbsenteesTable() {
  const tbody = document.getElementById("attAbsentTbody");
  if (!tbody) return;

  if (attAbsentees.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#94a3b8;">لا يوجد متغيبون</td></tr>`;
    return;
  }

  tbody.innerHTML = attAbsentees.map((a, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(a.name)}</td>
      <td>${esc(a.employeeNumber)}</td>
      <td>${esc(a.course)}</td>
      <td>${esc(a.section)}</td>
      <td><button class="att-remove-btn" data-idx="${i}" title="حذف"><i class="ti ti-x"></i></button></td>
    </tr>
  `).join("");

  // ربط أزرار الحذف
  tbody.querySelectorAll(".att-remove-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx);
      attAbsentees.splice(idx, 1);
      attAllPresent = false;
      renderAttState();
    });
  });
}

function esc(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ==================== ربط الأحداث ====================
// flag لمنع الربط المكرر
let attEventsBound = false;

export function bindAttendanceEvents() {
  if (attEventsBound) return;
  attEventsBound = true;

  // الكل حاضر
  const allBtn = document.getElementById("attBtnAllPresent");
  if (allBtn) {
    allBtn.addEventListener("click", async () => {
      attAllPresent = true;
      attAbsentees = [];
      await saveRecord();
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

  // إضافة متغيب
  const addBtn = document.getElementById("attAddAbsentBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      const name   = document.getElementById("attAbsName")?.value.trim();
      const empNum = document.getElementById("attAbsEmpNum")?.value.trim();
      const course = document.getElementById("attAbsCourse")?.value.trim();
      const section= document.getElementById("attAbsSection")?.value.trim();

      if (!name || !empNum) {
        alert("الاسم والرقم الوظيفي مطلوبان");
        return;
      }

      attAbsentees.push({ name, employeeNumber: empNum, course, section });
      attAllPresent = false;

      // تفريغ الحقول
      const elName = document.getElementById("attAbsName");
      const elNum  = document.getElementById("attAbsEmpNum");
      const elCrs  = document.getElementById("attAbsCourse");
      const elSec  = document.getElementById("attAbsSection");
      if (elName) elName.value   = "";
      if (elNum)  elNum.value    = "";
      if (elCrs)  elCrs.value    = "";
      if (elSec)  elSec.value    = "";

      renderAttState();
    });
  }

  // حفظ بعد إضافة المتغيبين
  const saveBtn = document.getElementById("attSaveAbsentBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      if (attAbsentees.length === 0) {
        alert("أضف متغيبًا واحدًا على الأقل أو استخدم زر «الكل حاضر»");
        return;
      }
      await saveRecord();
    });
  }
}

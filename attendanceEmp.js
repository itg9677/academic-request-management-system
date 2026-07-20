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
let attAbsentees  = [];     // [{ name, employeeNumber, courses: [{course, section}] }] — القائمة الرسمية بالجدول
let attPending    = [];     // نفس الشكل — قائمة مؤقتة لما يتم إضافته قبل الضغط على "حفظ التحضير"
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

  // تفريغ أي مقررات كانت قيد الإضافة ولم تُحفظ
  attPending = [];

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
  if (!attPermission) return false;
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

  renderAbsenteesTable();
  renderPendingPreview();
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
      <td>
        <div class="att-courses-list">
          ${(a.courses || []).map((c, ci) => `
            <div class="att-course-line">
              <span>${esc(c.course)}${c.section ? " - " + esc(c.section) : ""}</span>
              <span class="att-course-x" data-idx="${i}" data-cidx="${ci}" title="حذف المقرر">×</span>
            </div>
          `).join("")}
        </div>
      </td>
      <td><button class="att-remove-btn" data-idx="${i}" title="حذف العضو بالكامل"><i class="ti ti-trash"></i></button></td>
    </tr>
  `).join("");

  // حذف مقرر واحد من عضو (وإذا لم يتبقَ أي مقرر يُحذف العضو بالكامل)
  tbody.querySelectorAll(".att-course-x").forEach(btn => {
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

  // حذف عضو بالكامل (مع كل مقرراته)
  tbody.querySelectorAll(".att-remove-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx);
      attAbsentees.splice(idx, 1);
      attAllPresent = false;
      renderAttState();
    });
  });
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
  list.innerHTML = attPending.map((a, i) => `
    <div class="att-pending-item">
      <div class="att-pending-name">${esc(a.name)} — ${esc(a.employeeNumber)}</div>
      <div class="att-courses-list">
        ${a.courses.map((c, ci) => `
          <div class="att-course-line">
            <span>${esc(c.course)}${c.section ? " - " + esc(c.section) : ""}</span>
            <span class="att-course-x" data-idx="${i}" data-cidx="${ci}" title="حذف المقرر">×</span>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");

  // حذف مقرر واحد من القائمة المؤقتة
  list.querySelectorAll(".att-course-x").forEach(btn => {
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
  if (!name && !empNum && !course && !section) return false;

  if (!name || !empNum) {
    if (showAlerts) alert("الاسم والرقم الوظيفي مطلوبان");
    return false;
  }
  if (!course) {
    if (showAlerts) alert("الرجاء إدخال اسم المقرر");
    return false;
  }

  // البحث عن العضو (بنفس الاسم والرقم الوظيفي) في القائمة المؤقتة لإضافة المقرر له بدلاً من تكرار اسمه
  const idx = attPending.findIndex(a => a.employeeNumber === empNum && a.name === name);

  if (idx !== -1) {
    // تفادي تكرار نفس المقرر والشعبة لنفس العضو
    const isDup = attPending[idx].courses.some(c => c.course === course && c.section === section);
    if (!isDup) {
      attPending[idx].courses.push({ course, section });
    }
  } else {
    attPending.push({ name, employeeNumber: empNum, courses: [{ course, section }] });
  }

  // تفريغ حقلي المقرر والشعبة فقط — إبقاء الاسم والرقم الوظيفي لإضافة مقرر آخر بسهولة
  if (crsEl) crsEl.value = "";
  if (secEl) secEl.value = "";

  return true;
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
      attPending = [];
      const ok = await saveRecord();
      if (ok) renderAttState();
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

  // حفظ التحضير — هنا تنتقل المقررات المضافة (سواء عبر زر "إضافة" أو المكتوبة بالحقول الآن) من القائمة المؤقتة إلى الجدول الفعلي وتُحفظ
  const saveBtn = document.getElementById("attSaveAbsentBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      // لو المستخدم كاتب بيانات بالحقول ولسا ما ضغط "إضافة"، نضيفها تلقائيًا قبل الحفظ
      stageCurrentFormEntry(true);

      if (attPending.length === 0 && attAbsentees.length === 0) {
        alert("أضف متغيبًا واحدًا على الأقل أو استخدم زر «الكل حاضر»");
        return;
      }

      // دمج القائمة المؤقتة داخل الجدول الفعلي
      attPending.forEach(p => {
        const idx = attAbsentees.findIndex(a => a.employeeNumber === p.employeeNumber && a.name === p.name);
        if (idx !== -1) {
          p.courses.forEach(c => {
            const isDup = attAbsentees[idx].courses.some(ec => ec.course === c.course && ec.section === c.section);
            if (!isDup) attAbsentees[idx].courses.push(c);
          });
        } else {
          attAbsentees.push({ name: p.name, employeeNumber: p.employeeNumber, courses: [...p.courses] });
        }
      });
      attPending = [];
      attAllPresent = false;

      const ok = await saveRecord();
      if (ok) {
        // تفريغ حقول الإدخال فقط — الجدول يبقى ظاهرًا بما تم حفظه فعليًا
        const elName = document.getElementById("attAbsName");
        const elNum  = document.getElementById("attAbsEmpNum");
        const elCrs  = document.getElementById("attAbsCourse");
        const elSec  = document.getElementById("attAbsSection");
        if (elName) elName.value = "";
        if (elNum)  elNum.value  = "";
        if (elCrs)  elCrs.value  = "";
        if (elSec)  elSec.value  = "";

        renderAttState();
      }
    });
  }
}
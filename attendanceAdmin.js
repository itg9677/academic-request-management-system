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

// ==================== فتح تبويب الحضور ====================
// flag يحدد هل قسم الحضور مفتوح حالياً
let attAdminOpen = false;

export async function openAttendanceAdmin() {
  attAdminOpen = true;

  // إخفاء كل عناصر الجدول العام وباقي الأقسام
  const idsToHide = ["dashboardSection","semesterSection","tableWrap","loadingState","visitUploadArea"];
  idsToHide.forEach(id => { const el=document.getElementById(id); if(el) el.style.display="none"; });

  document.querySelectorAll(".admin-search-row").forEach(el => el.style.display = "none");
  document.querySelectorAll(".admin-stats-grid").forEach(el => el.style.display = "none");

  // إخفاء admin-table-card التي تخص الجدول الرئيسي (ليس قسم الحضور)
  document.querySelectorAll(".admin-table-card").forEach(el => {
    if (!el.closest("#attendanceSectionAdmin")) el.style.display = "none";
  });

  // إظهار قسم الحضور بشكل صريح
  const section = document.getElementById("attendanceSectionAdmin");
  if (section) {
    section.style.display  = "block";
    section.style.cssText += ";display:block !important;";
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
  await loadPermissionList();
}

// يُستدعى من Admindashboard.js عند مغادرة تبويب الحضور
export function closeAttendanceAdmin() {
  attAdminOpen = false;
  const section = document.getElementById("attendanceSectionAdmin");
  if (section) section.style.display = "none";
}

// يُستدعى من hideComplaintsSection بعد تعديله في Admindashboard.js
// لمنع إعادة إظهار admin-table-card عند إخفاء الشكاوى بينما الحضور مفتوح
export function isAttendanceAdminOpen() {
  return attAdminOpen;
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
        course:         abs.course         || "-",
        section:        abs.section       || "-"
      });
    });
  });

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px;">لا يوجد متغيبون في هذا النطاق</td></tr>`;
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
      <td>${esc(r.course)} ${r.section ? `— شعبة ${esc(r.section)}` : ""}</td>
    </tr>
  `).join("");
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
        course:         abs.course         || "-",
        section:        abs.section       || "-"
      });
    });
  });

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

  let count = 1;
  const rowsHTML = rows.map(r => `
    <tr>
      <td>${count++}</td>
      <td>${esc(r.department)}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(r.employeeNumber)}</td>
      <td>${esc(r.course)}</td>
      <td>${esc(r.section)}</td>
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
        <span><strong>تاريخ الطباعة:</strong> ${formatDateAr(getTodayStr())}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>القسم</th>
            <th>اسم العضو</th>
            <th>الرقم الوظيفي</th>
            <th>المقرر</th>
            <th>الشعبة</th>
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
        where("__name__", "<=", empNum + "\uf8ff")
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
    });
  });

  // فلتر القسم
  const deptSelect = document.getElementById("attAdminDeptFilter");
  if (deptSelect) {
    deptSelect.addEventListener("change", async () => {
      attAdminDept = deptSelect.value;
      await loadAttRecords();
      renderAttAdmin();
    });
  }

  // تطبيق النطاق
  const applyBtn = document.getElementById("attApplyRange");
  if (applyBtn) {
    applyBtn.addEventListener("click", async () => {
      await loadAttRecords();
      renderAttAdmin();
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

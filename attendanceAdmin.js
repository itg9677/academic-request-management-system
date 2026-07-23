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
let attStatsPeriod = "week"; // "week" | "month" | "custom"
let attStatsCustomFrom = "";
let attStatsCustomTo = "";
let attStatsOpen = false; // هل الإحصائيات مفتوحة

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
  await loadPermissionList();
  await loadAttStats();
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
        course:         abs.course         || "-",
        section:        abs.section       || "-"
      });
    });
  });

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px;">لا يوجد متغيبون في هذا النطاق</td></tr>`;
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
      <td>${esc(r.course)} ${r.section ? `— شعبة ${esc(r.section)}` : ""}</td>
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

    const deptStats = {};
    const DEPTS = ["كيمياء", "فيزياء", "أحياء", "رياضيات", "إحصاء", "أعضاء خارجين"];

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
      container.className = "att-stats-section";
      const permCard = adminSection.querySelector(".att-permission-card");
      if (permCard && permCard.parentNode === adminSection) {
        permCard.after(container);
      } else {
        adminSection.appendChild(container);
      }
    }
  }
  if (!container) return;

  const deptArr = Object.entries(deptStats).map(([dept, s]) => {
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
    const cls = i === 0 && d.rate > 0 ? "best" : (i === deptArr.length - 1 && d.totalDays > 0 ? "worst" : "");
    const rateLabel = d.totalDays > 0 ? `${d.rate}%` : "—";
    html += `
      <div class="att-stat-card ${cls}">
        <div class="att-stat-dept">${esc(d.dept)}</div>
        <div class="att-stat-value">${rateLabel}</div>
        <div class="att-stat-label">انضباط · ${d.allPresentDays} يوم كامل · ${d.absenteeCount} غياب</div>
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
    const empOwnDept = (empData.department || "").trim();

    // ==================== تحقق تطابق القسم ====================
    // موظفو "الشؤون التعليمية" وظيفتهم متابعة حضور أي قسم آخر (بما فيها
    // "أعضاء خارجيين")، فلا يُشترط تطابق قسمهم المسجَّل مع القسم المتابَع.
    //
    // أما بقية الموظفين (فيزياء، كيمياء، أحياء، رياضيات، إحصاء...) فلا يُمنح
    // الصلاحية إلا إذا كان القسم المتابَع المُختار يطابق تمامًا قسمهم
    // المسجَّل فعليًا بحسابهم — هذا يمنع خطأ إدخال رقم وظيفي يخص موظفًا من
    // قسم مختلف عن القسم المطلوب متابعته.
    if (empOwnDept !== "الشؤون التعليمية" && empOwnDept !== trackDept) {
      alert(
        `⚠️ الرقم الوظيفي غير مطابق لهذا القسم.\n` +
        `الموظف "${empName}" مسجَّل في قسم "${empOwnDept || "غير معروف"}"، ` +
        `بينما اخترتِ متابعة قسم "${trackDept}".\n` +
        `تأكدي من الرقم الوظيفي أو اختاري القسم الصحيح.`
      );
      return;
    }

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
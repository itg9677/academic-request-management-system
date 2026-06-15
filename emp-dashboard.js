import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, collection, query, where, getDocs,
  updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentEmployee = null;
let isAffairs = false;

// ==================== التواريخ ====================

function setDates() {
  const now = new Date();
  const days = ["الاحد","الاثنين","الثلاثاء","الاربعاء","الخميس","الجمعة","السبت"];
  document.getElementById("gregDate").textContent =
    days[now.getDay()] + "، " + now.toLocaleDateString("ar-SA-u-ca-gregory");
  document.getElementById("hijriDate").textContent =
    now.toLocaleDateString("ar-SA-u-ca-islamic");
}
setDates();

// ==================== ثوابت ====================

const statusLabel = {
  pending:      "معلق",
  under_review: "قيد المراجعة",
  approved:     "مقبول",
  rejected:     "مرفوض"
};
const statusClass = {
  pending:      "b-pending",
  under_review: "b-review",
  approved:     "b-approved",
  rejected:     "b-rejected"
};
const reqTypeLabel = { add: "اضافة", drop: "حذف", edit: "تعديل شعبة", remove: "حذف", change: "تعديل شعبة" };
const reqTypeClass = { add: "b-add", drop: "b-drop", edit: "b-edit", remove: "b-drop", change: "b-edit" };
const levelLabel = {
  "1": "المستوى الأول", "2": "المستوى الثاني", "3": "المستوى الثالث",
  "4": "المستوى الرابع", "5": "المستوى الخامس", "6": "المستوى السادس",
  "7": "المستوى السابع", "8": "المستوى الثامن"
};

const REJECT_REASONS = [
  { value: "section_closed", label: "الشعبة مغلقة" },
  { value: "system_closed",  label: "تم اقفال النظام" },
  { value: "no_contact",     label: "عدم تواصل الطالبة" },
  { value: "conflict",       label: "وجود تعارض" },
  { value: "other",          label: "أخرى" }
];

const PRINT_STYLE =
  "body{font-family:Arial,sans-serif;padding:30px;direction:rtl;}" +
  "h2{color:#1a3a6b;border-bottom:3px solid #c8972b;padding-bottom:8px;}" +
  ".info p{margin:5px 0;font-size:14px;}" +
  "table{width:100%;border-collapse:collapse;margin-top:20px;font-size:13px;}" +
  "th{background:#1a3a6b;color:white;padding:9px 12px;text-align:right;}" +
  "td{padding:9px 12px;border-bottom:1px solid #e0e0e0;}" +
  "tr:last-child td{border-bottom:none;}" +
  ".footer{margin-top:30px;font-size:12px;color:#888;border-top:1px solid #eee;padding-top:10px;}" +
  ".reject-reason{color:#c0392b;}";

function badge(text, cls) {
  return `<span class="emp-badge ${cls}">${text}</span>`;
}

function openPrintWindow(html) {
  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
  win.print();
}

// ==================== جلب بيانات الطالب (متعدد المراحل) ====================

async function getStudentData(uid, firstRequest) {
  if (!uid) return { uid: "-", fullName: "-", universityId: "-", phoneNumber: "-", major: "-" };

  // 1) البحث بالـ document ID مباشرة
  try {
    const snap = await getDoc(doc(db, "students", uid));
    if (snap.exists()) return { uid, ...snap.data() };
  } catch(e) {}

  // 2) البحث بحقل studentId
  try {
    const q = query(collection(db, "students"), where("studentId", "==", uid));
    const snap = await getDocs(q);
    if (!snap.empty) return { uid, ...snap.docs[0].data() };
  } catch(e) {}

  // 3) البحث بحقل universityId
  try {
    const q = query(collection(db, "students"), where("universityId", "==", uid));
    const snap = await getDocs(q);
    if (!snap.empty) return { uid, ...snap.docs[0].data() };
  } catch(e) {}

  // 4) Fallback من بيانات الطلب نفسه
  if (firstRequest) {
    return {
      uid,
      fullName:     firstRequest.fullName     || firstRequest.studentName || "-",
      universityId: firstRequest.universityId || firstRequest.studentId   || uid,
      phoneNumber:  firstRequest.phoneNumber  || "-",
      major:        firstRequest.major        || "-"
    };
  }

  return { uid, fullName: "-", universityId: uid, phoneNumber: "-", major: "-" };
}

// ==================== مودال سبب الرفض ====================

function injectRejectModal() {
  if (document.getElementById("rejectModal")) return;
  const modal = document.createElement("div");
  modal.id = "rejectModal";
  modal.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;align-items:center;justify-content:center;";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:28px 24px;min-width:320px;max-width:420px;width:90%;direction:rtl;box-shadow:0 8px 32px rgba(0,0,0,.18);">
      <div style="font-size:1.1rem;font-weight:700;color:#1a3a6b;margin-bottom:18px;">سبب الرفض</div>
      <div id="rejectReasonList" style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
        ${REJECT_REASONS.map(r =>
          `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.95rem;">
            <input type="radio" name="rejectReason" value="${r.value}" style="accent-color:#c8972b;width:16px;height:16px;">
            ${r.label}
          </label>`
        ).join("")}
      </div>
      <div id="rejectOtherWrap" style="display:none;margin-bottom:14px;">
        <textarea id="rejectOtherText" placeholder="اكتب سبب الرفض..." rows="3"
          style="width:100%;border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-family:Tajawal,Arial;font-size:0.9rem;resize:vertical;box-sizing:border-box;"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="rejectCancelBtn" style="padding:8px 20px;border:1px solid #ddd;border-radius:8px;background:#f5f5f5;cursor:pointer;font-family:Tajawal,Arial;">إلغاء</button>
        <button id="rejectConfirmBtn" style="padding:8px 20px;border:none;border-radius:8px;background:#c0392b;color:#fff;cursor:pointer;font-weight:700;font-family:Tajawal,Arial;">تأكيد الرفض</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelectorAll('input[name="rejectReason"]').forEach(radio => {
    radio.addEventListener("change", () => {
      document.getElementById("rejectOtherWrap").style.display = radio.value === "other" ? "block" : "none";
    });
  });
  document.getElementById("rejectCancelBtn").addEventListener("click", closeRejectModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeRejectModal(); });
}

function openRejectModal(colName, requestId, onConfirm) {
  const modal = document.getElementById("rejectModal");
  modal.style.display = "flex";
  modal.querySelectorAll('input[name="rejectReason"]').forEach(r => { r.checked = false; });
  document.getElementById("rejectOtherWrap").style.display = "none";
  document.getElementById("rejectOtherText").value = "";

  document.getElementById("rejectConfirmBtn").onclick = async () => {
    const selected = modal.querySelector('input[name="rejectReason"]:checked');
    if (!selected) { alert("رجاءً اختر سبب الرفض"); return; }
    if (selected.value === "other" && !document.getElementById("rejectOtherText").value.trim()) {
      alert("رجاءً اكتب سبب الرفض"); return;
    }
    const reason = selected.value === "other"
      ? document.getElementById("rejectOtherText").value.trim()
      : REJECT_REASONS.find(r => r.value === selected.value).label;
    closeRejectModal();
    await onConfirm(reason);
  };
}

function closeRejectModal() {
  document.getElementById("rejectModal").style.display = "none";
}

// ==================== تحديث الحالة ====================

async function updateStatus(colName, requestId, newStatus, rejectReason) {
  const updateData = {
    status:               newStatus,
    assignedEmployee:     currentEmployee.uid,
    assignedEmployeeName: currentEmployee.fullName || "-",
    updatedAt:            serverTimestamp()
  };
  if (newStatus === "rejected" && rejectReason) updateData.rejectReason = rejectReason;
  await updateDoc(doc(db, colName, requestId), updateData);
}

function attachActionButtons(container, colName, currentStatus, requestId, onDone) {
  container.querySelectorAll(".emp-ab[data-action]").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === "rejected") {
        openRejectModal(colName, requestId, async reason => {
          btn.disabled = true;
          try { await updateStatus(colName, requestId, "rejected", reason); onDone(); }
          catch(err) { alert("خطأ: " + err.message); btn.disabled = false; }
        });
      } else {
        btn.disabled = true;
        try { await updateStatus(colName, requestId, action, null); onDone(); }
        catch(err) { alert("خطأ: " + err.message); btn.disabled = false; }
      }
    });
  });
}

function actionButtons(colName, requestId, currentStatus) {
  if (currentStatus === "approved" || currentStatus === "rejected") return "-";
  return `<button class="emp-ab emp-ab-approve" data-action="approved">قبول</button>
          <button class="emp-ab emp-ab-reject"   data-action="rejected">رفض</button>
          <button class="emp-ab emp-ab-review"   data-action="under_review">مراجعة</button>`;
}

async function getProcessorName(employeeUid) {
  if (!employeeUid) return null;
  try {
    const snap = await getDoc(doc(db, "employees", employeeUid));
    return snap.exists() ? (snap.data().fullName || null) : null;
  } catch(e) { return null; }
}

function worstStatus(list) {
  if (list.some(r => r.status === "pending"))      return "pending";
  if (list.some(r => r.status === "under_review")) return "under_review";
  if (list.some(r => r.status === "approved"))     return "approved";
  return "rejected";
}

// ==================== حذف وإضافة ====================

function buildAddDropExpand(student, requests, colSpan) {
  const initials = (student.fullName || "??").slice(0, 2);
  const rows = requests.map(r => {
    const isEdit = r.requestType === "edit" || r.requestType === "change";
    return `<tr data-req-id="${r.id}">
      <td>${badge(reqTypeLabel[r.requestType] || r.requestType, reqTypeClass[r.requestType] || "")}</td>
      <td>${r.courseName || ""} <span class="emp-muted">${r.courseCode || ""}</span></td>
      <td>${isEdit ? `<strong>${r.requestedSection || "-"}</strong>` : '<span class="emp-muted">-</span>'}</td>
      <td>${badge(statusLabel[r.status] || r.status, statusClass[r.status] || "")}</td>
      <td class="emp-actions-cell">${actionButtons("requests", r.id, r.status)}</td>
    </tr>`;
  }).join("");

  return `<div class="emp-expand-inner">
    <div class="emp-student-info">
      <div class="emp-avatar">${initials}</div>
      <div>
        <div class="emp-sname">${student.fullName || "-"}</div>
        <div class="emp-smeta">الرقم الجامعي: ${student.universityId || student.studentId || "-"}</div>
        <div class="emp-sphone">${student.phoneNumber || "-"}</div>
      </div>
      <button class="emp-print-btn">طباعة</button>
    </div>
    <div class="emp-req-title">طلبات الطالب (${requests.length})</div>
    <table class="emp-req-table">
      <thead><tr><th>نوع الطلب</th><th>المقرر</th><th>الشعبة المطلوبة</th><th>الحالة</th><th>الاجراء</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

async function loadAddDropTable(showDeptCol) {
  const tbody     = document.getElementById("tbody-addDrop");
  const filterSel = document.getElementById("filter-addDrop");
  const colSpan   = showDeptCol ? 5 : 4;
  const types     = ["add", "drop", "edit", "remove", "change"];

  const q = isAffairs
    ? query(collection(db, "requests"), where("requestType", "in", types))
    : query(collection(db, "requests"), where("requestType", "in", types),
            where("assignedDepartment", "==", currentEmployee.department));

  const snap = await getDocs(q);
  if (snap.empty) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="emp-loading">لا توجد طلبات</td></tr>`;
    document.getElementById("badge-addDrop").textContent = "0";
    return;
  }

  const byStudent = {};
  snap.forEach(d => {
    const r = { id: d.id, ...d.data() };
    const key = r.studentUid || r.uid;
    if (!key) return;
    if (!byStudent[key]) byStudent[key] = [];
    byStudent[key].push(r);
  });

  document.getElementById("badge-addDrop").textContent =
    snap.docs.filter(d => d.data().status === "pending").length;

  async function render(statusFilter) {
    tbody.innerHTML = "";
    for (const uid in byStudent) {
      const requests = byStudent[uid];
      const filtered = statusFilter === "all" ? requests : requests.filter(r => r.status === statusFilter);
      if (!filtered.length) continue;

      const sData  = await getStudentData(uid, requests[0]);
      const ws     = worstStatus(filtered);
      const deptTd = showDeptCol ? `<td>${sData.major || "-"}</td>` : "";

      const mainRow = document.createElement("tr");
      mainRow.className = "emp-main-row";
      mainRow.innerHTML = `
        <td>${sData.fullName || "-"}</td>
        <td>${sData.universityId || sData.studentId || "-"}</td>
        ${deptTd}
        <td>${badge(statusLabel[ws], statusClass[ws])}</td>
        <td><button class="emp-detail-btn">التفاصيل <span class="emp-chevron">v</span></button></td>`;

      const expRow = document.createElement("tr");
      expRow.className = "emp-expand-row";
      expRow.style.display = "none";
      expRow.innerHTML = `<td colspan="${colSpan}"></td>`;

      tbody.appendChild(mainRow);
      tbody.appendChild(expRow);

      (function(filtered, sData, expRow, mainRow) {
        mainRow.addEventListener("click", () => {
          const isOpen = expRow.style.display !== "none";
          expRow.style.display = isOpen ? "none" : "table-row";
          mainRow.classList.toggle("emp-row-open", !isOpen);
          mainRow.querySelector(".emp-detail-btn").classList.toggle("emp-btn-open", !isOpen);
          if (!isOpen) {
            expRow.querySelector("td").innerHTML = buildAddDropExpand(sData, filtered, colSpan);
            filtered.forEach(r => {
              const row = expRow.querySelector(`[data-req-id="${r.id}"]`);
              if (row) attachActionButtons(row, "requests", r.status, r.id, () => render(filterSel.value));
            });
            const printBtn = expRow.querySelector(".emp-print-btn");
            if (printBtn) printBtn.addEventListener("click", e => { e.stopPropagation(); printStudent(sData, filtered); });
          }
        });
      })(filtered, sData, expRow, mainRow);
    }
    if (!tbody.children.length)
      tbody.innerHTML = `<tr><td colspan="${colSpan}" class="emp-loading">لا توجد نتائج</td></tr>`;
  }

  await render("all");
  filterSel.addEventListener("change", () => render(filterSel.value));
}

// ==================== الأعذار ====================

function buildExcuseCard(r, sData) {
  const attachBtn = r.attachmentUrl
    ? `<a class="emp-ab emp-ab-approve" href="${r.attachmentUrl}" target="_blank" download>تحميل المرفق</a>`
    : `<span class="emp-muted">لا يوجد مرفق</span>`;
  const rejectNote = (r.status === "rejected" && r.rejectReason)
    ? `<div style="margin-top:6px;color:#c0392b;font-size:0.85rem;">سبب الرفض: ${r.rejectReason}</div>` : "";

  return `<div class="emp-visit-block" data-req-id="${r.id}" style="border:1px solid #e0e0e0;border-radius:10px;padding:16px;margin-bottom:14px;background:#fafbfe;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
      <div style="display:flex;flex-direction:column;gap:5px;font-size:0.9rem;">
        <div><span style="font-weight:700;color:#1a3a6b;">الاسم:</span> ${sData.fullName || "-"}</div>
        <div><span style="font-weight:700;color:#1a3a6b;">الرقم الجامعي:</span> ${sData.universityId || sData.studentId || "-"}</div>
        <div><span style="font-weight:700;color:#1a3a6b;">رمز المقرر:</span> ${r.courseCode || "-"}</div>
        <div><span style="font-weight:700;color:#1a3a6b;">تاريخ الغياب:</span> ${r.absenceDate || r.examDate || "-"}</div>
        <div><span style="font-weight:700;color:#1a3a6b;">سبب الغياب:</span> ${r.reason || r.notes || "-"}</div>
      </div>
      ${badge(statusLabel[r.status] || r.status, statusClass[r.status] || "")}
    </div>
    <div style="margin-bottom:10px;">${attachBtn}</div>
    ${rejectNote}
    <div class="emp-actions-cell" style="margin-top:10px;">${actionButtons("excuses", r.id, r.status)}</div>
  </div>`;
}

function buildExcuseExpand(sData, records) {
  const initials = (sData.fullName || "??").slice(0, 2);
  return `<div class="emp-expand-inner">
    <div class="emp-student-info">
      <div class="emp-avatar">${initials}</div>
      <div>
        <div class="emp-sname">${sData.fullName || "-"}</div>
        <div class="emp-smeta">الرقم الجامعي: ${sData.universityId || sData.studentId || "-"}</div>
      </div>
      <button class="emp-print-btn-excuse">طباعة</button>
    </div>
    <div class="emp-req-title">الأعذار (${records.length})</div>
    ${records.map(r => buildExcuseCard(r, sData)).join("")}
  </div>`;
}

async function loadExcuseTable() {
  const tbody     = document.getElementById("tbody-excuse");
  const filterSel = document.getElementById("filter-excuse");

  async function render(statusFilter) {
    tbody.innerHTML = `<tr><td colspan="5" class="emp-loading">جاري التحميل...</td></tr>`;

    const q = isAffairs
      ? query(collection(db, "excuses"))
      : query(collection(db, "excuses"), where("assignedDepartment", "==", currentEmployee.department));

    const snap = await getDocs(q);
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="5" class="emp-loading">لا توجد طلبات</td></tr>`;
      document.getElementById("badge-excuse").textContent = "0";
      return;
    }

    const byStudent = {};
    snap.forEach(d => {
      const r = { id: d.id, ...d.data() };
      const key = r.studentUid || r.uid;
      if (!key) return;
      if (!byStudent[key]) byStudent[key] = [];
      byStudent[key].push(r);
    });

    document.getElementById("badge-excuse").textContent =
      snap.docs.filter(d => d.data().status === "pending").length;

    tbody.innerHTML = "";
    for (const uid in byStudent) {
      const records  = byStudent[uid];
      const filtered = statusFilter === "all" ? records : records.filter(r => r.status === statusFilter);
      if (!filtered.length) continue;

      const sData      = await getStudentData(uid, records[0]);
      const ws         = worstStatus(filtered);
      const courseCodes = [...new Set(filtered.map(r => r.courseCode).filter(Boolean))].join("، ");

      const mainRow = document.createElement("tr");
      mainRow.className = "emp-main-row";
      mainRow.innerHTML = `
        <td>${sData.universityId || sData.studentId || "-"}</td>
        <td>${sData.fullName || "-"}</td>
        <td><span class="emp-muted">${courseCodes || "-"}</span></td>
        <td>${badge(statusLabel[ws], statusClass[ws])}</td>
        <td><button class="emp-detail-btn">التفاصيل <span class="emp-chevron">v</span></button></td>`;

      const expRow = document.createElement("tr");
      expRow.className = "emp-expand-row";
      expRow.style.display = "none";
      expRow.innerHTML = `<td colspan="5"></td>`;

      tbody.appendChild(mainRow);
      tbody.appendChild(expRow);

      (function(filtered, sData, expRow, mainRow) {
        mainRow.addEventListener("click", () => {
          const isOpen = expRow.style.display !== "none";
          expRow.style.display = isOpen ? "none" : "table-row";
          mainRow.classList.toggle("emp-row-open", !isOpen);
          mainRow.querySelector(".emp-detail-btn").classList.toggle("emp-btn-open", !isOpen);
          if (!isOpen) {
            expRow.querySelector("td").innerHTML = buildExcuseExpand(sData, filtered);
            filtered.forEach(r => {
              const card = expRow.querySelector(`[data-req-id="${r.id}"]`);
              if (card) attachActionButtons(card, "excuses", r.status, r.id, () => render(filterSel.value));
            });
            const printBtn = expRow.querySelector(".emp-print-btn-excuse");
            if (printBtn) printBtn.addEventListener("click", e => { e.stopPropagation(); printExcuses(sData, filtered); });
          }
        });
      })(filtered, sData, expRow, mainRow);
    }
    if (!tbody.children.length)
      tbody.innerHTML = `<tr><td colspan="5" class="emp-loading">لا توجد نتائج</td></tr>`;
  }

  await render("all");
  filterSel.addEventListener("change", () => render(filterSel.value));
}

// ==================== طلبات الزيارة ====================

function buildVisitCard(r) {
  const visitTypeBadge = r.visitType === "external" ? badge("خارجية", "b-drop") : badge("داخلية", "b-add");
  const courses = (r.courses && r.courses.length) ? r.courses : [{ courseCode: "-", courseName: "-", section: "-" }];
  const courseRows = courses.map(c =>
    `<tr><td>${c.courseCode||"-"}</td><td>${c.courseName||"-"}</td><td>${c.section||"-"}</td><td>${c.theoryHours||"0"}</td><td>${c.labHours||"0"}</td></tr>`
  ).join("");
  const rejectNote = (r.status === "rejected" && r.rejectReason)
    ? `<div style="margin-top:6px;color:#c0392b;font-size:0.85rem;">سبب الرفض: ${r.rejectReason}</div>` : "";

  return `<div class="emp-visit-block" data-req-id="${r.id}" style="border:1px solid #e0e0e0;border-radius:10px;padding:14px;margin-bottom:14px;background:#fafbfe;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
      <div style="display:flex;flex-direction:column;gap:4px;font-size:0.9rem;">
        <div><span style="font-weight:700;color:#1a3a6b;">نوع الزيارة:</span> ${visitTypeBadge}</div>
        <div><span style="font-weight:700;color:#1a3a6b;">المستوى الدراسي:</span> ${levelLabel[r.level] || r.level || "-"}</div>
        <div><span style="font-weight:700;color:#1a3a6b;">المقر المراد زيارته:</span> ${r.visitPlace || "-"}</div>
        <div><span style="font-weight:700;color:#1a3a6b;">سبب الزيارة:</span> ${r.reason || "-"}</div>
      </div>
      ${badge(statusLabel[r.status] || r.status, statusClass[r.status] || "")}
    </div>
    <table class="emp-req-table">
      <thead><tr><th>رمز المقرر</th><th>اسم المقرر</th><th>الشعبة</th><th>نظري</th><th>عملي</th></tr></thead>
      <tbody>${courseRows}</tbody>
    </table>
    ${rejectNote}
    <div class="emp-actions-cell" style="margin-top:10px;">${actionButtons("visitRequests", r.id, r.status)}</div>
  </div>`;
}

function buildVisitExpand(sData, records) {
  const initials = (sData.fullName || "??").slice(0, 2);
  return `<div class="emp-expand-inner">
    <div class="emp-student-info">
      <div class="emp-avatar">${initials}</div>
      <div>
        <div class="emp-sname">${sData.fullName || "-"}</div>
        <div class="emp-smeta">الرقم الجامعي: ${sData.universityId || sData.studentId || "-"}</div>
        <div class="emp-smeta">التخصص: ${sData.major || "-"}</div>
      </div>
      <button class="emp-print-btn-visit">طباعة</button>
    </div>
    <div class="emp-req-title">طلبات الزيارة (${records.length})</div>
    ${records.map(buildVisitCard).join("")}
  </div>`;
}

async function loadVisitTable() {
  const tbody           = document.getElementById("tbody-visit");
  const filterSel       = document.getElementById("filter-visit");
  const visitTypeFilter = document.getElementById("filter-visit-type");

  async function render(statusFilter, typeFilter) {
    tbody.innerHTML = `<tr><td colspan="6" class="emp-loading">جاري التحميل...</td></tr>`;

    const snap = await getDocs(query(collection(db, "visitRequests")));
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" class="emp-loading">لا توجد طلبات</td></tr>`;
      document.getElementById("badge-visit").textContent = "0";
      return;
    }

    const byStudent = {};
    snap.forEach(d => {
      const r = { id: d.id, ...d.data() };
      const key = r.uid || r.studentUid;
      if (!key) return;
      if (!byStudent[key]) byStudent[key] = [];
      byStudent[key].push(r);
    });

    document.getElementById("badge-visit").textContent =
      snap.docs.filter(d => d.data().status === "pending").length;

    tbody.innerHTML = "";
    for (const uid in byStudent) {
      const records  = byStudent[uid];
      const filtered = records.filter(r => {
        return (statusFilter === "all" || r.status === statusFilter) &&
               (typeFilter   === "all" || r.visitType === typeFilter);
      });
      if (!filtered.length) continue;

      const sData      = await getStudentData(uid, records[0]);
      const ws         = worstStatus(filtered);
      const courseCodes = [...new Set(filtered.flatMap(r => (r.courses||[]).map(c => c.courseCode)).filter(Boolean))].join("، ");
      const courseNames = [...new Set(filtered.flatMap(r => (r.courses||[]).map(c => c.courseName)).filter(Boolean))].join("، ");

      const mainRow = document.createElement("tr");
      mainRow.className = "emp-main-row";
      mainRow.innerHTML = `
        <td>${sData.universityId || sData.studentId || "-"}</td>
        <td>${sData.fullName || "-"}</td>
        <td><span class="emp-muted">${courseCodes || "-"}</span></td>
        <td>${courseNames || "-"}</td>
        <td>${badge(statusLabel[ws], statusClass[ws])}</td>
        <td><button class="emp-detail-btn">التفاصيل <span class="emp-chevron">v</span></button></td>`;

      const expRow = document.createElement("tr");
      expRow.className = "emp-expand-row";
      expRow.style.display = "none";
      expRow.innerHTML = `<td colspan="6"></td>`;

      tbody.appendChild(mainRow);
      tbody.appendChild(expRow);

      (function(filtered, sData, expRow, mainRow) {
        mainRow.addEventListener("click", () => {
          const isOpen = expRow.style.display !== "none";
          expRow.style.display = isOpen ? "none" : "table-row";
          mainRow.classList.toggle("emp-row-open", !isOpen);
          mainRow.querySelector(".emp-detail-btn").classList.toggle("emp-btn-open", !isOpen);
          if (!isOpen) {
            expRow.querySelector("td").innerHTML = buildVisitExpand(sData, filtered);
            filtered.forEach(r => {
              const card = expRow.querySelector(`[data-req-id="${r.id}"]`);
              if (card) attachActionButtons(card, "visitRequests", r.status, r.id,
                () => render(filterSel.value, visitTypeFilter.value));
            });
            const printBtn = expRow.querySelector(".emp-print-btn-visit");
            if (printBtn) printBtn.addEventListener("click", e => { e.stopPropagation(); printVisitStudent(sData, filtered); });
          }
        });
      })(filtered, sData, expRow, mainRow);
    }
    if (!tbody.children.length)
      tbody.innerHTML = `<tr><td colspan="6" class="emp-loading">لا توجد نتائج</td></tr>`;
  }

  await render("all", "all");
  filterSel.addEventListener("change",       () => render(filterSel.value, visitTypeFilter.value));
  visitTypeFilter.addEventListener("change", () => render(filterSel.value, visitTypeFilter.value));
}

// ==================== طباعة ====================

function printStudent(sData, requests) {
  const reqTypeAr = { add: "اضافة", drop: "حذف", remove: "حذف", edit: "تعديل شعبة", change: "تعديل شعبة" };
  const statusAr  = { pending: "معلق", under_review: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };
  const rows = requests.map(r => {
    const rejectNote = (r.status === "rejected" && r.rejectReason)
      ? `<br><small class="reject-reason">سبب الرفض: ${r.rejectReason}</small>` : "";
    return `<tr>
      <td>${reqTypeAr[r.requestType] || r.requestType}</td>
      <td>${r.courseName || ""} (${r.courseCode || ""})</td>
      <td>${(r.requestType === "edit" || r.requestType === "change") ? (r.requestedSection || "-") : "-"}</td>
      <td>${statusAr[r.status] || r.status}${rejectNote}</td>
      <td>${r.assignedEmployeeName || "-"}</td>
    </tr>`;
  }).join("");

  openPrintWindow(`<html dir="rtl" lang="ar"><head><meta charset="UTF-8"/><title>طباعة</title><style>${PRINT_STYLE}</style></head><body>
    <h2>طلبات الحذف والإضافة - نظام الخدمات الطلابية</h2>
    <div class="info">
      <p><strong>الاسم:</strong> ${sData.fullName || "-"}</p>
      <p><strong>الرقم الجامعي:</strong> ${sData.universityId || sData.studentId || "-"}</p>
      <p><strong>رقم الجوال:</strong> ${sData.phoneNumber || "-"}</p>
      <p><strong>التاريخ:</strong> ${new Date().toLocaleDateString("ar-SA")}</p>
    </div>
    <table><thead><tr><th>نوع الطلب</th><th>المقرر</th><th>الشعبة المطلوبة</th><th>الحالة</th><th>الموظف المعالج</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="footer">طُبع بواسطة: ${currentEmployee.fullName || "-"} - ${currentEmployee.department || "-"}</div>
  </body></html>`);
}

async function printExcuses(sData, records) {
  const statusAr = { pending: "معلق", under_review: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };
  let rows = "";
  for (const r of records) {
    const processorName = r.assignedEmployeeName || (r.assignedEmployee ? await getProcessorName(r.assignedEmployee) : null) || "-";
    const rejectNote = (r.status === "rejected" && r.rejectReason)
      ? `<br><small class="reject-reason">سبب الرفض: ${r.rejectReason}</small>` : "";
    rows += `<tr>
      <td>${r.courseCode || "-"}</td>
      <td>${r.absenceDate || r.examDate || "-"}</td>
      <td>${r.reason || r.notes || "-"}</td>
      <td>${statusAr[r.status] || r.status}${rejectNote}</td>
      <td>${processorName}</td>
    </tr>`;
  }

  openPrintWindow(`<html dir="rtl" lang="ar"><head><meta charset="UTF-8"/><title>طباعة</title><style>${PRINT_STYLE}</style></head><body>
    <h2>أعذار الغياب - نظام الخدمات الطلابية</h2>
    <div class="info">
      <p><strong>الاسم:</strong> ${sData.fullName || "-"}</p>
      <p><strong>الرقم الجامعي:</strong> ${sData.universityId || sData.studentId || "-"}</p>
      <p><strong>التاريخ:</strong> ${new Date().toLocaleDateString("ar-SA")}</p>
    </div>
    <table><thead><tr><th>رمز المقرر</th><th>تاريخ الغياب</th><th>سبب الغياب</th><th>الحالة</th><th>الموظف المعالج</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="footer">طُبع بواسطة: ${currentEmployee.fullName || "-"} - ${currentEmployee.department || "-"}</div>
  </body></html>`);
}

async function printVisitStudent(sData, records) {
  const visitTypeAr = { internal: "داخلية", external: "خارجية" };
  const statusAr    = { pending: "معلق", under_review: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };
  let rows = "";
  for (const r of records) {
    const processorName = r.assignedEmployeeName || (r.assignedEmployee ? await getProcessorName(r.assignedEmployee) : null) || "-";
    const courses = (r.courses && r.courses.length) ? r.courses : [{ courseCode: "-", courseName: "-", section: "-" }];
    const coursesText = courses.map(c =>
      `${c.courseName||"-"} (${c.courseCode||"-"}) - الشعبة: ${c.section||"-"}`
    ).join("<br>");
    const rejectNote = (r.status === "rejected" && r.rejectReason)
      ? `<br><small class="reject-reason">سبب الرفض: ${r.rejectReason}</small>` : "";
    rows += `<tr>
      <td>${visitTypeAr[r.visitType] || r.visitType || "-"}</td>
      <td>${levelLabel[r.level] || r.level || "-"}</td>
      <td>${r.visitPlace || "-"}</td>
      <td>${r.reason || "-"}</td>
      <td>${coursesText}</td>
      <td>${statusAr[r.status] || r.status}${rejectNote}</td>
      <td>${processorName}</td>
    </tr>`;
  }

  openPrintWindow(`<html dir="rtl" lang="ar"><head><meta charset="UTF-8"/><title>طباعة</title><style>${PRINT_STYLE}</style></head><body>
    <h2>طلبات الزيارة - نظام الخدمات الطلابية</h2>
    <div class="info">
      <p><strong>الاسم:</strong> ${sData.fullName || "-"}</p>
      <p><strong>الرقم الجامعي:</strong> ${sData.universityId || sData.studentId || "-"}</p>
      <p><strong>التخصص:</strong> ${sData.major || "-"}</p>
      <p><strong>التاريخ:</strong> ${new Date().toLocaleDateString("ar-SA")}</p>
    </div>
    <table><thead><tr><th>نوع الزيارة</th><th>المستوى</th><th>المقر</th><th>سبب الزيارة</th><th>المقررات</th><th>الحالة</th><th>الموظف المعالج</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="footer">طُبع بواسطة: ${currentEmployee.fullName || "-"} - ${currentEmployee.department || "-"}</div>
  </body></html>`);
}

// ==================== التبويبات ====================

document.querySelectorAll(".emp-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    const tabName = btn.dataset.tab;
    document.querySelectorAll(".emp-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".emp-tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    const content = document.getElementById("tab-" + tabName);
    if (content) content.classList.add("active");
  });
});

// ==================== تسجيل الخروج ====================

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "EmployeeLogin.html";
});

// ==================== Auth ====================

auth.authStateReady().then(() => {
  onAuthStateChanged(auth, async user => {
    if (!user) { window.location.href = "EmployeeLogin.html"; return; }

    const empSnap = await getDoc(doc(db, "employees", user.uid));
    if (!empSnap.exists()) { window.location.href = "EmployeeLogin.html"; return; }

    const empData = empSnap.data();
    if (empData.role !== "employee") { window.location.href = "EmployeeLogin.html"; return; }

    currentEmployee = { uid: user.uid, ...empData };
    isAffairs = empData.department === "شؤون الطالبات";

    document.getElementById("empName").textContent = empData.fullName  || "-";
    document.getElementById("empDept").textContent = empData.department || "-";

    if (isAffairs) {
      const thDept = document.getElementById("th-dept");
      if (thDept) thDept.style.display = "";
    }

    injectRejectModal();

    await loadAddDropTable(isAffairs);
    await loadExcuseTable();
    await loadVisitTable();
  });
});
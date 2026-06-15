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
  var now = new Date();
  var days = ["الاحد","الاثنين","الثلاثاء","الاربعاء","الخميس","الجمعة","السبت"];
  var greg = days[now.getDay()] + "، " + now.toLocaleDateString("ar-SA-u-ca-gregory");
  var hijri = now.toLocaleDateString("ar-SA-u-ca-islamic");
  document.getElementById("gregDate").textContent = greg;
  document.getElementById("hijriDate").textContent = hijri;
}
setDates();

// ==================== ثوابت ====================

var statusLabel = {
  pending: "معلق",
  under_review: "قيد المراجعة",
  approved: "مقبول",
  rejected: "مرفوض"
};
var statusClass = {
  pending: "b-pending",
  under_review: "b-review",
  approved: "b-approved",
  rejected: "b-rejected"
};
var reqTypeLabel = { add: "اضافة", drop: "حذف", edit: "تعديل شعبة" };
var reqTypeClass = { add: "b-add", drop: "b-drop", edit: "b-edit" };
var levelLabel = {
  "1": "المستوى الأول", "2": "المستوى الثاني", "3": "المستوى الثالث",
  "4": "المستوى الرابع", "5": "المستوى الخامس", "6": "المستوى السادس",
  "7": "المستوى السابع", "8": "المستوى الثامن"
};

var REJECT_REASONS = [
  { value: "section_closed",    label: "الشعبة مغلقة" },
  { value: "system_closed",     label: "تم اقفال النظام" },
  { value: "no_contact",        label: "عدم تواصل الطالبة" },
  { value: "conflict",          label: "وجود تعارض" },
  { value: "other",             label: "أخرى" }
];

function badge(text, cls) {
  return '<span class="emp-badge ' + cls + '">' + text + '</span>';
}

// ==================== مودال سبب الرفض ====================

function injectRejectModal() {
  if (document.getElementById("rejectModal")) return;
  var modal = document.createElement("div");
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

  // إظهار حقل "أخرى"
  modal.querySelectorAll('input[name="rejectReason"]').forEach(function(radio) {
    radio.addEventListener("change", function() {
      document.getElementById("rejectOtherWrap").style.display = radio.value === "other" ? "block" : "none";
    });
  });

  document.getElementById("rejectCancelBtn").addEventListener("click", closeRejectModal);
  modal.addEventListener("click", function(e) { if (e.target === modal) closeRejectModal(); });
}

function openRejectModal(colName, requestId, onConfirm) {
  var modal = document.getElementById("rejectModal");
  modal.style.display = "flex";
  // إعادة تعيين
  modal.querySelectorAll('input[name="rejectReason"]').forEach(function(r) { r.checked = false; });
  document.getElementById("rejectOtherWrap").style.display = "none";
  document.getElementById("rejectOtherText").value = "";

  // تعيين handler التأكيد
  var confirmBtn = document.getElementById("rejectConfirmBtn");
  confirmBtn.onclick = async function() {
    var selected = modal.querySelector('input[name="rejectReason"]:checked');
    if (!selected) { alert("رجاءً اختر سبب الرفض"); return; }
    var reason = selected.value === "other"
      ? (document.getElementById("rejectOtherText").value.trim() || "أخرى")
      : REJECT_REASONS.find(function(r) { return r.value === selected.value; }).label;
    if (selected.value === "other" && !document.getElementById("rejectOtherText").value.trim()) {
      alert("رجاءً اكتب سبب الرفض"); return;
    }
    closeRejectModal();
    await onConfirm(reason);
  };
}

function closeRejectModal() {
  document.getElementById("rejectModal").style.display = "none";
}

// ==================== تحديث الحالة ====================

async function updateStatus(colName, requestId, newStatus, rejectReason) {
  var ref = doc(db, colName, requestId);
  var updateData = {
    status: newStatus,
    assignedEmployee: currentEmployee.uid,
    assignedEmployeeName: currentEmployee.fullName || "-",
    updatedAt: serverTimestamp()
  };
  if (newStatus === "rejected" && rejectReason) {
    updateData.rejectReason = rejectReason;
  }
  await updateDoc(ref, updateData);
}

// أزرار الإجراء (مع مودال الرفض)
function attachActionButtons(container, colName, currentStatus, requestId, onDone) {
  container.querySelectorAll(".emp-ab[data-action]").forEach(function(btn) {
    btn.addEventListener("click", async function(e) {
      e.stopPropagation();
      var action = btn.dataset.action;
      if (action === "rejected") {
        openRejectModal(colName, requestId, async function(reason) {
          btn.disabled = true;
          try {
            await updateStatus(colName, requestId, "rejected", reason);
            onDone();
          } catch(err) { alert("خطأ: " + err.message); btn.disabled = false; }
        });
      } else {
        btn.disabled = true;
        try {
          await updateStatus(colName, requestId, action, null);
          onDone();
        } catch(err) { alert("خطأ: " + err.message); btn.disabled = false; }
      }
    });
  });
}

function actionButtons(colName, requestId, currentStatus) {
  if (currentStatus === "approved" || currentStatus === "rejected") return "-";
  return '<button class="emp-ab emp-ab-approve" data-col="' + colName + '" data-id="' + requestId + '" data-action="approved">قبول</button>' +
         '<button class="emp-ab emp-ab-reject"  data-col="' + colName + '" data-id="' + requestId + '" data-action="rejected">رفض</button>' +
         '<button class="emp-ab emp-ab-review"  data-col="' + colName + '" data-id="' + requestId + '" data-action="under_review">مراجعة</button>';
}

// ==================== جلب بيانات الموظف المعالج ====================

async function getProcessorName(employeeUid) {
  if (!employeeUid) return null;
  try {
    var empSnap = await getDoc(doc(db, "employees", employeeUid));
    return empSnap.exists() ? (empSnap.data().fullName || null) : null;
  } catch(e) { return null; }
}

// ==================== حذف واضافة ====================

function buildAddDropExpand(studentData, requests, colSpan) {
  var initials = (studentData.fullName || "??").slice(0, 2);
  var phone = studentData.phoneNumber || "-";

  var reqRows = requests.map(function(r) {
    var isEdit = r.requestType === "edit";
    var sectionTd = isEdit
      ? '<td><strong>' + (r.requestedSection || "-") + '</strong></td>'
      : '<td class="emp-muted">-</td>';
    return '<tr data-req-id="' + r.id + '">' +
      '<td>' + badge(reqTypeLabel[r.requestType] || r.requestType, reqTypeClass[r.requestType] || "") + '</td>' +
      '<td>' + (r.courseName || "") + ' <span class="emp-muted">' + (r.courseCode || "") + '</span></td>' +
      sectionTd +
      '<td>' + badge(statusLabel[r.status] || r.status, statusClass[r.status] || "") + '</td>' +
      '<td class="emp-actions-cell">' + actionButtons("requests", r.id, r.status) + '</td>' +
      '</tr>';
  }).join("");

  return '<div class="emp-expand-inner">' +
    '<div class="emp-student-info">' +
    '<div class="emp-avatar">' + initials + '</div>' +
    '<div>' +
    '<div class="emp-sname">' + (studentData.fullName || "-") + '</div>' +
    '<div class="emp-smeta">الرقم الجامعي: ' + (studentData.universityId || "-") + '</div>' +
    '<div class="emp-sphone">' + phone + '</div>' +
    '</div>' +
    '<button class="emp-print-btn" data-uid="' + studentData.uid + '">طباعة</button>' +
    '</div>' +
    '<div class="emp-req-title">طلبات الطالب (' + requests.length + ')</div>' +
    '<table class="emp-req-table">' +
    '<thead><tr><th>نوع الطلب</th><th>المقرر</th><th>الشعبة المطلوبة</th><th>الحالة</th><th>الاجراء</th></tr></thead>' +
    '<tbody>' + reqRows + '</tbody>' +
    '</table></div>';
}

async function loadAddDropTable(showDeptCol) {
  var tbody = document.getElementById("tbody-addDrop");
  var filterSel = document.getElementById("filter-addDrop");
  var colSpan = showDeptCol ? 5 : 4;

  var q = isAffairs
    ? query(collection(db, "requests"), where("requestType", "in", ["add","drop","edit"]))
    : query(collection(db, "requests"), where("requestType", "in", ["add","drop","edit"]), where("assignedDepartment", "==", currentEmployee.department));

  var snap = await getDocs(q);
  if (snap.empty) {
    tbody.innerHTML = '<tr><td colspan="' + colSpan + '" class="emp-loading">لا توجد طلبات</td></tr>';
    return;
  }

  var byStudent = {};
  snap.forEach(function(d) {
    var r = Object.assign({ id: d.id }, d.data());
    if (!byStudent[r.studentUid]) byStudent[r.studentUid] = [];
    byStudent[r.studentUid].push(r);
  });

  var pendingCount = snap.docs.filter(function(d) { return d.data().status === "pending"; }).length;
  document.getElementById("badge-addDrop").textContent = pendingCount;

  async function render(statusFilter) {
    tbody.innerHTML = "";
    for (var uid in byStudent) {
      var requests = byStudent[uid];
      var filtered = statusFilter === "all" ? requests : requests.filter(function(r) { return r.status === statusFilter; });
      if (!filtered.length) continue;

      var sSnap = await getDoc(doc(db, "students", uid));
      var sData = sSnap.exists() ? Object.assign({ uid: uid }, sSnap.data()) : { uid: uid, fullName: "-", universityId: "-", phoneNumber: "-" };

      var worstStatus =
        filtered.some(function(r) { return r.status === "pending"; }) ? "pending" :
        filtered.some(function(r) { return r.status === "under_review"; }) ? "under_review" :
        filtered.some(function(r) { return r.status === "approved"; }) ? "approved" : "rejected";

      var deptTd = showDeptCol ? '<td>' + (sData.major || "-") + '</td>' : "";

      var mainRow = document.createElement("tr");
      mainRow.className = "emp-main-row";
      mainRow.innerHTML =
        '<td>' + (sData.fullName || "-") + '</td>' +
        '<td>' + (sData.universityId || "-") + '</td>' +
        deptTd +
        '<td>' + badge(statusLabel[worstStatus], statusClass[worstStatus]) + '</td>' +
        '<td><button class="emp-detail-btn">التفاصيل <span class="emp-chevron">v</span></button></td>';

      var expRow = document.createElement("tr");
      expRow.className = "emp-expand-row";
      expRow.style.display = "none";
      expRow.innerHTML = '<td colspan="' + colSpan + '"></td>';

      tbody.appendChild(mainRow);
      tbody.appendChild(expRow);

      (function(uid, filtered, sData, expRow, mainRow, colSpan) {
        mainRow.addEventListener("click", function() {
          var isOpen = expRow.style.display !== "none";
          expRow.style.display = isOpen ? "none" : "table-row";
          mainRow.classList.toggle("emp-row-open", !isOpen);
          mainRow.querySelector(".emp-detail-btn").classList.toggle("emp-btn-open", !isOpen);
          if (!isOpen) {
            expRow.querySelector("td").innerHTML = buildAddDropExpand(sData, filtered, colSpan);
            // ربط أزرار الإجراء
            filtered.forEach(function(r) {
              var reqRow = expRow.querySelector('[data-req-id="' + r.id + '"]');
              if (!reqRow) return;
              attachActionButtons(reqRow, "requests", r.status, r.id, function() { render(filterSel.value); });
            });
            var printBtn = expRow.querySelector(".emp-print-btn");
            if (printBtn) printBtn.addEventListener("click", function(e) { e.stopPropagation(); printStudent(sData, filtered); });
          }
        });
      })(uid, filtered, sData, expRow, mainRow, colSpan);
    }
    if (!tbody.children.length) tbody.innerHTML = '<tr><td colspan="' + colSpan + '" class="emp-loading">لا توجد نتائج</td></tr>';
  }

  await render("all");
  filterSel.addEventListener("change", function() { render(filterSel.value); });
}

// ==================== رفع الاعذار ====================

function buildExcuseCard(r, sData) {
  var attachBtn = r.attachmentUrl
    ? '<a class="emp-ab emp-ab-approve" href="' + r.attachmentUrl + '" target="_blank" download>تحميل المرفق</a>'
    : '<span class="emp-muted">لا يوجد مرفق</span>';

  var actionBtns = actionButtons("excuses", r.id, r.status);
  var rejectNote = (r.status === "rejected" && r.rejectReason)
    ? '<div style="margin-top:6px;color:#c0392b;font-size:0.85rem;">سبب الرفض: ' + r.rejectReason + '</div>'
    : "";

  return '<div class="emp-visit-block" data-req-id="' + r.id + '" style="border:1px solid #e0e0e0;border-radius:10px;padding:16px;margin-bottom:14px;background:#fafbfe;">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px;">' +
      '<div style="display:flex;flex-direction:column;gap:5px;font-size:0.9rem;">' +
        '<div><span style="font-weight:700;color:#1a3a6b;">الاسم:</span> ' + (sData.fullName || "-") + '</div>' +
        '<div><span style="font-weight:700;color:#1a3a6b;">الرقم الجامعي:</span> ' + (sData.universityId || "-") + '</div>' +
        '<div><span style="font-weight:700;color:#1a3a6b;">رمز المقرر:</span> ' + (r.courseCode || "-") + '</div>' +
        '<div><span style="font-weight:700;color:#1a3a6b;">تاريخ الغياب:</span> ' + (r.absenceDate || r.examDate || "-") + '</div>' +
        '<div><span style="font-weight:700;color:#1a3a6b;">سبب الغياب:</span> ' + (r.reason || r.notes || "-") + '</div>' +
      '</div>' +
      badge(statusLabel[r.status] || r.status, statusClass[r.status] || "") +
    '</div>' +
    '<div style="margin-bottom:10px;">' + attachBtn + '</div>' +
    rejectNote +
    '<div class="emp-actions-cell" style="margin-top:10px;">' + actionBtns + '</div>' +
    '</div>';
}

function buildExcuseExpand(studentData, records) {
  var initials = (studentData.fullName || "??").slice(0, 2);
  var cards = records.map(function(r) { return buildExcuseCard(r, studentData); }).join("");

  return '<div class="emp-expand-inner">' +
    '<div class="emp-student-info">' +
    '<div class="emp-avatar">' + initials + '</div>' +
    '<div>' +
    '<div class="emp-sname">' + (studentData.fullName || "-") + '</div>' +
    '<div class="emp-smeta">الرقم الجامعي: ' + (studentData.universityId || "-") + '</div>' +
    '</div>' +
    '<button class="emp-print-btn-excuse">طباعة</button>' +
    '</div>' +
    '<div class="emp-req-title">الأعذار (' + records.length + ')</div>' +
    cards +
    '</div>';
}

async function loadExcuseTable() {
  var tbody = document.getElementById("tbody-excuse");
  var filterSel = document.getElementById("filter-excuse");

  async function render(statusFilter) {
    tbody.innerHTML = '<tr><td colspan="5" class="emp-loading">جاري التحميل...</td></tr>';

    var q = isAffairs
      ? query(collection(db, "excuses"))
      : query(collection(db, "excuses"), where("assignedDepartment", "==", currentEmployee.department));

    var snap = await getDocs(q);

    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="5" class="emp-loading">لا توجد طلبات</td></tr>';
      document.getElementById("badge-excuse").textContent = "0";
      return;
    }

    var byStudent = {};
    snap.forEach(function(d) {
      var r = Object.assign({ id: d.id }, d.data());
      // دعم حقلي studentUid و uid
      var uid = r.studentUid || r.uid;
      if (!uid) return;
      if (!byStudent[uid]) byStudent[uid] = [];
      byStudent[uid].push(r);
    });

    var pendingCount = snap.docs.filter(function(d) { return d.data().status === "pending"; }).length;
    document.getElementById("badge-excuse").textContent = pendingCount;

    tbody.innerHTML = "";
    for (var uid in byStudent) {
      var records = byStudent[uid];
      var filtered = statusFilter === "all" ? records : records.filter(function(r) { return r.status === statusFilter; });
      if (!filtered.length) continue;

      // جلب بيانات الطالب من students أولاً
      var sData = { uid: uid, fullName: "-", universityId: "-" };
      try {
        var sSnap = await getDoc(doc(db, "students", uid));
        if (sSnap.exists()) {
          sData = Object.assign({ uid: uid }, sSnap.data());
        } else {
          // بيانات الطالب قد تكون مخزنة في وثيقة العذر نفسها
          var firstRec = filtered[0];
          sData.fullName     = firstRec.fullName     || firstRec.studentName || "-";
          sData.universityId = firstRec.universityId || firstRec.studentId   || "-";
        }
      } catch(e) {}

      var worstStatus =
        filtered.some(function(r) { return r.status === "pending"; }) ? "pending" :
        filtered.some(function(r) { return r.status === "under_review"; }) ? "under_review" :
        filtered.some(function(r) { return r.status === "approved"; }) ? "approved" : "rejected";

      var courseCodes = [...new Set(filtered.map(function(r) { return r.courseCode; }).filter(Boolean))].join("، ");

      var mainRow = document.createElement("tr");
      mainRow.className = "emp-main-row";
      mainRow.innerHTML =
        '<td>' + (sData.universityId || "-") + '</td>' +
        '<td>' + (sData.fullName || "-") + '</td>' +
        '<td><span class="emp-muted">' + (courseCodes || "-") + '</span></td>' +
        '<td>' + badge(statusLabel[worstStatus], statusClass[worstStatus]) + '</td>' +
        '<td><button class="emp-detail-btn">التفاصيل <span class="emp-chevron">v</span></button></td>';

      var expRow = document.createElement("tr");
      expRow.className = "emp-expand-row";
      expRow.style.display = "none";
      expRow.innerHTML = '<td colspan="5"></td>';

      tbody.appendChild(mainRow);
      tbody.appendChild(expRow);

      (function(filtered, sData, expRow, mainRow) {
        mainRow.addEventListener("click", function() {
          var isOpen = expRow.style.display !== "none";
          expRow.style.display = isOpen ? "none" : "table-row";
          mainRow.classList.toggle("emp-row-open", !isOpen);
          mainRow.querySelector(".emp-detail-btn").classList.toggle("emp-btn-open", !isOpen);
          if (!isOpen) {
            expRow.querySelector("td").innerHTML = buildExcuseExpand(sData, filtered);
            // ربط أزرار الإجراء لكل عذر
            filtered.forEach(function(r) {
              var card = expRow.querySelector('[data-req-id="' + r.id + '"]');
              if (!card) return;
              attachActionButtons(card, "excuses", r.status, r.id, function() { render(filterSel.value); });
            });
            var printBtn = expRow.querySelector(".emp-print-btn-excuse");
            if (printBtn) printBtn.addEventListener("click", function(e) { e.stopPropagation(); printExcuses(sData, filtered); });
          }
        });
      })(filtered, sData, expRow, mainRow);
    }
    if (!tbody.children.length) tbody.innerHTML = '<tr><td colspan="5" class="emp-loading">لا توجد نتائج</td></tr>';
  }

  await render("all");
  filterSel.addEventListener("change", function() { render(filterSel.value); });
}

// ==================== طلبات الزيارة ====================

function buildVisitCard(r) {
  var visitTypeBadge = r.visitType === "external"
    ? badge("خارجية", "b-drop")
    : badge("داخلية", "b-add");

  var courses = (r.courses && r.courses.length) ? r.courses : [{ courseCode: "-", courseName: "-", section: "-" }];
  var courseRows = courses.map(function(c) {
    return '<tr>' +
      '<td>' + (c.courseCode || "-") + '</td>' +
      '<td>' + (c.courseName || "-") + '</td>' +
      '<td>' + (c.section || "-") + '</td>' +
      '<td>' + (c.theoryHours || "0") + '</td>' +
      '<td>' + (c.labHours || "0") + '</td>' +
      '</tr>';
  }).join("");

  var rejectNote = (r.status === "rejected" && r.rejectReason)
    ? '<div style="margin-top:6px;color:#c0392b;font-size:0.85rem;">سبب الرفض: ' + r.rejectReason + '</div>'
    : "";

  return '<div class="emp-visit-block" data-req-id="' + r.id + '" style="border:1px solid #e0e0e0;border-radius:10px;padding:14px;margin-bottom:14px;background:#fafbfe;">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:8px;">' +
      '<div style="display:flex;flex-direction:column;gap:4px;font-size:0.9rem;">' +
        '<div><span style="font-weight:700;color:#1a3a6b;">نوع الزيارة:</span> ' + visitTypeBadge + '</div>' +
        '<div><span style="font-weight:700;color:#1a3a6b;">المستوى الدراسي:</span> ' + (levelLabel[r.level] || r.level || "-") + '</div>' +
        '<div><span style="font-weight:700;color:#1a3a6b;">المقر المراد زيارته:</span> ' + (r.visitPlace || "-") + '</div>' +
        '<div><span style="font-weight:700;color:#1a3a6b;">سبب الزيارة:</span> ' + (r.reason || "-") + '</div>' +
      '</div>' +
      badge(statusLabel[r.status] || r.status, statusClass[r.status] || "") +
    '</div>' +
    '<table class="emp-req-table">' +
      '<thead><tr><th>رمز المقرر</th><th>اسم المقرر</th><th>الشعبة</th><th>نظري</th><th>عملي</th></tr></thead>' +
      '<tbody>' + courseRows + '</tbody>' +
    '</table>' +
    rejectNote +
    '<div class="emp-actions-cell" style="margin-top:10px;">' + actionButtons("visitRequests", r.id, r.status) + '</div>' +
    '</div>';
}

function buildVisitExpand(studentData, records) {
  var initials = (studentData.fullName || "??").slice(0, 2);
  var cards = records.map(buildVisitCard).join("");

  return '<div class="emp-expand-inner">' +
    '<div class="emp-student-info">' +
    '<div class="emp-avatar">' + initials + '</div>' +
    '<div>' +
    '<div class="emp-sname">' + (studentData.fullName || "-") + '</div>' +
    '<div class="emp-smeta">الرقم الجامعي: ' + (studentData.universityId || "-") + '</div>' +
    '<div class="emp-smeta">التخصص: ' + (studentData.major || "-") + '</div>' +
    '</div>' +
    '<button class="emp-print-btn-visit">طباعة</button>' +
    '</div>' +
    '<div class="emp-req-title">طلبات الزيارة (' + records.length + ')</div>' +
    cards +
    '</div>';
}

async function loadVisitTable() {
  var tbody = document.getElementById("tbody-visit");
  var filterSel = document.getElementById("filter-visit");
  var visitTypeFilter = document.getElementById("filter-visit-type");

  async function render(statusFilter, typeFilter) {
    tbody.innerHTML = '<tr><td colspan="6" class="emp-loading">جاري التحميل...</td></tr>';

    var q = query(collection(db, "visitRequests"));
    var snap = await getDocs(q);

    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="6" class="emp-loading">لا توجد طلبات</td></tr>';
      document.getElementById("badge-visit").textContent = "0";
      return;
    }

    var byStudent = {};
    snap.forEach(function(d) {
      var r = Object.assign({ id: d.id }, d.data());
      var uid = r.uid || r.studentUid;
      if (!uid) return;
      if (!byStudent[uid]) byStudent[uid] = [];
      byStudent[uid].push(r);
    });

    var pendingCount = snap.docs.filter(function(d) { return d.data().status === "pending"; }).length;
    document.getElementById("badge-visit").textContent = pendingCount;

    tbody.innerHTML = "";
    for (var uid in byStudent) {
      var records = byStudent[uid];
      var filtered = records.filter(function(r) {
        var matchStatus = statusFilter === "all" || r.status === statusFilter;
        var matchType   = typeFilter   === "all" || r.visitType === typeFilter;
        return matchStatus && matchType;
      });
      if (!filtered.length) continue;

      // جلب بيانات الطالب
      var sData = { uid: uid, fullName: "-", universityId: "-", major: "-" };
      try {
        var sSnap = await getDoc(doc(db, "students", uid));
        if (sSnap.exists()) {
          sData = Object.assign({ uid: uid }, sSnap.data());
        } else {
          var firstRec = filtered[0];
          sData.fullName     = firstRec.fullName     || "-";
          sData.universityId = firstRec.universityId || "-";
          sData.major        = firstRec.major        || "-";
        }
      } catch(e) {}

      var worstStatus =
        filtered.some(function(r) { return r.status === "pending"; }) ? "pending" :
        filtered.some(function(r) { return r.status === "under_review"; }) ? "under_review" :
        filtered.some(function(r) { return r.status === "approved"; }) ? "approved" : "rejected";

      var courseCodes = [...new Set(filtered.flatMap(function(r) {
        return (r.courses || []).map(function(c) { return c.courseCode; });
      }).filter(Boolean))].join("، ");

      var courseNames = [...new Set(filtered.flatMap(function(r) {
        return (r.courses || []).map(function(c) { return c.courseName; });
      }).filter(Boolean))].join("، ");

      var mainRow = document.createElement("tr");
      mainRow.className = "emp-main-row";
      mainRow.innerHTML =
        '<td>' + (sData.universityId || "-") + '</td>' +
        '<td>' + (sData.fullName || "-") + '</td>' +
        '<td><span class="emp-muted">' + (courseCodes || "-") + '</span></td>' +
        '<td>' + (courseNames || "-") + '</td>' +
        '<td>' + badge(statusLabel[worstStatus], statusClass[worstStatus]) + '</td>' +
        '<td><button class="emp-detail-btn">التفاصيل <span class="emp-chevron">v</span></button></td>';

      var expRow = document.createElement("tr");
      expRow.className = "emp-expand-row";
      expRow.style.display = "none";
      expRow.innerHTML = '<td colspan="6"></td>';

      tbody.appendChild(mainRow);
      tbody.appendChild(expRow);

      (function(filtered, sData, expRow, mainRow) {
        mainRow.addEventListener("click", function() {
          var isOpen = expRow.style.display !== "none";
          expRow.style.display = isOpen ? "none" : "table-row";
          mainRow.classList.toggle("emp-row-open", !isOpen);
          mainRow.querySelector(".emp-detail-btn").classList.toggle("emp-btn-open", !isOpen);
          if (!isOpen) {
            expRow.querySelector("td").innerHTML = buildVisitExpand(sData, filtered);
            filtered.forEach(function(r) {
              var card = expRow.querySelector('[data-req-id="' + r.id + '"]');
              if (!card) return;
              attachActionButtons(card, "visitRequests", r.status, r.id, function() { render(filterSel.value, visitTypeFilter.value); });
            });
            var printBtn = expRow.querySelector(".emp-print-btn-visit");
            if (printBtn) printBtn.addEventListener("click", function(e) { e.stopPropagation(); printVisitStudent(sData, filtered); });
          }
        });
      })(filtered, sData, expRow, mainRow);
    }
    if (!tbody.children.length) tbody.innerHTML = '<tr><td colspan="6" class="emp-loading">لا توجد نتائج</td></tr>';
  }

  await render("all", "all");
  filterSel.addEventListener("change", function() { render(filterSel.value, visitTypeFilter.value); });
  visitTypeFilter.addEventListener("change", function() { render(filterSel.value, visitTypeFilter.value); });
}

// ==================== طباعة ====================

var PRINT_STYLE = "body{font-family:Arial,sans-serif;padding:30px;direction:rtl;}" +
  "h2{color:#1a3a6b;border-bottom:3px solid #c8972b;padding-bottom:8px;}" +
  ".info p{margin:5px 0;font-size:14px;}" +
  "table{width:100%;border-collapse:collapse;margin-top:20px;font-size:13px;}" +
  "th{background:#1a3a6b;color:white;padding:9px 12px;text-align:right;}" +
  "td{padding:9px 12px;border-bottom:1px solid #e0e0e0;}" +
  "tr:last-child td{border-bottom:none;}" +
  ".footer{margin-top:30px;font-size:12px;color:#888;border-top:1px solid #eee;padding-top:10px;}" +
  ".reject-reason{color:#c0392b;}";

function openPrintWindow(html) {
  var win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
  win.print();
}

// طباعة حذف/إضافة
function printStudent(sData, requests) {
  var reqTypeAr = { add: "اضافة", drop: "حذف", edit: "تعديل شعبة" };
  var statusAr  = { pending: "معلق", under_review: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };

  var rows = requests.map(function(r) {
    var rejectNote = (r.status === "rejected" && r.rejectReason)
      ? '<br><small class="reject-reason">سبب الرفض: ' + r.rejectReason + '</small>' : "";
    return '<tr>' +
      '<td>' + (reqTypeAr[r.requestType] || r.requestType) + '</td>' +
      '<td>' + (r.courseName || "") + ' (' + (r.courseCode || "") + ')</td>' +
      '<td>' + (r.requestType === "edit" ? (r.requestedSection || "-") : "-") + '</td>' +
      '<td>' + (statusAr[r.status] || r.status) + rejectNote + '</td>' +
      '<td>' + (r.assignedEmployeeName || "-") + '</td>' +
      '</tr>';
  }).join("");

  openPrintWindow('<html dir="rtl" lang="ar"><head><meta charset="UTF-8"/><title>طباعة</title><style>' + PRINT_STYLE + '</style></head><body>' +
    '<h2>طلبات الحذف والإضافة - نظام الخدمات الطلابية</h2>' +
    '<div class="info">' +
    '<p><strong>الاسم:</strong> ' + (sData.fullName || "-") + '</p>' +
    '<p><strong>الرقم الجامعي:</strong> ' + (sData.universityId || "-") + '</p>' +
    '<p><strong>رقم الجوال:</strong> ' + (sData.phoneNumber || "-") + '</p>' +
    '<p><strong>التاريخ:</strong> ' + new Date().toLocaleDateString("ar-SA") + '</p>' +
    '</div>' +
    '<table><thead><tr><th>نوع الطلب</th><th>المقرر</th><th>الشعبة المطلوبة</th><th>الحالة</th><th>الموظف المعالج</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    '<div class="footer">طُبع بواسطة: ' + (currentEmployee.fullName || "-") + ' - ' + (currentEmployee.department || "-") + '</div>' +
    '</body></html>');
}

// طباعة الأعذار
async function printExcuses(sData, records) {
  var statusAr = { pending: "معلق", under_review: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };

  var rows = "";
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var processorName = r.assignedEmployeeName || (r.assignedEmployee ? await getProcessorName(r.assignedEmployee) : null) || "-";
    var rejectNote = (r.status === "rejected" && r.rejectReason)
      ? '<br><small class="reject-reason">سبب الرفض: ' + r.rejectReason + '</small>' : "";
    rows += '<tr>' +
      '<td>' + (r.courseCode || "-") + '</td>' +
      '<td>' + (r.absenceDate || r.examDate || "-") + '</td>' +
      '<td>' + (r.reason || r.notes || "-") + '</td>' +
      '<td>' + (statusAr[r.status] || r.status) + rejectNote + '</td>' +
      '<td>' + processorName + '</td>' +
      '</tr>';
  }

  openPrintWindow('<html dir="rtl" lang="ar"><head><meta charset="UTF-8"/><title>طباعة</title><style>' + PRINT_STYLE + '</style></head><body>' +
    '<h2>أعذار الغياب - نظام الخدمات الطلابية</h2>' +
    '<div class="info">' +
    '<p><strong>الاسم:</strong> ' + (sData.fullName || "-") + '</p>' +
    '<p><strong>الرقم الجامعي:</strong> ' + (sData.universityId || "-") + '</p>' +
    '<p><strong>التاريخ:</strong> ' + new Date().toLocaleDateString("ar-SA") + '</p>' +
    '</div>' +
    '<table><thead><tr><th>رمز المقرر</th><th>تاريخ الغياب</th><th>سبب الغياب</th><th>الحالة</th><th>الموظف المعالج</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    '<div class="footer">طُبع بواسطة: ' + (currentEmployee.fullName || "-") + ' - ' + (currentEmployee.department || "-") + '</div>' +
    '</body></html>');
}

// طباعة الزيارات
async function printVisitStudent(sData, records) {
  var visitTypeAr = { internal: "داخلية", external: "خارجية" };
  var statusAr    = { pending: "معلق", under_review: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };

  var rows = "";
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var processorName = r.assignedEmployeeName || (r.assignedEmployee ? await getProcessorName(r.assignedEmployee) : null) || "-";
    var courses = (r.courses && r.courses.length) ? r.courses : [{ courseCode: "-", courseName: "-", section: "-" }];
    var coursesText = courses.map(function(c) {
      return (c.courseName || "-") + ' (' + (c.courseCode || "-") + ') - الشعبة: ' + (c.section || "-");
    }).join("<br>");
    var rejectNote = (r.status === "rejected" && r.rejectReason)
      ? '<br><small class="reject-reason">سبب الرفض: ' + r.rejectReason + '</small>' : "";
    rows += '<tr>' +
      '<td>' + (visitTypeAr[r.visitType] || r.visitType || "-") + '</td>' +
      '<td>' + (levelLabel[r.level] || r.level || "-") + '</td>' +
      '<td>' + (r.visitPlace || "-") + '</td>' +
      '<td>' + (r.reason || "-") + '</td>' +
      '<td>' + coursesText + '</td>' +
      '<td>' + (statusAr[r.status] || r.status) + rejectNote + '</td>' +
      '<td>' + processorName + '</td>' +
      '</tr>';
  }

  openPrintWindow('<html dir="rtl" lang="ar"><head><meta charset="UTF-8"/><title>طباعة</title><style>' + PRINT_STYLE + '</style></head><body>' +
    '<h2>طلبات الزيارة - نظام الخدمات الطلابية</h2>' +
    '<div class="info">' +
    '<p><strong>الاسم:</strong> ' + (sData.fullName || "-") + '</p>' +
    '<p><strong>الرقم الجامعي:</strong> ' + (sData.universityId || "-") + '</p>' +
    '<p><strong>التخصص:</strong> ' + (sData.major || "-") + '</p>' +
    '<p><strong>التاريخ:</strong> ' + new Date().toLocaleDateString("ar-SA") + '</p>' +
    '</div>' +
    '<table><thead><tr><th>نوع الزيارة</th><th>المستوى</th><th>المقر</th><th>سبب الزيارة</th><th>المقررات</th><th>الحالة</th><th>الموظف المعالج</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    '<div class="footer">طُبع بواسطة: ' + (currentEmployee.fullName || "-") + ' - ' + (currentEmployee.department || "-") + '</div>' +
    '</body></html>');
}

// ==================== تبويبات ====================

document.querySelectorAll(".emp-tab").forEach(function(btn) {
  btn.addEventListener("click", function() {
    var tabName = btn.dataset.tab;
    document.querySelectorAll(".emp-tab").forEach(function(t) { t.classList.remove("active"); });
    document.querySelectorAll(".emp-tab-content").forEach(function(c) { c.classList.remove("active"); });
    btn.classList.add("active");
    var content = document.getElementById("tab-" + tabName);
    if (content) content.classList.add("active");
  });
});

// ==================== تسجيل الخروج ====================

document.getElementById("logoutBtn").addEventListener("click", async function() {
  await signOut(auth);
  window.location.href = "EmployeeLogin.html";
});

// ==================== Auth ====================

auth.authStateReady().then(() => {
  onAuthStateChanged(auth, async function(user) {
    if (!user) { window.location.href = "EmployeeLogin.html"; return; }

  var empSnap = await getDoc(doc(db, "employees", user.uid));
  if (!empSnap.exists()) { window.location.href = "EmployeeLogin.html"; return; }

  var empData = empSnap.data();
  if (empData.role !== "employee") { window.location.href = "EmployeeLogin.html"; return; }

  currentEmployee = Object.assign({ uid: user.uid }, empData);
  isAffairs = empData.department === "شؤون الطالبات";

  document.getElementById("empName").textContent = empData.fullName || "-";
  document.getElementById("empDept").textContent = empData.department || "-";

  if (isAffairs) {
    document.getElementById("th-dept").style.display = "";
  }

  // حقن مودال سبب الرفض
  injectRejectModal();

  await loadAddDropTable(isAffairs);
  await loadExcuseTable();
  await loadVisitTable();
});
});

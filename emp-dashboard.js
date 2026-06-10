import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, collection, query, where, getDocs,
  updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

let currentEmployee = null;
let isAffairs = false;

function setDates() {
  var now = new Date();
  var days = ["الاحد","الاثنين","الثلاثاء","الاربعاء","الخميس","الجمعة","السبت"];
  var greg = days[now.getDay()] + "، " + now.toLocaleDateString("ar-SA-u-ca-gregory");
  var hijri = now.toLocaleDateString("ar-SA-u-ca-islamic");
  document.getElementById("gregDate").textContent = greg;
  document.getElementById("hijriDate").textContent = hijri;
}
setDates();

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

function badge(text, cls) {
  return '<span class="emp-badge ' + cls + '">' + text + '</span>';
}

async function updateStatusInCollection(colName, requestId, newStatus) {
  var ref = doc(db, colName, requestId);
  await updateDoc(ref, {
    status: newStatus,
    assignedEmployee: currentEmployee.uid,
    updatedAt: serverTimestamp()
  });
}

function actionButtons(colName, requestId, currentStatus) {
  if (currentStatus === "approved" || currentStatus === "rejected") return "-";
  return '<button class="emp-ab emp-ab-approve" data-col="' + colName + '" data-id="' + requestId + '" data-action="approved">قبول</button>' +
         '<button class="emp-ab emp-ab-reject" data-col="' + colName + '" data-id="' + requestId + '" data-action="rejected">رفض</button>' +
         '<button class="emp-ab emp-ab-review" data-col="' + colName + '" data-id="' + requestId + '" data-action="under_review">مراجعة</button>';
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
            expRow.querySelectorAll(".emp-ab").forEach(function(btn) {
              btn.addEventListener("click", async function(e) {
                e.stopPropagation();
                btn.disabled = true;
                try {
                  await updateStatusInCollection(btn.dataset.col, btn.dataset.id, btn.dataset.action);
                  await render(filterSel.value);
                } catch(err) { alert("خطأ: " + err.message); btn.disabled = false; }
              });
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

function buildExcuseExpand(studentData, records) {
  var initials = (studentData.fullName || "??").slice(0, 2);

  var rows = records.map(function(r) {
    var attachBtn = r.attachmentUrl
      ? '<a class="emp-ab emp-ab-approve" href="' + r.attachmentUrl + '" target="_blank" download>تحميل المرفق</a>'
      : '<span class="emp-muted">لا يوجد</span>';

    return '<tr>' +
      '<td>' + (r.courseCode || "-") + '</td>' +
      '<td>' + (r.examDate || "-") + '</td>' +
      '<td>' + (r.notes || "-") + '</td>' +
      '<td>' + attachBtn + '</td>' +
      '<td>' + badge(statusLabel[r.status] || r.status, statusClass[r.status] || "") + '</td>' +
      '<td>' + actionButtons("excuses", r.id, r.status) + '</td>' +
      '</tr>';
  }).join("");

  return '<div class="emp-expand-inner">' +
    '<div class="emp-student-info">' +
    '<div class="emp-avatar">' + initials + '</div>' +
    '<div>' +
    '<div class="emp-sname">' + (studentData.fullName || "-") + '</div>' +
    '<div class="emp-smeta">الرقم الجامعي: ' + (studentData.universityId || "-") + '</div>' +
    '</div>' +
    '</div>' +
    '<div class="emp-req-title">الاعذار (' + records.length + ')</div>' +
    '<table class="emp-req-table">' +
    '<thead><tr><th>رمز المقرر</th><th>تاريخ الاختبار</th><th>الملاحظات</th><th>المرفق</th><th>الحالة</th><th>الاجراء</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table></div>';
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
      if (!byStudent[r.studentUid]) byStudent[r.studentUid] = [];
      byStudent[r.studentUid].push(r);
    });

    var pendingCount = snap.docs.filter(function(d) { return d.data().status === "pending"; }).length;
    document.getElementById("badge-excuse").textContent = pendingCount;

    tbody.innerHTML = "";
    for (var uid in byStudent) {
      var records = byStudent[uid];
      var filtered = statusFilter === "all" ? records : records.filter(function(r) { return r.status === statusFilter; });
      if (!filtered.length) continue;

      var sSnap = await getDoc(doc(db, "students", uid));
      var sData = sSnap.exists() ? Object.assign({ uid: uid }, sSnap.data()) : { uid: uid, fullName: "-", universityId: "-" };

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
            expRow.querySelectorAll(".emp-ab[data-col]").forEach(function(btn) {
              btn.addEventListener("click", async function(e) {
                e.stopPropagation();
                btn.disabled = true;
                try {
                  await updateStatusInCollection(btn.dataset.col, btn.dataset.id, btn.dataset.action);
                  await render(filterSel.value);
                } catch(err) { alert("خطأ: " + err.message); btn.disabled = false; }
              });
            });
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

function buildVisitExpand(studentData, records) {
  var initials = (studentData.fullName || "??").slice(0, 2);

  var rows = records.map(function(r) {
    var visitTypeBadge = r.visitType === "external"
      ? badge("خارجية", "b-drop")
      : badge("داخلية", "b-add");

    return '<tr>' +
      '<td>' + visitTypeBadge + '</td>' +
      '<td>' + (r.courseCode || "-") + '</td>' +
      '<td>' + (r.courseName || "-") + '</td>' +
      '<td>' + badge(statusLabel[r.status] || r.status, statusClass[r.status] || "") + '</td>' +
      '<td>' + actionButtons("visits", r.id, r.status) + '</td>' +
      '</tr>';
  }).join("");

  return '<div class="emp-expand-inner">' +
    '<div class="emp-student-info">' +
    '<div class="emp-avatar">' + initials + '</div>' +
    '<div>' +
    '<div class="emp-sname">' + (studentData.fullName || "-") + '</div>' +
    '<div class="emp-smeta">الرقم الجامعي: ' + (studentData.universityId || "-") + '</div>' +
    '</div>' +
    '</div>' +
    '<div class="emp-req-title">طلبات الزيارة (' + records.length + ')</div>' +
    '<table class="emp-req-table">' +
    '<thead><tr><th>نوع الزيارة</th><th>رمز المقرر</th><th>اسم المقرر</th><th>الحالة</th><th>الاجراء</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table></div>';
}

async function loadVisitTable() {
  var tbody = document.getElementById("tbody-visit");
  var filterSel = document.getElementById("filter-visit");
  var visitTypeFilter = document.getElementById("filter-visit-type");

  async function render(statusFilter, typeFilter) {
    tbody.innerHTML = '<tr><td colspan="6" class="emp-loading">جاري التحميل...</td></tr>';

    var q = isAffairs
      ? query(collection(db, "visits"))
      : query(collection(db, "visits"), where("assignedDepartment", "==", currentEmployee.department));

    var snap = await getDocs(q);

    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="6" class="emp-loading">لا توجد طلبات</td></tr>';
      document.getElementById("badge-visit").textContent = "0";
      return;
    }

    var byStudent = {};
    snap.forEach(function(d) {
      var r = Object.assign({ id: d.id }, d.data());
      if (!byStudent[r.studentUid]) byStudent[r.studentUid] = [];
      byStudent[r.studentUid].push(r);
    });

    var pendingCount = snap.docs.filter(function(d) { return d.data().status === "pending"; }).length;
    document.getElementById("badge-visit").textContent = pendingCount;

    tbody.innerHTML = "";
    for (var uid in byStudent) {
      var records = byStudent[uid];
      var filtered = records.filter(function(r) {
        var matchStatus = statusFilter === "all" || r.status === statusFilter;
        var matchType = typeFilter === "all" || r.visitType === typeFilter;
        return matchStatus && matchType;
      });
      if (!filtered.length) continue;

      var sSnap = await getDoc(doc(db, "students", uid));
      var sData = sSnap.exists() ? Object.assign({ uid: uid }, sSnap.data()) : { uid: uid, fullName: "-", universityId: "-" };

      var worstStatus =
        filtered.some(function(r) { return r.status === "pending"; }) ? "pending" :
        filtered.some(function(r) { return r.status === "under_review"; }) ? "under_review" :
        filtered.some(function(r) { return r.status === "approved"; }) ? "approved" : "rejected";

      var courseCodes = [...new Set(filtered.map(function(r) { return r.courseCode; }).filter(Boolean))].join("، ");
      var courseNames = [...new Set(filtered.map(function(r) { return r.courseName; }).filter(Boolean))].join("، ");

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
            expRow.querySelectorAll(".emp-ab[data-col]").forEach(function(btn) {
              btn.addEventListener("click", async function(e) {
                e.stopPropagation();
                btn.disabled = true;
                try {
                  await updateStatusInCollection(btn.dataset.col, btn.dataset.id, btn.dataset.action);
                  await render(filterSel.value, visitTypeFilter.value);
                } catch(err) { alert("خطأ: " + err.message); btn.disabled = false; }
              });
            });
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

function printStudent(sData, requests) {
  var reqTypeAr = { add: "اضافة", drop: "حذف", edit: "تعديل شعبة" };
  var statusAr = { pending: "معلق", under_review: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };

  var rows = requests.map(function(r) {
    return '<tr>' +
      '<td>' + (reqTypeAr[r.requestType] || r.requestType) + '</td>' +
      '<td>' + (r.courseName || "") + ' (' + (r.courseCode || "") + ')</td>' +
      '<td>' + (r.requestType === "edit" ? (r.requestedSection || "-") : "-") + '</td>' +
      '<td>' + (statusAr[r.status] || r.status) + '</td>' +
      '</tr>';
  }).join("");

  var styleBlock = "body{font-family:Arial,sans-serif;padding:30px;direction:rtl;}" +
    "h2{color:#1a3a6b;border-bottom:3px solid #c8972b;padding-bottom:8px;}" +
    ".info p{margin:5px 0;font-size:14px;}" +
    "table{width:100%;border-collapse:collapse;margin-top:20px;font-size:13px;}" +
    "th{background:#1a3a6b;color:white;padding:9px 12px;text-align:right;}" +
    "td{padding:9px 12px;border-bottom:1px solid #e0e0e0;}" +
    "tr:last-child td{border-bottom:none;}" +
    ".footer{margin-top:30px;font-size:12px;color:#888;}";

  var printHTML = '<html dir="rtl" lang="ar"><head><meta charset="UTF-8"/>' +
    '<title>طباعة طلبات الطالب</title>' +
    '<style>' + styleBlock + '<' + '/style></head><body>' +
    '<h2>طلبات الطالب - نظام الخدمات الطلابية</h2>' +
    '<div class="info">' +
    '<p><strong>الاسم:</strong> ' + (sData.fullName || "-") + '</p>' +
    '<p><strong>الرقم الجامعي:</strong> ' + (sData.universityId || "-") + '</p>' +
    '<p><strong>رقم الجوال:</strong> ' + (sData.phoneNumber || "-") + '</p>' +
    '<p><strong>التاريخ:</strong> ' + new Date().toLocaleDateString("ar-SA") + '</p>' +
    '</div>' +
    '<table><thead><tr><th>نوع الطلب</th><th>المقرر</th><th>الشعبة المطلوبة</th><th>الحالة</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    '<div class="footer">تمت المعالجة بواسطة: ' + (currentEmployee.fullName || "-") + ' - ' + (currentEmployee.department || "-") + '</div>' +
    '</body></html>';

  var win = window.open("", "_blank");
  win.document.write(printHTML);
  win.document.close();
  win.print();
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

  await loadAddDropTable(isAffairs);
  await loadExcuseTable();
  await loadVisitTable();
});
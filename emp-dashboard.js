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

/* ==================== التواريخ ==================== */
function setDates() {
  const now = new Date();
  const days = ["الاحد","الاثنين","الثلاثاء","الاربعاء","الخميس","الجمعة","السبت"];
  document.getElementById("gregDate").textContent =
    days[now.getDay()] + "، " + now.toLocaleDateString("ar-SA-u-ca-gregory");
  document.getElementById("hijriDate").textContent =
    now.toLocaleDateString("ar-SA-u-ca-islamic");
}
setDates();

/* ==================== التسميات ==================== */
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
// ✅ دمج مفاتيح الكودين القديم والجديد معاً
const reqTypeLabel = { add: "اضافة", drop: "حذف", remove: "حذف", edit: "تعديل شعبة", change: "تعديل شعبة" };
const reqTypeClass  = { add: "b-add", drop: "b-drop", remove: "b-drop", edit: "b-edit", change: "b-edit" };

function badge(text, cls) {
  return `<span class="emp-badge ${cls}">${text}</span>`;
}

/* ==================== تحديث الحالة ==================== */
async function updateStatusInCollection(colName, requestId, newStatus) {
  const ref = doc(db, colName, requestId);
  await updateDoc(ref, {
    status: newStatus,
    assignedEmployee: currentEmployee.uid,
    updatedAt: serverTimestamp()
  });
}

/* ==================== أزرار الإجراء ==================== */
function actionButtons(colName, requestId, currentStatus) {
  if (currentStatus === "approved" || currentStatus === "rejected") return "-";
  return `
    <button class="emp-ab emp-ab-approve" data-col="${colName}" data-id="${requestId}" data-action="approved">قبول</button>
    <button class="emp-ab emp-ab-reject"  data-col="${colName}" data-id="${requestId}" data-action="rejected">رفض</button>
    <button class="emp-ab emp-ab-review"  data-col="${colName}" data-id="${requestId}" data-action="under_review">مراجعة</button>
  `;
}

/* ==================== مساعد: ربط أزرار الإجراء ==================== */
// يُستدعى بعد حقن HTML داخل expRow لتفادي فقدان الـ listeners عند إعادة الرسم
function bindActionButtons(container, renderFn) {
  container.querySelectorAll(".emp-ab[data-col]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      try {
        await updateStatusInCollection(btn.dataset.col, btn.dataset.id, btn.dataset.action);
        await renderFn();
      } catch (err) {
        alert("خطأ: " + err.message);
        btn.disabled = false;
      }
    });
  });
}

/* ==================== مساعد: جلب بيانات الطالب ==================== */
// يحاول أولاً قراءة البيانات المخزنة مع الطلب، وإن لم توجد يرجع لمجموعة students
async function getStudentData(uid, firstRequest) {
  // إذا كان الطلب يحمل بيانات الطالب مباشرة (الكود الجديد)
  if (firstRequest && firstRequest.fullName) {
    return {
      uid,
      fullName:     firstRequest.fullName,
      universityId: firstRequest.universityId || "-",
      phoneNumber:  firstRequest.phoneNumber  || "-",
      major:        firstRequest.major        || "-"
    };
  }
  // وإلا نجلبها من مجموعة students (الكود القديم)
  const sSnap = await getDoc(doc(db, "students", uid));
  return sSnap.exists()
    ? { uid, ...sSnap.data() }
    : { uid, fullName: "-", universityId: "-", phoneNumber: "-", major: "-" };
}

/* ==================== حذف وإضافة - التوسع ==================== */
function buildAddDropExpand(student, requests, colSpan) {
  const initials = (student.fullName || "??").slice(0, 2);

  const rows = requests.map(r => {
    const isEdit = r.requestType === "edit" || r.requestType === "change";
    const sectionTd = isEdit
      ? `<td><strong>${r.requestedSection || "-"}</strong></td>`
      : `<td class="emp-muted">-</td>`;
    return `
      <tr data-req-id="${r.id}">
        <td>${badge(reqTypeLabel[r.requestType] || r.requestType, reqTypeClass[r.requestType] || "")}</td>
        <td>${r.courseName || ""} <span class="emp-muted">${r.courseCode || ""}</span></td>
        ${sectionTd}
        <td>${badge(statusLabel[r.status] || r.status, statusClass[r.status] || "")}</td>
        <td class="emp-actions-cell">${actionButtons("requests", r.id, r.status)}</td>
      </tr>`;
  }).join("");

  return `
    <div class="emp-expand-inner">
      <div class="emp-student-info">
        <div class="emp-avatar">${initials}</div>
        <div>
          <div class="emp-sname">${student.fullName || "-"}</div>
          <div class="emp-smeta">الرقم الجامعي: ${student.universityId || "-"}</div>
          <div class="emp-sphone">${student.phoneNumber || "-"}</div>
        </div>
        <button class="emp-print-btn" data-uid="${student.uid}">طباعة</button>
      </div>
      <div class="emp-req-title">طلبات الطالب (${requests.length})</div>
      <table class="emp-req-table">
        <thead>
          <tr>
            <th>نوع الطلب</th><th>المقرر</th><th>الشعبة المطلوبة</th>
            <th>الحالة</th><th>الاجراء</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ==================== تحميل جدول الحذف والإضافة ==================== */
async function loadAddDropTable(showDeptCol) {
  const tbody    = document.getElementById("tbody-addDrop");
  const filterSel = document.getElementById("filter-addDrop");
  const colSpan  = showDeptCol ? 5 : 4;

  // ✅ دمج مفاتيح الكودين
  const types = ["add", "drop", "edit", "remove", "change"];

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
    if (!byStudent[r.studentUid]) byStudent[r.studentUid] = [];
    byStudent[r.studentUid].push(r);
  });

  const pendingCount = snap.docs.filter(d => d.data().status === "pending").length;
  document.getElementById("badge-addDrop").textContent = pendingCount;

  async function render(statusFilter) {
    tbody.innerHTML = "";

    for (const uid in byStudent) {
      const requests = byStudent[uid];
      const filtered = statusFilter === "all"
        ? requests
        : requests.filter(r => r.status === statusFilter);
      if (!filtered.length) continue;

      // ✅ جلب بيانات الطالب بالطريقة الموحدة
      const student = await getStudentData(uid, requests[0]);

      const worstStatus =
        filtered.some(r => r.status === "pending")      ? "pending"      :
        filtered.some(r => r.status === "under_review") ? "under_review" :
        filtered.some(r => r.status === "approved")     ? "approved"     : "rejected";

      const deptTd = showDeptCol ? `<td>${student.major || "-"}</td>` : "";

      const mainRow = document.createElement("tr");
      mainRow.className = "emp-main-row";
      mainRow.innerHTML = `
        <td>${student.fullName || "-"}</td>
        <td>${student.universityId || "-"}</td>
        ${deptTd}
        <td>${badge(statusLabel[worstStatus], statusClass[worstStatus])}</td>
        <td><button class="emp-detail-btn">التفاصيل <span class="emp-chevron">v</span></button></td>`;

      const expRow = document.createElement("tr");
      expRow.className = "emp-expand-row";
      expRow.style.display = "none";
      expRow.innerHTML = `<td colspan="${colSpan}"></td>`;

      tbody.appendChild(mainRow);
      tbody.appendChild(expRow);

      mainRow.addEventListener("click", () => {
        const isOpen = expRow.style.display !== "none";
        expRow.style.display = isOpen ? "none" : "table-row";
        mainRow.classList.toggle("emp-row-open", !isOpen);
        mainRow.querySelector(".emp-detail-btn").classList.toggle("emp-btn-open", !isOpen);

        if (!isOpen) {
          expRow.querySelector("td").innerHTML = buildAddDropExpand(student, filtered, colSpan);
          bindActionButtons(expRow, () => render(filterSel.value));

          const printBtn = expRow.querySelector(".emp-print-btn");
          if (printBtn) printBtn.addEventListener("click", e => {
            e.stopPropagation();
            printStudent(student, filtered);
          });
        }
      });
    }

    if (!tbody.children.length)
      tbody.innerHTML = `<tr><td colspan="${colSpan}" class="emp-loading">لا توجد نتائج</td></tr>`;
  }

  await render("all");
  filterSel.addEventListener("change", () => render(filterSel.value));
}

/* ==================== رفع الأعذار - التوسع ==================== */
function buildExcuseExpand(student, records) {
  const initials = (student.fullName || "??").slice(0, 2);

  const rows = records.map(r => {
    const attachBtn = r.attachmentUrl
      ? `<a class="emp-ab emp-ab-approve" href="${r.attachmentUrl}" target="_blank" download>تحميل المرفق</a>`
      : `<span class="emp-muted">لا يوجد</span>`;
    return `
      <tr>
        <td>${r.courseCode || "-"}</td>
        <td>${r.examDate  || "-"}</td>
        <td>${r.notes     || "-"}</td>
        <td>${attachBtn}</td>
        <td>${badge(statusLabel[r.status] || r.status, statusClass[r.status] || "")}</td>
        <td>${actionButtons("excuses", r.id, r.status)}</td>
      </tr>`;
  }).join("");

  return `
    <div class="emp-expand-inner">
      <div class="emp-student-info">
        <div class="emp-avatar">${initials}</div>
        <div>
          <div class="emp-sname">${student.fullName || "-"}</div>
          <div class="emp-smeta">الرقم الجامعي: ${student.universityId || "-"}</div>
        </div>
      </div>
      <div class="emp-req-title">الأعذار (${records.length})</div>
      <table class="emp-req-table">
        <thead>
          <tr>
            <th>رمز المقرر</th><th>تاريخ الاختبار</th><th>الملاحظات</th>
            <th>المرفق</th><th>الحالة</th><th>الاجراء</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ==================== تحميل جدول الأعذار ==================== */
async function loadExcuseTable() {
  const tbody    = document.getElementById("tbody-excuse");
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
      if (!byStudent[r.studentUid]) byStudent[r.studentUid] = [];
      byStudent[r.studentUid].push(r);
    });

    const pendingCount = snap.docs.filter(d => d.data().status === "pending").length;
    document.getElementById("badge-excuse").textContent = pendingCount;

    tbody.innerHTML = "";

    for (const uid in byStudent) {
      const records  = byStudent[uid];
      const filtered = statusFilter === "all"
        ? records
        : records.filter(r => r.status === statusFilter);
      if (!filtered.length) continue;

      // ✅ نفس الطريقة الموحدة
      const student = await getStudentData(uid, records[0]);

      const worstStatus =
        filtered.some(r => r.status === "pending")      ? "pending"      :
        filtered.some(r => r.status === "under_review") ? "under_review" :
        filtered.some(r => r.status === "approved")     ? "approved"     : "rejected";

      const courseCodes = [...new Set(filtered.map(r => r.courseCode).filter(Boolean))].join("، ");

      const mainRow = document.createElement("tr");
      mainRow.className = "emp-main-row";
      mainRow.innerHTML = `
        <td>${student.universityId || "-"}</td>
        <td>${student.fullName    || "-"}</td>
        <td><span class="emp-muted">${courseCodes || "-"}</span></td>
        <td>${badge(statusLabel[worstStatus], statusClass[worstStatus])}</td>
        <td><button class="emp-detail-btn">التفاصيل <span class="emp-chevron">v</span></button></td>`;

      const expRow = document.createElement("tr");
      expRow.className = "emp-expand-row";
      expRow.style.display = "none";
      expRow.innerHTML = `<td colspan="5"></td>`;

      tbody.appendChild(mainRow);
      tbody.appendChild(expRow);

      mainRow.addEventListener("click", () => {
        const isOpen = expRow.style.display !== "none";
        expRow.style.display = isOpen ? "none" : "table-row";
        mainRow.classList.toggle("emp-row-open", !isOpen);
        mainRow.querySelector(".emp-detail-btn").classList.toggle("emp-btn-open", !isOpen);

        if (!isOpen) {
          expRow.querySelector("td").innerHTML = buildExcuseExpand(student, filtered);
          bindActionButtons(expRow, () => render(filterSel.value));
        }
      });
    }

    if (!tbody.children.length)
      tbody.innerHTML = `<tr><td colspan="5" class="emp-loading">لا توجد نتائج</td></tr>`;
  }

  await render("all");
  filterSel.addEventListener("change", () => render(filterSel.value));
}

/* ==================== طلبات الزيارة - التوسع ==================== */
function buildVisitExpand(student, records) {
  const initials = (student.fullName || "??").slice(0, 2);

  const rows = records.map(r => {
    const visitTypeBadge = r.visitType === "external"
      ? badge("خارجية", "b-drop")
      : badge("داخلية", "b-add");

    const courses = (r.courses && r.courses.length) ? r.courses : [{ courseCode: "-", courseName: "-" }];

    return courses.map(c => `
      <tr data-req-id="${r.id}">
        <td>${visitTypeBadge}</td>
        <td>${c.courseCode || "-"}</td>
        <td>${c.courseName || "-"}</td>
        <td>${badge(statusLabel[r.status] || r.status, statusClass[r.status] || "")}</td>
        <td>${actionButtons("visitRequests", r.id, r.status)}</td>
      </tr>`).join("");
  }).join("");

  return `
    <div class="emp-expand-inner">
      <div class="emp-student-info">
        <div class="emp-avatar">${initials}</div>
        <div>
          <div class="emp-sname">${student.fullName || "-"}</div>
          <div class="emp-smeta">الرقم الجامعي: ${student.universityId || "-"}</div>
        </div>
      </div>
      <div class="emp-req-title">طلبات الزيارة (${records.length})</div>
      <table class="emp-req-table">
        <thead>
          <tr>
            <th>نوع الزيارة</th><th>رمز المقرر</th><th>اسم المقرر</th>
            <th>الحالة</th><th>الاجراء</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ==================== تحميل جدول الزيارات ==================== */
async function loadVisitTable() {
  const tbody          = document.getElementById("tbody-visit");
  const filterSel      = document.getElementById("filter-visit");
  const visitTypeFilter = document.getElementById("filter-visit-type");

  async function render(statusFilter, typeFilter) {
    tbody.innerHTML = `<tr><td colspan="6" class="emp-loading">جاري التحميل...</td></tr>`;

    const q = query(collection(db, "visitRequests"));
    const snap = await getDocs(q);

    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" class="emp-loading">لا توجد طلبات</td></tr>`;
      document.getElementById("badge-visit").textContent = "0";
      return;
    }

    const byStudent = {};
    snap.forEach(d => {
      const r = { id: d.id, ...d.data() };
      // ✅ طلبات الزيارة تستخدم r.uid وليس r.studentUid
      const key = r.uid || r.studentUid;
      if (!byStudent[key]) byStudent[key] = [];
      byStudent[key].push(r);
    });

    const pendingCount = snap.docs.filter(d => d.data().status === "pending").length;
    document.getElementById("badge-visit").textContent = pendingCount;

    tbody.innerHTML = "";

    for (const uid in byStudent) {
      const records  = byStudent[uid];
      const filtered = records.filter(r => {
        const matchStatus = statusFilter === "all" || r.status === statusFilter;
        const matchType   = typeFilter   === "all" || r.visitType === typeFilter;
        return matchStatus && matchType;
      });
      if (!filtered.length) continue;

      // ✅ نفس الطريقة الموحدة
      const student = await getStudentData(uid, records[0]);

      const worstStatus =
        filtered.some(r => r.status === "pending")      ? "pending"      :
        filtered.some(r => r.status === "under_review") ? "under_review" :
        filtered.some(r => r.status === "approved")     ? "approved"     : "rejected";

      const courseCodes = [...new Set(
        filtered.flatMap(r => (r.courses || []).map(c => c.courseCode)).filter(Boolean)
      )].join("، ");
      const courseNames = [...new Set(
        filtered.flatMap(r => (r.courses || []).map(c => c.courseName)).filter(Boolean)
      )].join("، ");

      const mainRow = document.createElement("tr");
      mainRow.className = "emp-main-row";
      mainRow.innerHTML = `
        <td>${student.universityId || "-"}</td>
        <td>${student.fullName     || "-"}</td>
        <td><span class="emp-muted">${courseCodes || "-"}</span></td>
        <td>${courseNames || "-"}</td>
        <td>${badge(statusLabel[worstStatus], statusClass[worstStatus])}</td>
        <td><button class="emp-detail-btn">التفاصيل <span class="emp-chevron">v</span></button></td>`;

      const expRow = document.createElement("tr");
      expRow.className = "emp-expand-row";
      expRow.style.display = "none";
      expRow.innerHTML = `<td colspan="6"></td>`;

      tbody.appendChild(mainRow);
      tbody.appendChild(expRow);

      mainRow.addEventListener("click", () => {
        const isOpen = expRow.style.display !== "none";
        expRow.style.display = isOpen ? "none" : "table-row";
        mainRow.classList.toggle("emp-row-open", !isOpen);
        mainRow.querySelector(".emp-detail-btn").classList.toggle("emp-btn-open", !isOpen);

        if (!isOpen) {
          expRow.querySelector("td").innerHTML = buildVisitExpand(student, filtered);
          bindActionButtons(expRow, () => render(filterSel.value, visitTypeFilter.value));
        }
      });
    }

    if (!tbody.children.length)
      tbody.innerHTML = `<tr><td colspan="6" class="emp-loading">لا توجد نتائج</td></tr>`;
  }

  await render("all", "all");
  filterSel.addEventListener("change",      () => render(filterSel.value, visitTypeFilter.value));
  visitTypeFilter.addEventListener("change", () => render(filterSel.value, visitTypeFilter.value));
}

/* ==================== طباعة ==================== */
function printStudent(student, requests) {
  const reqTypeAr = { add: "اضافة", drop: "حذف", remove: "حذف", edit: "تعديل شعبة", change: "تعديل شعبة" };
  const statusAr  = { pending: "معلق", under_review: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };

  const rows = requests.map(r => `
    <tr>
      <td>${reqTypeAr[r.requestType] || r.requestType}</td>
      <td>${r.courseName || ""} (${r.courseCode || ""})</td>
      <td>${(r.requestType === "edit" || r.requestType === "change") ? (r.requestedSection || "-") : "-"}</td>
      <td>${statusAr[r.status] || r.status}</td>
    </tr>`).join("");

  const styleBlock = `
    body { font-family: Arial, sans-serif; padding: 30px; direction: rtl; }
    h2   { color: #1a3a6b; border-bottom: 3px solid #c8972b; padding-bottom: 8px; }
    .info p { margin: 5px 0; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
    th  { background: #1a3a6b; color: white; padding: 9px 12px; text-align: right; }
    td  { padding: 9px 12px; border-bottom: 1px solid #e0e0e0; }
    tr:last-child td { border-bottom: none; }
    .footer { margin-top: 30px; font-size: 12px; color: #888; }`;

  const printHTML = `
    <html dir="rtl" lang="ar">
    <head><meta charset="UTF-8"/><title>طباعة طلبات الطالب</title>
    <style>${styleBlock}</style></head>
    <body>
      <h2>طلبات الطالب - نظام الخدمات الطلابية</h2>
      <div class="info">
        <p><strong>الاسم:</strong> ${student.fullName || "-"}</p>
        <p><strong>الرقم الجامعي:</strong> ${student.universityId || "-"}</p>
        <p><strong>رقم الجوال:</strong> ${student.phoneNumber || "-"}</p>
        <p><strong>التاريخ:</strong> ${new Date().toLocaleDateString("ar-SA")}</p>
      </div>
      <table>
        <thead>
          <tr><th>نوع الطلب</th><th>المقرر</th><th>الشعبة المطلوبة</th><th>الحالة</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="footer">
        تمت المعالجة بواسطة: ${currentEmployee.fullName || "-"} - ${currentEmployee.department || "-"}
      </div>
    </body></html>`;

  const win = window.open("", "_blank");
  win.document.write(printHTML);
  win.document.close();
  win.print();
}

/* ==================== التبويبات ==================== */
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

/* ==================== تسجيل الخروج ==================== */
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "EmployeeLogin.html";
});

/* ==================== Auth ==================== */
onAuthStateChanged(auth, async (user) => {
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

  await loadAddDropTable(isAffairs);
  await loadExcuseTable();
  await loadVisitTable();
});
// Admindashboard.js

import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc as fsDoc,
  getDoc,
  collection,
  query,
  getDocs,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── State ───────────────────────────────────────────────────────────────────
let allData = {
  addDrop: [],
  excuse:  [],
  visit:   []
};

let employeeCache    = {};
let studentCache     = {};
let currentTab       = "addDrop";
let currentFilter    = "all";   // stat card filter (all/pending/approved/rejected)
let searchQuery      = "";
let openRequestId    = null;    // now tracks a single request id
let currentAdminData = null;

// ─── Status maps ─────────────────────────────────────────────────────────────
const STATUS_LABEL = {
  pending:      "معلق",
  under_review: "قيد المراجعة",
  approved:     "مقبول",
  rejected:     "مرفوض"
};

const STATUS_CLASS = {
  pending:      "s-pending",
  under_review: "s-under_review",
  approved:     "s-approved",
  rejected:     "s-rejected"
};

const TAB_LABELS = {
  addDrop: "الحذف والإضافة",
  excuse:  "رفع الأعذار",
  visit:   "طلبات الزيارة"
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const mainTbody     = document.getElementById("mainTbody");
const loadingState  = document.getElementById("loadingState");
const tableWrap     = document.getElementById("tableWrap");
const emptyState    = document.getElementById("emptyState");
const searchInfoBar = document.getElementById("searchInfoBar");
const sidePanel     = document.getElementById("sidePanel");
const spOverlay     = document.getElementById("spOverlay");
const spTitle       = document.getElementById("spTitle");
const spSub         = document.getElementById("spSub");
const spBody        = document.getElementById("spBody");
const adminMain     = document.querySelector(".admin-main");
const tableTitle    = document.getElementById("tableTitle");

// ─── Auth guard ───────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) { window.location.replace("EmployeeLogin.html"); return; }

    const empSnap = await getDoc(fsDoc(db, "employees", user.uid));
    if (!empSnap.exists()) { await signOut(auth); window.location.replace("EmployeeLogin.html"); return; }

    const data = empSnap.data();
    if (!data.isAdmin) { await signOut(auth); window.location.replace("EmployeeLogin.html"); return; }

    currentAdminData = data;
    const adminNameEl = document.getElementById("adminName");
    if (adminNameEl) adminNameEl.textContent = data.fullName ?? "الأدمن";

    setDates();
    await loadAllData();
  } catch (err) {
    console.error("Auth error:", err);
    await signOut(auth);
    window.location.replace("EmployeeLogin.html");
  }
});

// ─── Logout ───────────────────────────────────────────────────────────────────
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try { await signOut(auth); window.location.replace("EmployeeLogin.html"); }
  catch (err) { console.error("Logout error:", err); }
});

// ─── Date display ─────────────────────────────────────────────────────────────
function setDates() {
  const now = new Date();
  document.getElementById("gregDate").textContent =
    now.toLocaleDateString("ar-SA-u-ca-gregory", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
  try {
    document.getElementById("hijriDate").textContent =
      now.toLocaleDateString("ar-SA-u-ca-islamic", {
        year: "numeric", month: "long", day: "numeric"
      });
  } catch (_) { document.getElementById("hijriDate").textContent = ""; }
}

// ─── Load all data ────────────────────────────────────────────────────────────
console.log("db =", db);
console.log("typeof db =", typeof db);
console.log("auth =", auth);
async function loadAllData() {
  try {
    console.log("collection =", collection);
console.log("query =", query);
console.log("getDocs =", getDocs);
console.log("orderBy =", orderBy);
console.log("db =", db);
    console.log("=== loadAllData START ===");

    console.log("1");
    const requestsRef = collection(db, "requests");

    console.log("2");
    const excusesRef = collection(db, "excuses");

    console.log("3");
    const visitsRef = collection(db, "visits");

    console.log("4");
    const reqQuery = query(requestsRef, orderBy("createdAt", "asc"));

    console.log("5");
    const excQuery = query(excusesRef, orderBy("createdAt", "asc"));

    console.log("6");
    const visQuery = query(visitsRef, orderBy("createdAt", "asc"));

    console.log("7");
    const reqSnap = await getDocs(reqQuery);

    console.log("8");
    const excSnap = await getDocs(excQuery);

    console.log("9");
    const visSnap = await getDocs(visQuery);

    console.log("10");
    console.log(reqSnap.size, excSnap.size, visSnap.size);

  } catch (err) {
    console.error("LOAD ERROR:", err);
    throw err;
  }
}
async function fetchStudents(uids) {
  await Promise.all(uids.map(async uid => {
    if (studentCache[uid]) return;
    try {
      const snap = await getDoc(fsDoc(db, "students", uid));
      if (snap.exists()) {
        const d = snap.data();
        studentCache[uid] = {
          fullName:     d.fullName     || "—",
          universityId: d.universityId || "—",
          major:        d.major        || "—",
          phone:        d.phone        || ""
        };
      }
    } catch (_) {}
  }));
}

async function fetchEmployees(uids) {
  await Promise.all(uids.map(async uid => {
    if (employeeCache[uid]) return;
    try {
      const snap = await getDoc(fsDoc(db, "employees", uid));
      if (snap.exists()) employeeCache[uid] = snap.data().fullName || "موظف";
    } catch (_) {}
  }));
}

// ─── Tab badges (total count per type) ───────────────────────────────────────
function updateBadges() {
  document.getElementById("badge-addDrop").textContent = allData.addDrop.length;
  document.getElementById("badge-excuse").textContent  = allData.excuse.length;
  document.getElementById("badge-visit").textContent   = allData.visit.length;
}

// ─── Stat cards (count across all types) ─────────────────────────────────────
function updateStatCards() {
  const all = [...allData.addDrop, ...allData.excuse, ...allData.visit];
  document.getElementById("cnt-all").textContent      = all.length;
  document.getElementById("cnt-pending").textContent  = all.filter(r => r.status === "pending").length;
  document.getElementById("cnt-approved").textContent = all.filter(r => r.status === "approved").length;
  document.getElementById("cnt-rejected").textContent = all.filter(r => r.status === "rejected").length;
}

// ─── Stat card click → filter ─────────────────────────────────────────────────
document.querySelectorAll(".admin-stat-card").forEach(card => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".admin-stat-card").forEach(c => c.classList.remove("active"));
    card.classList.add("active");
    currentFilter = card.dataset.filter;
    // sync status dropdown
    const statusFilter = document.getElementById("statusFilter");
    if (statusFilter) statusFilter.value = currentFilter;
    renderTable();
  });
});

// ─── Tab click ────────────────────────────────────────────────────────────────
document.querySelectorAll(".admin-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentTab = tab.dataset.tab;
    openRequestId = null;
    closePanel();
    renderTable();
  });
});

// ─── Dept filter ──────────────────────────────────────────────────────────────
document.getElementById("deptFilter").addEventListener("change", () => {
  openRequestId = null;
  closePanel();
  renderTable();
});

// ─── Status filter dropdown ───────────────────────────────────────────────────
document.getElementById("statusFilter").addEventListener("change", (e) => {
  currentFilter = e.target.value;
  // sync stat cards
  document.querySelectorAll(".admin-stat-card").forEach(c => {
    c.classList.toggle("active", c.dataset.filter === currentFilter);
  });
  openRequestId = null;
  closePanel();
  renderTable();
});

// ─── Search ───────────────────────────────────────────────────────────────────
document.getElementById("searchInput").addEventListener("input", e => {
  searchQuery = e.target.value.trim();
  renderTable();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getTabDocs() { return allData[currentTab] || []; }
function getDeptFilter() { return document.getElementById("deptFilter").value; }

function matchesDept(record) {
  const dept = getDeptFilter();
  return dept === "all" || (record.assignedDepartment || "") === dept;
}

function matchesStatus(record) {
  if (currentFilter === "all") return true;
  return record.status === currentFilter;
}

function matchesSearch(studentUid) {
  if (!searchQuery) return true;
  const s = studentCache[studentUid];
  if (!s) return false;
  return s.fullName.includes(searchQuery) || s.universityId.includes(searchQuery);
}

function highlight(text, q) {
  if (!q || !text) return text;
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(${esc})`, "gi"), '<mark>$1</mark>');
}

function statusBadge(status) {
  const label = STATUS_LABEL[status] || status;
  const cls   = STATUS_CLASS[status] || "";
  return `<span class="status-badge ${cls}">${label}</span>`;
}

function formatDate(createdAt) {
  if (!createdAt) return "—";
  try {
    const d = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
    return d.toLocaleDateString("ar-SA-u-ca-gregory", {
      year: "numeric", month: "numeric", day: "numeric"
    });
  } catch (_) { return "—"; }
}

// Sort: incomplete (pending/under_review) first (oldest first), then completed (approved/rejected)
function sortDocs(docs) {
  const incomplete = docs.filter(r => r.status === "pending" || r.status === "under_review");
  const complete   = docs.filter(r => r.status === "approved" || r.status === "rejected");
  return [...incomplete, ...complete];
}

// ─── Update table title ───────────────────────────────────────────────────────
function updateTableTitle() {
  const deptVal   = getDeptFilter();
  const deptLabel = deptVal === "all" ? "كل الأقسام" : deptVal;
  if (tableTitle) tableTitle.textContent = `طلبات ${TAB_LABELS[currentTab]} — ${deptLabel}`;
}

// ─── Render table (flat: one row per request) ─────────────────────────────────
function renderTable() {
  updateTableTitle();

  let docs = getTabDocs().filter(r =>
    matchesDept(r) && matchesStatus(r) && matchesSearch(r.studentUid)
  );

  // Apply sorting
  docs = sortDocs(docs);

  if (searchQuery) {
    const uniqueStudents = new Set(docs.map(r => r.studentUid)).size;
    searchInfoBar.style.display = "block";
    searchInfoBar.textContent =
      `نتائج البحث عن "${searchQuery}": ${docs.length} طلب — ${uniqueStudents} طالب`;
  } else {
    searchInfoBar.style.display = "none";
  }

  if (!docs.length) {
    mainTbody.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }
  emptyState.style.display = "none";

  mainTbody.innerHTML = docs.map(record => {
    const s       = studentCache[record.studentUid] || { fullName: "—", universityId: record.studentUid || "—", major: "—" };
    const empName = record.assignedEmployee ? (employeeCache[record.assignedEmployee] || "موظف") : null;
    const isActive = record.id === openRequestId;
    const initials = s.fullName && s.fullName !== "—" ? s.fullName.trim()[0] : "؟";

    return `<tr class="${isActive ? "row-active" : ""}" data-id="${record.id}" data-uid="${record.studentUid || ""}">
      <td>
        <div class="student-name-cell">
          <div class="student-avatar">${initials}</div>
          <div>
            <div class="student-name-text">${highlight(s.fullName, searchQuery)}</div>
            <div class="student-major-text">${s.major}</div>
          </div>
        </div>
      </td>
      <td class="uid-cell">${highlight(s.universityId, searchQuery)}</td>
      <td><span class="dept-chip">${record.assignedDepartment || "—"}</span></td>
      <td class="date-cell">${formatDate(record.createdAt)}</td>
      <td>${statusBadge(record.status)}</td>
      <td>
        ${empName
          ? `<span class="emp-chip"><i class="ti ti-user-check" style="font-size:10px"></i> ${empName}</span>`
          : `<span class="no-emp">— لم يُعالج بعد</span>`}
      </td>
      <td>
        <button class="detail-btn" data-id="${record.id}" data-uid="${record.studentUid || ""}">
          التفاصيل <i class="ti ti-chevron-down detail-chevron ${isActive ? "open" : ""}"></i>
        </button>
      </td>
    </tr>`;
  }).join("");

  // Click listeners
  mainTbody.querySelectorAll("tr").forEach(tr => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".detail-btn")) return; // handled below
      const id  = tr.dataset.id;
      const uid = tr.dataset.uid;
      if (id && uid) openPanel(id, uid);
    });
  });

  mainTbody.querySelectorAll(".detail-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id  = btn.dataset.id;
      const uid = btn.dataset.uid;
      if (id && uid) {
        if (openRequestId === id) { closePanel(); }
        else { openPanel(id, uid); }
      }
    });
  });
}

// ─── Side panel ───────────────────────────────────────────────────────────────
function openPanel(requestId, studentUid) {
  openRequestId = requestId;
  buildSidePanel(requestId, studentUid);
  sidePanel.classList.add("open");
  spOverlay.classList.add("show");
  adminMain.classList.add("panel-open");
  renderTable();
}

function closePanel() {
  openRequestId = null;
  sidePanel.classList.remove("open");
  spOverlay.classList.remove("show");
  adminMain.classList.remove("panel-open");
}

document.getElementById("spCloseBtn").addEventListener("click", () => { closePanel(); renderTable(); });
spOverlay.addEventListener("click", () => { closePanel(); renderTable(); });

function buildSidePanel(requestId, studentUid) {
  const s       = studentCache[studentUid] || { fullName: "—", universityId: studentUid, major: "—", phone: "" };
  const record  = getTabDocs().find(r => r.id === requestId);

  spTitle.textContent = s.fullName;
  spSub.textContent   = `${s.universityId} — ${s.major}`;

  if (!record) {
    spBody.innerHTML = `<div style="padding:24px;text-align:center;color:#a0aec0">لا توجد بيانات</div>`;
    return;
  }

  const empName = record.assignedEmployee
    ? (employeeCache[record.assignedEmployee] || "موظف") : null;
  const dateVal = formatDate(record.createdAt);

  // Build detail rows based on tab type
  let detailRows = "";
  if (currentTab === "addDrop") {
    detailRows = `
      <tr><td class="sp-detail-label">نوع الطلب</td><td>${record.requestType || "—"}</td></tr>
      <tr><td class="sp-detail-label">المقرر</td><td><strong>${record.courseCode || "—"}</strong></td></tr>
      <tr><td class="sp-detail-label">الشعبة</td><td>${record.section || "—"}</td></tr>`;
  } else if (currentTab === "excuse") {
    detailRows = `
      <tr><td class="sp-detail-label">المقرر</td><td><strong>${record.courseCode || "—"}</strong></td></tr>
      <tr><td class="sp-detail-label">سبب الغياب</td><td>${record.reason || "—"}</td></tr>`;
  } else {
    detailRows = `
      <tr><td class="sp-detail-label">نوع الزيارة</td><td>${record.visitType || "—"}</td></tr>
      <tr><td class="sp-detail-label">المقرر</td><td><strong>${record.courseCode || "—"}</strong></td></tr>`;
  }

  // All other requests by same student in this tab
  const otherReqs = getTabDocs().filter(r => r.studentUid === studentUid && r.id !== requestId);

  spBody.innerHTML = `
    <!-- Student Info Card -->
    <div class="sp-student-card">
      <div class="sp-student-name">
        <div class="sp-avatar">${s.fullName[0] || "؟"}</div>
        <div>
          <div>${s.fullName}</div>
          ${s.phone ? `<div class="sp-phone">${s.phone}</div>` : ""}
        </div>
      </div>
      <div class="sp-info-row">
        <div class="sp-info-item"><i class="ti ti-id-badge"></i> ${s.universityId}</div>
        <div class="sp-info-item"><i class="ti ti-book"></i> ${s.major}</div>
      </div>
    </div>

    <!-- Current Request Detail -->
    <div class="sp-section-title">
      <i class="ti ti-file-description" style="color:#1a3a6b"></i>
      تفاصيل الطلب الحالي
    </div>

    <div class="sp-detail-card">
      <table class="sp-detail-table">
        <tbody>
          ${detailRows}
          <tr><td class="sp-detail-label">القسم</td><td><span class="dept-chip" style="font-size:10px">${record.assignedDepartment || "—"}</span></td></tr>
          <tr><td class="sp-detail-label">الحالة</td><td>${statusBadge(record.status)}</td></tr>
          <tr><td class="sp-detail-label">تاريخ الطلب</td><td>${dateVal}</td></tr>
          <tr><td class="sp-detail-label">الموظف</td><td>
            ${empName
              ? `<span class="emp-chip">${empName}</span>`
              : `<span class="no-emp">لم يُعالج بعد</span>`}
          </td></tr>
          ${record.notes ? `<tr><td class="sp-detail-label">ملاحظات</td><td>${record.notes}</td></tr>` : ""}
        </tbody>
      </table>
    </div>

    <!-- Action Buttons -->
    <div class="sp-actions">
      <button class="sp-action-btn sp-approve" data-id="${record.id}" data-uid="${studentUid}" ${record.status === "approved" ? "disabled" : ""}>
        <i class="ti ti-circle-check"></i> قبول
      </button>
      <button class="sp-action-btn sp-reject" data-id="${record.id}" data-uid="${studentUid}" ${record.status === "rejected" ? "disabled" : ""}>
        <i class="ti ti-circle-x"></i> رفض
      </button>
      <button class="sp-action-btn sp-review" data-id="${record.id}" data-uid="${studentUid}" ${record.status === "under_review" ? "disabled" : ""}>
        <i class="ti ti-eye"></i> مراجعة
      </button>
    </div>

    ${otherReqs.length > 0 ? `
    <!-- Other requests by same student -->
    <div class="sp-section-title" style="margin-top:16px">
      <i class="ti ti-files" style="color:#1a3a6b"></i>
      طلبات أخرى لنفس الطالب (${otherReqs.length})
    </div>
    <div class="sp-table-wrap">
      <table class="sp-table">
        <thead>
          <tr>
            <th>المقرر</th>
            <th>الحالة</th>
            <th>التاريخ</th>
          </tr>
        </thead>
        <tbody>
          ${otherReqs.map(r => `
            <tr class="sp-other-row" data-id="${r.id}" data-uid="${studentUid}" style="cursor:pointer">
              <td style="font-weight:500">${r.courseCode || "—"}</td>
              <td>${statusBadge(r.status)}</td>
              <td style="color:#64748b;font-size:11px">${formatDate(r.createdAt)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>` : ""}
  `;

  // Action button listeners (placeholders — wire to Firestore as needed)
  spBody.querySelectorAll(".sp-action-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id  = btn.dataset.id;
      const uid = btn.dataset.uid;
      let newStatus = "";
      if (btn.classList.contains("sp-approve")) newStatus = "approved";
      else if (btn.classList.contains("sp-reject"))  newStatus = "rejected";
      else if (btn.classList.contains("sp-review"))  newStatus = "under_review";
      if (newStatus) await updateRequestStatus(id, newStatus, uid);
    });
  });

  // Other row clicks
  spBody.querySelectorAll(".sp-other-row").forEach(row => {
    row.addEventListener("click", () => openPanel(row.dataset.id, row.dataset.uid));
  });
}

// ─── Update request status ────────────────────────────────────────────────────
async function updateRequestStatus(requestId, newStatus, studentUid) {
  const collectionName = currentTab === "addDrop" ? "requests"
    : currentTab === "excuse" ? "excuses" : "visits";

  try {
    const { updateDoc, doc: fsD } = await import(
      "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
    );
    await updateDoc(fsD(db, collectionName, requestId), {
      status: newStatus,
      assignedEmployee: auth.currentUser?.uid || null,
      updatedAt: new Date()
    });

    // Update local cache
    const arr = allData[currentTab];
    const idx = arr.findIndex(r => r.id === requestId);
    if (idx !== -1) {
      arr[idx].status           = newStatus;
      arr[idx].assignedEmployee = auth.currentUser?.uid || null;
    }

    updateStatCards();
    renderTable();
    if (openRequestId === requestId) buildSidePanel(requestId, studentUid);
  } catch (err) {
    console.error("updateRequestStatus error:", err);
    alert("حدث خطأ أثناء تحديث الحالة");
  }
}

// ─── Print ────────────────────────────────────────────────────────────────────
document.getElementById("spPrintBtn").addEventListener("click", () => {
  if (!openRequestId) return;

  const record = getTabDocs().find(r => r.id === openRequestId);
  if (!record) return;

  const uid     = record.studentUid;
  const s       = studentCache[uid] || { fullName: "—", universityId: uid, major: "—" };
  const empName = record.assignedEmployee ? (employeeCache[record.assignedEmployee] || "موظف") : "—";
  const now     = new Date();
  const dateStr = now.toLocaleDateString("ar-SA-u-ca-gregory", { year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });

  // All student requests in this tab
  const allStudentReqs = getTabDocs().filter(r => r.studentUid === uid);

  const rows = allStudentReqs.map(r => {
    const rEmp  = r.assignedEmployee ? (employeeCache[r.assignedEmployee] || "موظف") : "—";
    const rDate = formatDate(r.createdAt);
    return `<tr>
      <td>${r.courseCode || "—"}</td>
      <td>${r.requestType || r.visitType || "—"}</td>
      <td>${r.assignedDepartment || "—"}</td>
      <td>${STATUS_LABEL[r.status] || r.status}</td>
      <td>${rEmp}</td>
      <td>${rDate}</td>
    </tr>`;
  }).join("");

  const printHTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>طباعة — ${s.fullName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; padding: 30px 36px; font-size: 13px; color: #2d3748; }
  .ph { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1a3a6b; padding-bottom: 14px; margin-bottom: 18px; }
  .ph-logo { height: 60px; width: auto; }
  .ph-center { text-align: center; }
  .ph-center .main-title { font-size: 17px; font-weight: 700; color: #1a3a6b; }
  .ph-center .sub-title { font-size: 12px; color: #64748b; margin-top: 4px; }
  .ph-date { font-size: 11px; color: #64748b; text-align: left; line-height: 1.7; }
  .student-info { background: #f8fafc; border-radius: 8px; border: 0.5px solid #e2e8f0; padding: 12px 16px; margin-bottom: 18px; display: flex; gap: 30px; flex-wrap: wrap; }
  .info-item .label { font-size: 11px; color: #64748b; margin-bottom: 2px; }
  .info-item .value { font-size: 13px; font-weight: 600; color: #1a3a6b; }
  .section-title { font-size: 13px; font-weight: 600; color: #1a3a6b; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 0.5px solid #e2e8f0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead th { background: #e8edf7; color: #1a3a6b; padding: 8px 12px; text-align: right; font-weight: 600; border-bottom: 1px solid #c6d4e8; }
  tbody td { padding: 8px 12px; text-align: right; border-bottom: 0.5px solid #e2e8f0; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  .footer { margin-top: 24px; font-size: 10px; color: #aaa; text-align: center; border-top: 0.5px solid #e2e8f0; padding-top: 10px; }
  @media print { body { padding: 20px 24px; } }
</style>
</head>
<body>
  <div class="ph">
    <img src="images/Qassim_University_logo.svg.png" class="ph-logo" alt="شعار جامعة القصيم" />
    <div class="ph-center">
      <div class="main-title">جامعة القصيم — نظام الخدمات الطلابية</div>
      <div class="sub-title">تقرير طلبات الطالب — ${TAB_LABELS[currentTab]}</div>
    </div>
    <div class="ph-date">
      <div>تاريخ الطباعة: ${dateStr}</div>
      <div>الوقت: ${timeStr}</div>
    </div>
  </div>
  <div class="student-info">
    <div class="info-item"><div class="label">اسم الطالب</div><div class="value">${s.fullName}</div></div>
    <div class="info-item"><div class="label">الرقم الجامعي</div><div class="value">${s.universityId}</div></div>
    <div class="info-item"><div class="label">التخصص</div><div class="value">${s.major}</div></div>
    <div class="info-item"><div class="label">عدد الطلبات</div><div class="value">${allStudentReqs.length}</div></div>
  </div>
  <div class="section-title">قائمة الطلبات</div>
  <table>
    <thead>
      <tr>
        <th>رمز المقرر</th><th>النوع</th><th>القسم</th>
        <th>الحالة</th><th>الموظف المعالج</th><th>التاريخ</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    نظام الخدمات الطلابية — جامعة القصيم &nbsp;|&nbsp;
    طُبع بواسطة: ${currentAdminData?.fullName || "الأدمن"}
  </div>
</body>
</html>`;

  const w = window.open("", "_blank", "width=900,height=650");
  w.document.write(printHTML);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 500);
});
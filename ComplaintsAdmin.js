import { auth, db } from "./firebase.js";
import {
  collection, query, getDocs, doc, getDoc, updateDoc, serverTimestamp, onSnapshot, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ── خريطة مفاتيح الأقسام ───────────────────────────
const DEPT_AR = {
  physics:    "قسم الفيزياء",
  statistics: "قسم الإحصاء",
  math:       "قسم الرياضيات",
  biology:    "قسم الأحياء",
  chemistry:  "قسم الكيمياء",
  college:    "الكلية",
};

const COMPLAINT_STATUS_LABEL = {
  new:          "جديد",
  under_review: "قيد المراجعة",
  resolved:     "تمت المعالجة",
  dismissed:    "مرفوض",
};

const TYPE_ICON = {
  "شكوى":     "ti-alert-circle",
  "اقتراح":   "ti-bulb",
  "استفسار":  "ti-help-circle",
};

// ── state ───────────────────────────────────────────
let complaintsData       = [];
let cStatusFilter        = "all";
let cSearchQuery         = "";
let cTargetFilter        = "all";
let cTypeFilter          = "all";
let activeComplaint      = null;
let currentAdminUid      = null;
let currentAdminName     = "الأدمن";
let unsubscribeComplaints = null;
let alreadyInitialized    = false;  // يمنع التهيئة المزدوجة عند تكرار onAuthStateChanged
const studentsCache       = {};     // كاش بيانات الطلاب (الاسم والرقم الجامعي)

// ── جلب بيانات الطالب (الاسم والرقم الجامعي) ────────
async function getStudentInfo(uid) {
  if (!uid) return null;
  if (studentsCache[uid]) return studentsCache[uid];

  try {
    const docSnap = await getDoc(doc(db, "students", uid));
    if (docSnap.exists()) {
      studentsCache[uid] = { _uid: uid, ...docSnap.data() };
      return studentsCache[uid];
    }
  } catch (e) {}

  try {
    const q = query(collection(db, "students"), where("studentId", "==", uid));
    const snap = await getDocs(q);
    if (!snap.empty) {
      studentsCache[uid] = { _uid: uid, ...snap.docs[0].data() };
      return studentsCache[uid];
    }
  } catch (e) {}

  studentsCache[uid] = { _uid: uid, fullName: "-", studentId: "-" };
  return studentsCache[uid];
}

// ── حقن التبويب في السايدبار ────────────────────────
function injectSidebarTab() {
  const nav = document.querySelector(".sb-nav");
  if (!nav || document.getElementById("navComplaintsAdmin")) return;

  const item = document.createElement("div");
  item.className  = "sb-nav-item admin-tab";
  item.dataset.tab = "complaints";
  item.id          = "navComplaintsAdmin";
  item.innerHTML   = `
    <i class="ti ti-message-report"></i>
    <span>الشكاوى والاقتراحات</span>
    <span class="sb-badge admin-tab-badge" id="badge-complaints">0</span>
  `;
  nav.appendChild(item);

  item.addEventListener("click", () => switchToComplaints());
}

// ── حقن قسم HTML داخل main ─────────────────────────
function injectComplaintsSection() {
  if (document.getElementById("complaintsSection")) return;

  const main = document.querySelector(".admin-main");
  if (!main) return;

  const section = document.createElement("div");
  section.id        = "complaintsSection";
  section.style.display = "none";
  section.innerHTML = `

    <!-- بطاقات الإحصاء -->
    <div class="admin-stats-grid" id="cStatsGrid">
      <div class="admin-stat-card emp-stat-card stat-total active" data-cfilter="all">
        <div class="stat-icon"><i class="ti ti-copy"></i></div>
        <div class="stat-num" id="c-cnt-all">0</div>
        <div class="stat-label">الكل</div>
      </div>
      <div class="admin-stat-card emp-stat-card stat-new" data-cfilter="new">
        <div class="stat-icon"><i class="ti ti-sparkles"></i></div>
        <div class="stat-num" id="c-cnt-new">0</div>
        <div class="stat-label">جديد</div>
      </div>
      <div class="admin-stat-card emp-stat-card stat-review" data-cfilter="under_review">
        <div class="stat-icon"><i class="ti ti-loader-2"></i></div>
        <div class="stat-num" id="c-cnt-under_review">0</div>
        <div class="stat-label">قيد المراجعة</div>
      </div>
      <div class="admin-stat-card emp-stat-card stat-approved" data-cfilter="resolved">
        <div class="stat-icon"><i class="ti ti-circle-check"></i></div>
        <div class="stat-num" id="c-cnt-resolved">0</div>
        <div class="stat-label">تمت المعالجة</div>
      </div>
      <div class="admin-stat-card emp-stat-card stat-rejected" data-cfilter="dismissed">
        <div class="stat-icon"><i class="ti ti-circle-x"></i></div>
        <div class="stat-num" id="c-cnt-dismissed">0</div>
        <div class="stat-label">مرفوض</div>
      </div>
    </div>

    <!-- الجدول -->
    <div class="admin-table-card">
      <div class="admin-search-row">
        <div class="admin-search-bar">
          <i class="ti ti-search admin-search-icon"></i>
          <input type="text" id="cSearchInput" placeholder="ابحث بالعنوان..." autocomplete="off" />
        </div>
        <div class="dept-filter-pill">
          <i class="ti ti-filter"></i>
          <select id="cTargetFilter">
            <option value="all">كل الجهات</option>
            <option value="college">الكلية</option>
            <option value="physics">قسم الفيزياء</option>
            <option value="statistics">قسم الإحصاء</option>
            <option value="math">قسم الرياضيات</option>
            <option value="biology">قسم الأحياء</option>
            <option value="chemistry">قسم الكيمياء</option>
          </select>
        </div>
        <div class="dept-filter-pill">
          <i class="ti ti-category"></i>
          <select id="cTypeFilter">
            <option value="all">كل الأنواع</option>
            <option value="شكوى">شكوى</option>
            <option value="استفسار">استفسار</option>
            <option value="اقتراح">اقتراح</option>
          </select>
        </div>
      </div>

      <div class="admin-table-wrap" id="cTableWrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>الطالب</th>
              <th>النوع</th>
              <th>العنوان</th>
              <th>الجهة</th>
              <th>الحالة</th>
              <th>التاريخ</th>
              <th>التفاصيل</th>
            </tr>
          </thead>
          <tbody id="cTbody"></tbody>
        </table>
        <div class="admin-empty" id="cEmpty" style="display:none">
          <i class="ti ti-inbox-off"></i>
          <p>لا توجد شكاوى مطابقة</p>
        </div>
      </div>
    </div>

    <!-- اللوحة الجانبية للشكوى -->
    <div class="admin-side-panel" id="cSidePanel">
      <div class="sp-header">
        <div>
          <div class="sp-title" id="cSpTitle">تفاصيل الشكوى</div>
          <div class="sp-sub"  id="cSpSub"></div>
        </div>
        <button class="sp-close-btn" id="cSpClose"><i class="ti ti-x"></i></button>
      </div>
      <div class="sp-body" id="cSpBody"></div>
      <div class="sp-footer" style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="sp-action-btn sp-review"   data-caction="under_review" id="cBtnReview">
          <i class="ti ti-loader-2"></i> قيد المراجعة
        </button>
        <button class="sp-action-btn sp-approve"  data-caction="resolved"     id="cBtnResolve">
          <i class="ti ti-circle-check"></i> تمت المعالجة
        </button>
        <button class="sp-action-btn sp-reject"   data-caction="dismissed"    id="cBtnDismiss">
          <i class="ti ti-circle-x"></i> رفض
        </button>
      </div>
    </div>
    <div class="sp-overlay" id="cSpOverlay"></div>
  `;

  main.appendChild(section);

  // أحداث البطاقات
  section.querySelectorAll("[data-cfilter]").forEach(card => {
    card.addEventListener("click", () => {
      cStatusFilter = card.dataset.cfilter;
      section.querySelectorAll("[data-cfilter]").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      renderComplaints();
    });
  });

  // البحث
  let debounce = null;
  section.querySelector("#cSearchInput").addEventListener("input", e => {
    cSearchQuery = e.target.value;
    clearTimeout(debounce);
    debounce = setTimeout(renderComplaints, 200);
  });

  // فلتر الجهة
  section.querySelector("#cTargetFilter").addEventListener("change", e => {
    cTargetFilter = e.target.value;
    renderComplaints();
  });

  // فلتر النوع (شكوى / استفسار / اقتراح)
  section.querySelector("#cTypeFilter").addEventListener("change", e => {
    cTypeFilter = e.target.value;
    renderComplaints();
  });

  // إغلاق اللوحة
  section.querySelector("#cSpClose").addEventListener("click",   closeComplaintPanel);
  section.querySelector("#cSpOverlay").addEventListener("click", closeComplaintPanel);

  // أزرار الحالة
  ["cBtnReview","cBtnResolve","cBtnDismiss"].forEach(id => {
    section.querySelector(`#${id}`).addEventListener("click", () => {
      if (!activeComplaint) return;
      const action = section.querySelector(`#${id}`).dataset.caction;
      updateComplaintStatus(activeComplaint, action);
    });
  });
}

// ── الاشتراك في Firestore (realtime) ───────────────
function subscribeComplaints() {
  if (unsubscribeComplaints) unsubscribeComplaints();

  unsubscribeComplaints = onSnapshot(
    collection(db, "complaints"),
    snap => {
      complaintsData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateComplaintsBadge();
      if (document.getElementById("complaintsSection")?.style.display !== "none") {
        renderComplaints();
      }
    },
    err => console.error("complaints snapshot error:", err)
  );
}

function updateComplaintsBadge() {
  const el = document.getElementById("badge-complaints");
  if (el) el.textContent = complaintsData.filter(c => c.status === "new" || !c.status).length;
}

// ── عرض الجدول ─────────────────────────────────────
function renderComplaints() {
  let filtered = [...complaintsData];

  if (cStatusFilter !== "all") {
    filtered = filtered.filter(c => (c.status || "new") === cStatusFilter);
  }
  if (cTargetFilter !== "all") {
    filtered = filtered.filter(c =>
      cTargetFilter === "college"
        ? c.target === "college"
        : c.departmentKey === cTargetFilter
    );
  }
  if (cTypeFilter !== "all") {
    filtered = filtered.filter(c => (c.type || "شكوى") === cTypeFilter);
  }
  const q = cSearchQuery.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(c =>
      (c.subject || "").toLowerCase().includes(q) ||
      (c.details || "").toLowerCase().includes(q)
    );
  }

  // ترتيب: جديد أولاً ثم الأحدث
  filtered.sort((a, b) => {
    const order = { new: 0, under_review: 1, resolved: 2, dismissed: 2 };
    const oa = order[a.status || "new"] ?? 3;
    const ob = order[b.status || "new"] ?? 3;
    if (oa !== ob) return oa - ob;
    const ta = a.createdAt?.toMillis?.() ?? 0;
    const tb = b.createdAt?.toMillis?.() ?? 0;
    return tb - ta;
  });

  // إحصاء البطاقات
  const counts = { all: complaintsData.length, new: 0, under_review: 0, resolved: 0, dismissed: 0 };
  complaintsData.forEach(c => { const s = c.status || "new"; if (counts[s] !== undefined) counts[s]++; });
  Object.entries(counts).forEach(([k, v]) => {
    const el = document.getElementById(`c-cnt-${k}`);
    if (el) el.textContent = v;
  });

  const tbody = document.getElementById("cTbody");
  const empty = document.getElementById("cEmpty");
  tbody.innerHTML = "";

  if (!filtered.length) {
    empty.style.display = "";
    return;
  }
  empty.style.display = "none";

  renderRowsWithStudents(filtered, tbody);
}

async function renderRowsWithStudents(filtered, tbody) {
  const studentInfos = await Promise.all(
    filtered.map(c => getStudentInfo(c.studentUid))
  );

  filtered.forEach((c, i) => {
    const status    = c.status || "new";
    const targetTxt = c.target === "college"
      ? "الكلية"
      : (DEPT_AR[c.departmentKey] || c.targetAr || c.departmentKey || "-");
    const icon      = TYPE_ICON[c.type] || "ti-message";
    const dateStr   = c.createdAt?.toDate
      ? c.createdAt.toDate().toLocaleDateString("ar-SA-u-ca-gregory")
      : "-";
    const student = studentInfos[i];
    const studentName = student?.fullName || c.studentEmail || "-";
    const studentNum  = student?.studentId || student?.universityId || "-";

    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td>
        <div style="font-weight:600;">${esc(studentName)}</div>
        <div style="font-size:12px;color:#64748b;">${esc(studentNum)}</div>
      </td>
      <td><i class="ti ${icon}" style="font-size:16px;color:var(--primary);"></i> ${esc(c.type || "-")}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.subject || "-")}</td>
      <td><span class="dept-chip">${esc(targetTxt)}</span></td>
      <td><span class="status-badge s-${status}">${COMPLAINT_STATUS_LABEL[status] || status}</span></td>
      <td>${dateStr}</td>
      <td><button class="detail-btn">التفاصيل <i class="ti ti-chevron-left detail-chevron"></i></button></td>
    `;
    tr.addEventListener("click", () => {
      document.querySelectorAll(".admin-table tbody tr.row-active").forEach((r) => r.classList.remove("row-active"));
      tr.classList.add("row-active");
      openComplaintPanel(c, student);
    });
    tbody.appendChild(tr);
  });
}

// ── اللوحة الجانبية ─────────────────────────────────
function openComplaintPanel(c, student) {
  activeComplaint = c;
  const status    = c.status || "new";
  const targetTxt = c.target === "college"
    ? "الكلية"
    : (DEPT_AR[c.departmentKey] || c.targetAr || "-");
  const stu = student || studentsCache[c.studentUid] || null;
  const studentName = stu?.fullName || c.studentEmail || "-";
  const studentNum  = stu?.studentId || stu?.universityId || "-";
  const dateStr   = c.createdAt?.toDate
    ? c.createdAt.toDate().toLocaleDateString("ar-SA-u-ca-gregory")
    : "-";
  const attachHtml = c.attachmentUrl
    ? `<a href="${esc(c.attachmentUrl)}" target="_blank" rel="noopener"
         style="color:var(--primary);text-decoration:underline;">
         <i class="ti ti-paperclip"></i> عرض المرفق
       </a>`
    : "لا يوجد";
  const adminReplyHtml = c.adminReply
    ? `<div style="background:#f0f4ff;border-right:3px solid var(--primary);
                   padding:10px 14px;border-radius:6px;font-size:13px;margin-top:4px;">
         ${esc(c.adminReply)}
       </div>`
    : "";

  document.getElementById("cSpTitle").textContent = c.subject || "تفاصيل الشكوى";
  document.getElementById("cSpSub").textContent   = c.type    || "";

  document.getElementById("cSpBody").innerHTML = `
    <div class="sp-detail-card sp-highlight-border" style="margin-bottom:16px;">
      <table class="sp-detail-table">
        <tr><td class="sp-detail-label">اسم الطالب</td>  <td>${esc(studentName)}</td></tr>
        <tr><td class="sp-detail-label">الرقم الجامعي</td><td>${esc(studentNum)}</td></tr>
        <tr><td class="sp-detail-label">النوع</td>      <td>${esc(c.type || "-")}</td></tr>
        <tr><td class="sp-detail-label">الجهة المعنية</td><td>${esc(targetTxt)}</td></tr>
        <tr><td class="sp-detail-label">الحالة</td>
            <td><span class="status-badge s-${status}">${COMPLAINT_STATUS_LABEL[status] || status}</span></td></tr>
        <tr><td class="sp-detail-label">تاريخ التقديم</td><td>${dateStr}</td></tr>
        <tr><td class="sp-detail-label">المرفق</td>     <td>${attachHtml}</td></tr>
      </table>
    </div>

    <div class="sp-section-title">التفاصيل</div>
    <div class="sp-detail-card" style="font-size:14px;line-height:1.8;margin-bottom:16px;">
      ${esc(c.details || "-")}
    </div>

    <div class="sp-section-title">رد / ملاحظة الأدمن</div>
    ${adminReplyHtml}
    <textarea id="cAdminReplyInput" rows="3"
      style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;
             font-family:inherit;font-size:14px;margin-top:8px;resize:vertical;box-sizing:border-box;"
      placeholder="اكتب ردك أو ملاحظتك هنا...">${esc(c.adminReply || "")}</textarea>
    <button id="cSaveReplyBtn"
      style="margin-top:8px;padding:9px 18px;background:var(--primary);color:#fff;
             border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px;">
      <i class="ti ti-device-floppy"></i> حفظ الرد
    </button>
  `;

  document.getElementById("cSaveReplyBtn").addEventListener("click", saveAdminReply);

  // تفعيل/تعطيل أزرار الحالة
  ["cBtnReview","cBtnResolve","cBtnDismiss"].forEach(id => {
    const btn    = document.getElementById(id);
    const action = btn.dataset.caction;
    btn.disabled = (status === action);
  });

  document.getElementById("cSidePanel").classList.add("open");
  document.getElementById("cSpOverlay").classList.add("show");
  document.querySelector(".admin-main").classList.add("panel-open");
}

function closeComplaintPanel() {
  document.getElementById("cSidePanel").classList.remove("open");
  document.getElementById("cSpOverlay").classList.remove("show");
  document.querySelector(".admin-main").classList.remove("panel-open");
  activeComplaint = null;
}

// ── تحديث الحالة ────────────────────────────────────
async function updateComplaintStatus(complaint, newStatus) {
  try {
    await updateDoc(doc(db, "complaints", complaint.id), {
      status:              newStatus,
      handledBy:           currentAdminUid,
      handledByName:       currentAdminName,
      updatedAt:           serverTimestamp(),
    });
    complaint.status = newStatus;
    openComplaintPanel(complaint);
  } catch (err) {
    console.error("updateComplaintStatus error:", err);
    alert("حدث خطأ: " + err.message);
  }
}

// ── حفظ الرد ────────────────────────────────────────
async function saveAdminReply() {
  if (!activeComplaint) return;
  const reply = document.getElementById("cAdminReplyInput")?.value?.trim() || "";
  const btn   = document.getElementById("cSaveReplyBtn");
  btn.disabled    = true;
  btn.textContent = "جاري الحفظ...";
  try {
    await updateDoc(doc(db, "complaints", activeComplaint.id), {
      adminReply:    reply,
      repliedBy:     currentAdminUid,
      repliedByName: currentAdminName,
      repliedAt:     serverTimestamp(),
      updatedAt:     serverTimestamp(),
    });
    activeComplaint.adminReply = reply;
    btn.textContent = "✓ تم الحفظ";
    setTimeout(() => { btn.disabled = false; btn.innerHTML = '<i class="ti ti-device-floppy"></i> حفظ الرد'; }, 1500);
  } catch (err) {
    console.error("saveAdminReply error:", err);
    alert("خطأ في الحفظ: " + err.message);
    btn.disabled    = false;
    btn.textContent = "حفظ الرد";
  }
}

// ── التبديل لتبويب الشكاوى ──────────────────────────
function switchToComplaints() {
  // ملاحظة: رسالة الترحيب (.emp-welcome) تبقى ظاهرة دائماً، حتى داخل تبويب الشكاوى

  // إخفاء كل تبويب آخر — نعيد استخدام منطق الأدمن الحالي
  document.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
  document.getElementById("navComplaintsAdmin")?.classList.add("active");

  // إعادة تعيين الفلاتر افتراضياً على "الكل" عند فتح التبويب
  cStatusFilter = "all";
  const cStatsGrid = document.getElementById("cStatsGrid");
  if (cStatsGrid) {
    cStatsGrid.querySelectorAll("[data-cfilter]").forEach(c => c.classList.remove("active"));
    cStatsGrid.querySelector('[data-cfilter="all"]')?.classList.add("active");
  }

  // إخفاء قسم visitUploadArea وفلتر الأقسام إن ظهرا
  const visitUpload  = document.getElementById("visitUploadArea");
  const deptFilter   = document.getElementById("deptFilterWrap");
  if (visitUpload) visitUpload.style.display = "none";
  if (deptFilter)  deptFilter.style.display  = "none";

  // إخفاء stats + table الأصلية (كل عنصر خارج #complaintsSection)
  document.querySelectorAll(".admin-stats-grid").forEach(el => {
    if (!el.closest("#complaintsSection")) el.style.display = "none";
  });
  document.querySelectorAll(".admin-table-card").forEach(el => {
    if (!el.closest("#complaintsSection")) el.style.display = "none";
  });

  // إظهار قسم الشكاوى
  const cs = document.getElementById("complaintsSection");
  if (cs) cs.style.display = "";

  // تحديث عنوان التوبار
  const tableTitleEl = document.getElementById("tableTitle");
  if (tableTitleEl) tableTitleEl.textContent = "الشكاوى والاقتراحات";

  renderComplaints();
}

// عند العودة لأي تبويب أصلي — نخفي complaintsSection ونُظهر الأصلية
function hideComplaintsSection() {
  const cs = document.getElementById("complaintsSection");
  if (cs) cs.style.display = "none";

  document.querySelectorAll(".admin-stats-grid").forEach(el => {
    if (!el.closest("#complaintsSection")) el.style.display = "";
  });
  document.querySelectorAll(".admin-table-card").forEach(el => {
    if (!el.closest("#complaintsSection")) el.style.display = "";
  });

  const empWelcome = document.querySelector(".emp-welcome");
  if (empWelcome) empWelcome.style.display = "";
}

// ── دالة مساعدة esc ─────────────────────────────────
function esc(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

// ── إعادة توصيل التابات الأصلية ─────────────────────
function patchOriginalTabs() {
  document.querySelectorAll(".admin-tab[data-tab]").forEach(btn => {
    if (btn.id === "navComplaintsAdmin") return;
    btn.addEventListener("click", () => {
      hideComplaintsSection();
    }, { capture: true });
  });
}

// ── تهيئة ───────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) return;
  if (alreadyInitialized) return;   // يمنع تشغيل التهيئة أكثر من مرة لو تكرر onAuthStateChanged
  alreadyInitialized = true;

  currentAdminUid  = user.uid;
  currentAdminName = document.getElementById("adminName")?.textContent || "الأدمن";

  // انتظر حتى يُعرض DOM بالكامل
  if (document.readyState === "loading") {
    await new Promise(r => document.addEventListener("DOMContentLoaded", r));
  }

  injectSidebarTab();
  injectComplaintsSection();
  patchOriginalTabs();
  subscribeComplaints();
});
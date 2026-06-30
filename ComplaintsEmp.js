// =====================================================
//  complaints-emp.js
//  أضف هذا الملف في Employeedashboard.html بعد emp-dashboard.js:
//
//  <script type="module" src="complaints-emp.js"></script>
//
//  يضيف تبويب "الشكاوى والاقتراحات" لموظف القسم:
//  • يرى شكاوى قسمه فقط (target=="department" && departmentKey==قسمه)
//  • يقدر يغير الحالة ويضيف رد
//  • لا يرى شكاوى الكلية (تلك للأدمن فقط)
// =====================================================

import { auth, db } from "./firebase.js";
import {
  collection, query, where, onSnapshot,
  doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── خريطة اسم القسم العربي ← departmentKey ──────────
const DEPT_KEY_MAP = {
  "فيزياء":    "physics",
  "إحصاء":     "statistics",
  "رياضيات":   "math",
  "أحياء":     "biology",
  "كيمياء":    "chemistry",
  // الاحتياط لو القسم مسجل بالاسم الكامل
  "قسم الفيزياء":   "physics",
  "قسم الإحصاء":    "statistics",
  "قسم الرياضيات":  "math",
  "قسم الأحياء":    "biology",
  "قسم الكيمياء":   "chemistry",
};

const COMPLAINT_STATUS_LABEL = {
  new:          "جديد",
  under_review: "قيد المراجعة",
  resolved:     "تمت المعالجة",
  dismissed:    "مرفوض",
};

const TYPE_ICON = {
  "شكوى":    "ti-alert-circle",
  "اقتراح":  "ti-bulb",
  "استفسار": "ti-help-circle",
};

// ── state ───────────────────────────────────────────
let complaintsData        = [];
let cStatusFilter         = "all";
let cSearchQuery          = "";
let activeComplaint       = null;
let currentEmpUid         = null;
let currentEmpName        = "-";
let currentDeptKey        = null;   // مثال: "physics"
let unsubscribeComplaints = null;

// ── حقن التبويب في السايدبار ────────────────────────
function injectSidebarTab() {
  const nav = document.querySelector(".sb-nav");
  if (!nav || document.getElementById("navComplaintsEmp")) return;

  const item = document.createElement("div");
  item.className   = "sb-nav-item emp-tab-btn";
  item.dataset.tab = "complaints";
  item.id          = "navComplaintsEmp";
  item.innerHTML   = `
    <i class="ti ti-message-report"></i>
    <span>الشكاوى والاقتراحات</span>
    <span class="sb-badge emp-tab-badge" id="badge-complaints-emp">0</span>
  `;
  nav.appendChild(item);

  item.addEventListener("click", () => switchToComplaints());
}

// ── حقن قسم HTML ────────────────────────────────────
function injectComplaintsSection() {
  if (document.getElementById("empComplaintsSection")) return;
  const main = document.querySelector(".admin-main");
  if (!main) return;

  const section = document.createElement("div");
  section.id            = "empComplaintsSection";
  section.style.display = "none";
  section.innerHTML     = `

    <div class="admin-stats-grid" id="ecStatsGrid">
      <div class="admin-stat-card emp-stat-card stat-total active" data-ecfilter="all">
        <div class="stat-icon"><i class="ti ti-copy"></i></div>
        <div class="stat-num" id="ec-cnt-all">0</div>
        <div class="stat-label">الكل</div>
      </div>
      <div class="admin-stat-card emp-stat-card stat-new" data-ecfilter="new">
        <div class="stat-icon"><i class="ti ti-sparkles"></i></div>
        <div class="stat-num" id="ec-cnt-new">0</div>
        <div class="stat-label">جديد</div>
      </div>
      <div class="admin-stat-card emp-stat-card stat-review" data-ecfilter="under_review">
        <div class="stat-icon"><i class="ti ti-loader-2"></i></div>
        <div class="stat-num" id="ec-cnt-under_review">0</div>
        <div class="stat-label">قيد المراجعة</div>
      </div>
      <div class="admin-stat-card emp-stat-card stat-approved" data-ecfilter="resolved">
        <div class="stat-icon"><i class="ti ti-circle-check"></i></div>
        <div class="stat-num" id="ec-cnt-resolved">0</div>
        <div class="stat-label">تمت المعالجة</div>
      </div>
      <div class="admin-stat-card emp-stat-card stat-rejected" data-ecfilter="dismissed">
        <div class="stat-icon"><i class="ti ti-circle-x"></i></div>
        <div class="stat-num" id="ec-cnt-dismissed">0</div>
        <div class="stat-label">مرفوض</div>
      </div>
    </div>

    <div class="admin-table-card">
      <div class="admin-search-row">
        <div class="admin-search-bar">
          <i class="ti ti-search admin-search-icon"></i>
          <input type="text" id="ecSearchInput" placeholder="ابحث بالعنوان..." autocomplete="off" />
        </div>
      </div>

      <div class="admin-loading" id="ecLoading" style="display:none">
        <i class="ti ti-loader-2 spin"></i> جاري التحميل...
      </div>

      <div class="admin-table-wrap" id="ecTableWrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>النوع</th>
              <th>العنوان</th>
              <th>الحالة</th>
              <th>التاريخ</th>
              <th>التفاصيل</th>
            </tr>
          </thead>
          <tbody id="ecTbody"></tbody>
        </table>
        <div class="admin-empty" id="ecEmpty" style="display:none">
          <i class="ti ti-inbox-off"></i>
          <p>لا توجد شكاوى لقسمك حالياً</p>
        </div>
      </div>
    </div>

    <!-- اللوحة الجانبية -->
    <div class="admin-side-panel" id="ecSidePanel">
      <div class="sp-header">
        <div>
          <div class="sp-title" id="ecSpTitle">تفاصيل الشكوى</div>
          <div class="sp-sub"  id="ecSpSub"></div>
        </div>
        <button class="sp-close-btn" id="ecSpClose"><i class="ti ti-x"></i></button>
      </div>
      <div class="sp-body" id="ecSpBody"></div>
      <div class="sp-footer" style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="sp-action-btn sp-review"  data-ecaction="under_review" id="ecBtnReview">
          <i class="ti ti-loader-2"></i> قيد المراجعة
        </button>
        <button class="sp-action-btn sp-approve" data-ecaction="resolved"     id="ecBtnResolve">
          <i class="ti ti-circle-check"></i> تمت المعالجة
        </button>
        <button class="sp-action-btn sp-reject"  data-ecaction="dismissed"    id="ecBtnDismiss">
          <i class="ti ti-circle-x"></i> رفض
        </button>
      </div>
    </div>
    <div class="sp-overlay" id="ecSpOverlay"></div>
  `;

  main.appendChild(section);

  // البطاقات
  section.querySelectorAll("[data-ecfilter]").forEach(card => {
    card.addEventListener("click", () => {
      cStatusFilter = card.dataset.ecfilter;
      section.querySelectorAll("[data-ecfilter]").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      renderComplaints();
    });
  });

  // البحث
  let debounce = null;
  section.querySelector("#ecSearchInput").addEventListener("input", e => {
    cSearchQuery = e.target.value;
    clearTimeout(debounce);
    debounce = setTimeout(renderComplaints, 200);
  });

  // إغلاق اللوحة
  section.querySelector("#ecSpClose").addEventListener("click",   closePanel);
  section.querySelector("#ecSpOverlay").addEventListener("click", closePanel);

  // أزرار الحالة
  ["ecBtnReview","ecBtnResolve","ecBtnDismiss"].forEach(id => {
    section.querySelector(`#${id}`).addEventListener("click", () => {
      if (!activeComplaint) return;
      const action = section.querySelector(`#${id}`).dataset.ecaction;
      updateComplaintStatus(activeComplaint, action);
    });
  });
}

// ── الاشتراك في Firestore ────────────────────────────
function subscribeComplaints() {
  if (!currentDeptKey) return;
  if (unsubscribeComplaints) unsubscribeComplaints();

  // موظف القسم يرى شكاوى قسمه فقط
  const q = query(
    collection(db, "complaints"),
    where("target",        "==", "department"),
    where("departmentKey", "==", currentDeptKey)
  );

  unsubscribeComplaints = onSnapshot(q, snap => {
    complaintsData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateBadge();
    if (document.getElementById("empComplaintsSection")?.style.display !== "none") {
      renderComplaints();
    }
  }, err => console.error("emp complaints snapshot:", err));
}

function updateBadge() {
  const el = document.getElementById("badge-complaints-emp");
  if (el) el.textContent = complaintsData.filter(c => !c.status || c.status === "new").length;
}

// ── عرض الجدول ─────────────────────────────────────
function renderComplaints() {
  let filtered = [...complaintsData];

  if (cStatusFilter !== "all") {
    filtered = filtered.filter(c => (c.status || "new") === cStatusFilter);
  }
  const q = cSearchQuery.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(c =>
      (c.subject || "").toLowerCase().includes(q) ||
      (c.details || "").toLowerCase().includes(q)
    );
  }

  filtered.sort((a, b) => {
    const order = { new: 0, under_review: 1, resolved: 2, dismissed: 2 };
    const oa = order[a.status || "new"] ?? 3;
    const ob = order[b.status || "new"] ?? 3;
    if (oa !== ob) return oa - ob;
    return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
  });

  // إحصاء
  const counts = { all: complaintsData.length, new: 0, under_review: 0, resolved: 0, dismissed: 0 };
  complaintsData.forEach(c => { const s = c.status || "new"; if (counts[s] !== undefined) counts[s]++; });
  Object.entries(counts).forEach(([k, v]) => {
    const el = document.getElementById(`ec-cnt-${k}`);
    if (el) el.textContent = v;
  });

  const tbody = document.getElementById("ecTbody");
  const empty = document.getElementById("ecEmpty");
  tbody.innerHTML = "";

  if (!filtered.length) { empty.style.display = ""; return; }
  empty.style.display = "none";

  filtered.forEach(c => {
    const status  = c.status || "new";
    const icon    = TYPE_ICON[c.type] || "ti-message";
    const dateStr = c.createdAt?.toDate
      ? c.createdAt.toDate().toLocaleDateString("ar-SA-u-ca-gregory")
      : "-";

    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td><i class="ti ${icon}" style="font-size:16px;color:var(--primary);"></i> ${esc(c.type || "-")}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.subject || "-")}</td>
      <td><span class="status-badge s-${status}">${COMPLAINT_STATUS_LABEL[status] || status}</span></td>
      <td>${dateStr}</td>
      <td><button class="detail-btn">عرض <i class="ti ti-chevron-left detail-chevron"></i></button></td>
    `;
    tr.addEventListener("click", () => openPanel(c));
    tbody.appendChild(tr);
  });
}

// ── اللوحة الجانبية ─────────────────────────────────
function openPanel(c) {
  activeComplaint = c;
  const status  = c.status || "new";
  const dateStr = c.createdAt?.toDate
    ? c.createdAt.toDate().toLocaleDateString("ar-SA-u-ca-gregory")
    : "-";
  const attachHtml = c.attachmentUrl
    ? `<a href="${esc(c.attachmentUrl)}" target="_blank" rel="noopener"
         style="color:var(--primary);text-decoration:underline;">
         <i class="ti ti-paperclip"></i> عرض المرفق
       </a>`
    : "لا يوجد";
  const replyHtml = c.adminReply
    ? `<div style="background:#f0f4ff;border-right:3px solid var(--primary);
                   padding:10px 14px;border-radius:6px;font-size:13px;margin-top:4px;">
         ${esc(c.adminReply)}
       </div>`
    : "";

  document.getElementById("ecSpTitle").textContent = c.subject || "تفاصيل الشكوى";
  document.getElementById("ecSpSub").textContent   = c.type    || "";

  document.getElementById("ecSpBody").innerHTML = `
    <div class="sp-detail-card" style="margin-bottom:16px;">
      <table class="sp-detail-table">
        <tr><td class="sp-detail-label">النوع</td>
            <td>${esc(c.type || "-")}</td></tr>
        <tr><td class="sp-detail-label">الحالة</td>
            <td><span class="status-badge s-${status}">${COMPLAINT_STATUS_LABEL[status] || status}</span></td></tr>
        <tr><td class="sp-detail-label">تاريخ التقديم</td>
            <td>${dateStr}</td></tr>
        <tr><td class="sp-detail-label">المرفق</td>
            <td>${attachHtml}</td></tr>
      </table>
    </div>

    <div class="sp-section-title">التفاصيل</div>
    <div class="sp-detail-card" style="font-size:14px;line-height:1.8;margin-bottom:16px;">
      ${esc(c.details || "-")}
    </div>

    <div class="sp-section-title">ردك / ملاحظتك</div>
    ${replyHtml}
    <textarea id="ecReplyInput" rows="3"
      style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;
             font-family:inherit;font-size:14px;margin-top:8px;resize:vertical;box-sizing:border-box;"
      placeholder="اكتب ردك أو ملاحظتك هنا...">${esc(c.adminReply || "")}</textarea>
    <button id="ecSaveReplyBtn"
      style="margin-top:8px;padding:9px 18px;background:var(--primary);color:#fff;
             border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px;">
      <i class="ti ti-device-floppy"></i> حفظ الرد
    </button>
  `;

  document.getElementById("ecSaveReplyBtn").addEventListener("click", saveReply);

  ["ecBtnReview","ecBtnResolve","ecBtnDismiss"].forEach(id => {
    const btn    = document.getElementById(id);
    btn.disabled = (status === btn.dataset.ecaction);
  });

  document.getElementById("ecSidePanel").classList.add("open");
  document.getElementById("ecSpOverlay").classList.add("show");
  document.querySelector(".admin-main").classList.add("panel-open");
}

function closePanel() {
  document.getElementById("ecSidePanel").classList.remove("open");
  document.getElementById("ecSpOverlay").classList.remove("show");
  document.querySelector(".admin-main").classList.remove("panel-open");
  activeComplaint = null;
}

async function updateComplaintStatus(complaint, newStatus) {
  try {
    await updateDoc(doc(db, "complaints", complaint.id), {
      status:        newStatus,
      handledBy:     currentEmpUid,
      handledByName: currentEmpName,
      updatedAt:     serverTimestamp(),
    });
    complaint.status = newStatus;
    openPanel(complaint);
  } catch (err) {
    console.error("updateComplaintStatus error:", err);
    alert("حدث خطأ: " + err.message);
  }
}

async function saveReply() {
  if (!activeComplaint) return;
  const reply = document.getElementById("ecReplyInput")?.value?.trim() || "";
  const btn   = document.getElementById("ecSaveReplyBtn");
  btn.disabled    = true;
  btn.textContent = "جاري الحفظ...";
  try {
    await updateDoc(doc(db, "complaints", activeComplaint.id), {
      adminReply:    reply,
      repliedBy:     currentEmpUid,
      repliedByName: currentEmpName,
      repliedAt:     serverTimestamp(),
      updatedAt:     serverTimestamp(),
    });
    activeComplaint.adminReply = reply;
    btn.textContent = "✓ تم الحفظ";
    setTimeout(() => { btn.disabled = false; btn.innerHTML = '<i class="ti ti-device-floppy"></i> حفظ الرد'; }, 1500);
  } catch (err) {
    console.error("saveReply error:", err);
    alert("خطأ في الحفظ: " + err.message);
    btn.disabled    = false;
    btn.textContent = "حفظ الرد";
  }
}

// ── التبديل لتبويب الشكاوى ──────────────────────────
function switchToComplaints() {
  document.querySelectorAll(".emp-tab-btn").forEach(t => t.classList.remove("active"));
  document.getElementById("navComplaintsEmp")?.classList.add("active");

  // ملاحظة: رسالة الترحيب (.emp-welcome) تبقى ظاهرة دائماً، حتى داخل تبويب الشكاوى

  document.querySelectorAll(".admin-stats-grid").forEach(el => {
    if (!el.closest("#empComplaintsSection")) el.style.display = "none";
  });
  document.querySelectorAll(".admin-table-card").forEach(el => {
    if (!el.closest("#empComplaintsSection")) el.style.display = "none";
  });

  const cs = document.getElementById("empComplaintsSection");
  if (cs) cs.style.display = "";

  const pageTitleEl = document.getElementById("pageTitle");
  if (pageTitleEl) pageTitleEl.textContent = "الشكاوى والاقتراحات";

  renderComplaints();
}

function hideComplaintsSection() {
  const cs = document.getElementById("empComplaintsSection");
  if (cs) cs.style.display = "none";

  document.querySelectorAll(".admin-stats-grid").forEach(el => {
    if (!el.closest("#empComplaintsSection")) el.style.display = "";
  });
  document.querySelectorAll(".admin-table-card").forEach(el => {
    if (!el.closest("#empComplaintsSection")) el.style.display = "";
  });

  const empWelcome = document.querySelector(".emp-welcome");
  if (empWelcome) empWelcome.style.display = "";
}

function patchOriginalTabs() {
  document.querySelectorAll(".emp-tab-btn[data-tab]").forEach(btn => {
    if (btn.id === "navComplaintsEmp") return;
    btn.addEventListener("click", () => hideComplaintsSection(), { capture: true });
  });
}

function esc(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

// ── تهيئة ───────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) return;

  try {
    const snap = await getDoc(doc(db, "employees", user.uid));
    if (!snap.exists()) return;

    const data       = snap.data();
    currentEmpUid    = user.uid;
    currentEmpName   = data.fullName   || "-";
    const deptAr     = data.department || "";

    // استخرج departmentKey — يتجاهل الهمزات عشان يتطابق مع Firebase
    const normalizeAr = s => s.trim().replace(/[أإآا]/g, "ا").replace(/[ىي]/g, "ي").replace(/ة/g, "ه");
    const normalizedMap = Object.fromEntries(
      Object.entries(DEPT_KEY_MAP).map(([k, v]) => [normalizeAr(k), v])
    );
    currentDeptKey = data.departmentKey || normalizedMap[normalizeAr(deptAr)] || null;

    if (!currentDeptKey) {
      console.warn("complaints-emp: لم يتم العثور على departmentKey للموظف");
      return;
    }

    if (document.readyState === "loading") {
      await new Promise(r => document.addEventListener("DOMContentLoaded", r));
    }

    injectSidebarTab();
    injectComplaintsSection();
    patchOriginalTabs();
    subscribeComplaints();

  } catch (err) {
    console.error("complaints-emp init error:", err);
  }
});
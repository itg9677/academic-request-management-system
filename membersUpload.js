import { auth, db, storage } from "./firebase.js";
import {
  doc, setDoc, getDoc, getDocs, collection, query, where,
  serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

/* ============================================================
   membersUpload.js — رفع/تحديث بيانات أعضاء هيئة التدريس (Excel)
   ============================================================
   • يُستخدم داخل تبويب "متابعة الحضور" بلوحة الأدمن
   • كل ملف = عدة شيتات (شيت لكل قسم) — نفس فكرة ملف الكلية الكامل
   • يكتب كل عضو في مجموعة "departmentMembers"، بمعرّف ثابت
     (الرقم الوظيفي + القسم) حتى تتحدّث بيانات نفس العضو بدل التكرار
   • عمود "المقر": المقر الرئيسي => active=true، أي قيمة غير ذلك => active=false
     (شاشة تسجيل الحضور تعرض فقط الأعضاء active=true)
   • "قسم بحوث العمليات" يُعتبر جزءًا من قسم "إحصاء" (نفس اسم القسم
     المستخدم في باقي النظام)، فأي شيت اسمه يحتوي "إحصاء" يُصنَّف كذلك
============================================================ */

let currentAdminName = "الأدمن";

// ==================== أدوات نصية مشتركة ====================
function normalizeText(val) {
  return String(val ?? "")
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedIdPart(val) {
  return normalizeText(val).toUpperCase().replace(/[\/.#$[\]]/g, "-");
}

function memberDocId(employeeNumber, department) {
  return `${normalizedIdPart(employeeNumber)}_${normalizedIdPart(department)}`;
}

function esc(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// أسماء الأقسام المعتمدة في النظام (نفس القيم المستخدمة في attendancePermissions)
const KNOWN_DEPARTMENTS = ["كيمياء", "فيزياء", "أحياء", "رياضيات", "إحصاء"];

// تحويل اسم الشيت إلى اسم القسم المعتمد في النظام
// "قسم الاحصاء وبحوث العمليات" وأي شيت يحتوي على "احصاء/إحصاء" => "إحصاء"
// (بحوث العمليات قسم فرعي تابع للإحصاء، وليس قسمًا مستقلًا)
function mapSheetNameToDept(sheetName) {
  const s = normalizeText(sheetName);
  if (s.includes("احصاء") || s.includes("إحصاء")) return "إحصاء";
  if (s.includes("فيزياء")) return "فيزياء";
  if (s.includes("كيمياء")) return "كيمياء";
  if (s.includes("احياء") || s.includes("أحياء")) return "أحياء";
  if (s.includes("رياضيات")) return "رياضيات";
  return null; // شيت غير معروف — يُتجاهل
}

// قراءة قيمة عمود بعدة أسماء محتملة (تتغاضى عن المسافات الزائدة برأس العمود)
function getRowValue(row, candidates) {
  for (const key of Object.keys(row)) {
    if (candidates.includes(normalizeText(key))) return row[key];
  }
  return "";
}

// ==================== تحميل مكتبة SheetJS عند الحاجة ====================
let _xlsxLoadPromise = null;
function ensureXLSXLoaded() {
  if (window.XLSX) return Promise.resolve();
  if (_xlsxLoadPromise) return _xlsxLoadPromise;
  _xlsxLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload  = resolve;
    s.onerror = () => { _xlsxLoadPromise = null; reject(new Error("تعذّر تحميل مكتبة Excel")); };
    document.head.appendChild(s);
  });
  return _xlsxLoadPromise;
}

// ==================== حالة الرفع ====================
let muParsedRows = [];        // الصفوف الصالحة الجاهزة للرفع {employeeNumber, name, department, location, active}
let muSkippedCount = 0;       // صفوف تم تجاهلها (اسم/رقم وظيفي ناقص)
let muUnknownSheetsCount = 0; // شيتات لم تُعرف كقسم معتمد
let muDuplicateInFileCount = 0;
let muCurrentFile = null;
let muDeptsInFile = new Set();
let muUploadDone = false; // تصير true بعد نجاح الرفع؛ عندها ضغط الزر يقفل النافذة بدل إعادة الرفع

// ==================== عناصر DOM ====================
let el = {};

function cacheEls() {
  el = {
    modal:        document.getElementById("membersUploadModal"),
    overlay:      document.getElementById("membersUploadOverlay"),
    openBtn:      document.getElementById("openMembersUploadBtn"),
    closeBtn:     document.getElementById("muCloseBtn"),
    cancelBtn:    document.getElementById("muCancelBtn"),
    dropZone:     document.getElementById("muDropZone"),
    fileInput:    document.getElementById("muFileInput"),
    fileNameEl:   document.getElementById("muFileName"),
    currentFileWrap: document.getElementById("muCurrentFileWrap"),
    previewWrap:  document.getElementById("muPreviewWrap"),
    previewSummary: document.getElementById("muPreviewSummary"),
    previewTable: document.getElementById("muPreviewTable"),
    skippedNote:  document.getElementById("muSkippedNote"),
    progressWrap: document.getElementById("muProgressWrap"),
    progressText: document.getElementById("muProgressText"),
    resultNote:   document.getElementById("muResultNote"),
    confirmBtn:   document.getElementById("muConfirmBtn"),
  };
}

function resetModal() {
  muParsedRows = [];
  muSkippedCount = 0;
  muUnknownSheetsCount = 0;
  muDuplicateInFileCount = 0;
  muCurrentFile = null;
  muDeptsInFile = new Set();
  muUploadDone = false;
  if (el.fileInput) el.fileInput.value = "";
  if (el.fileNameEl) { el.fileNameEl.style.display = "none"; el.fileNameEl.textContent = ""; }
  if (el.previewWrap) el.previewWrap.style.display = "none";
  if (el.previewTable) el.previewTable.innerHTML = "";
  if (el.skippedNote) el.skippedNote.style.display = "none";
  if (el.progressWrap) el.progressWrap.style.display = "none";
  if (el.resultNote) { el.resultNote.style.display = "none"; el.resultNote.textContent = ""; }
  if (el.confirmBtn) { el.confirmBtn.disabled = true; el.confirmBtn.innerHTML = '<i class="ti ti-check"></i> تأكيد الرفع'; }
}

function openModal() {
  if (!el.modal) return;
  resetModal();
  el.modal.style.display = "";
  if (el.overlay) el.overlay.style.display = "";
  loadCurrentFileInfo();
}

function closeModal() {
  if (!el.modal) return;
  el.modal.style.display = "none";
  if (el.overlay) el.overlay.style.display = "none";
}

// ==================== قراءة الملف ====================
async function handleFile(file) {
  muCurrentFile = file;
  if (el.resultNote) el.resultNote.style.display = "none";
  if (el.fileNameEl) {
    el.fileNameEl.style.display = "";
    el.fileNameEl.innerHTML = `<i class="ti ti-file-spreadsheet"></i> ${esc(file.name)}`;
  }

  try {
    await ensureXLSXLoaded();
  } catch (err) {
    alert("تعذّر تحميل مكتبة قراءة Excel. تأكد من اتصال الإنترنت وحاول مرة أخرى.");
    console.error(err);
    return;
  }

  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer, { type: "array" });

  const rawRows = [];
  muSkippedCount = 0;
  muUnknownSheetsCount = 0;

  for (const sheetName of workbook.SheetNames) {
    const department = mapSheetNameToDept(sheetName);
    if (!department) { muUnknownSheetsCount++; continue; }

    const sheet = workbook.Sheets[sheetName];
    const json = window.XLSX.utils.sheet_to_json(sheet, { defval: "" });

    for (const row of json) {
      const name = normalizeText(getRowValue(row, ["الاسم"]));
      const employeeNumber = normalizeText(getRowValue(row, ["الرقم الوظيفي"]));
      const location = normalizeText(getRowValue(row, ["المقر"]));

      if (!name || !employeeNumber) { muSkippedCount++; continue; }

      const active = location.includes("الرئيسي");

      rawRows.push({ employeeNumber, name, department, location, active });
    }
  }

  // إزالة التكرار داخل نفس الملف (نفس الرقم الوظيفي + القسم) — نُبقي آخر نسخة فقط
  const dedupMap = new Map();
  muDuplicateInFileCount = 0;
  for (const row of rawRows) {
    const key = memberDocId(row.employeeNumber, row.department);
    if (dedupMap.has(key)) muDuplicateInFileCount++;
    dedupMap.set(key, row);
  }
  muParsedRows = Array.from(dedupMap.values());
  muDeptsInFile = new Set(muParsedRows.map(r => r.department));

  renderPreview();
}

function renderPreview() {
  if (!el.previewWrap) return;

  if (!muParsedRows.length) {
    el.previewWrap.style.display = "";
    el.previewSummary.textContent = "لم يتم العثور على صفوف صالحة في الملف.";
    el.previewTable.innerHTML = "";
    if (el.confirmBtn) el.confirmBtn.disabled = true;
    return;
  }

  el.previewWrap.style.display = "";
  const activeCount = muParsedRows.filter(r => r.active).length;
  el.previewSummary.textContent =
    `تم العثور على ${muParsedRows.length} عضو (${activeCount} بالمقر الرئيسي — يحضّرون) ` +
    `ضمن ${muDeptsInFile.size} قسم: ${[...muDeptsInFile].join("، ")}.`;

  let html = "<thead><tr><th>القسم</th><th>الاسم</th><th>الرقم الوظيفي</th><th>المقر</th><th>يحضّر؟</th></tr></thead><tbody>";
  muParsedRows.slice(0, 60).forEach(r => {
    html += `<tr>
      <td>${esc(r.department)}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(r.employeeNumber)}</td>
      <td>${esc(r.location || "-")}</td>
      <td>${r.active ? "✓ نعم" : "—"}</td>
    </tr>`;
  });
  html += "</tbody>";
  if (muParsedRows.length > 60) {
    html += `<tfoot><tr><td colspan="5" style="text-align:center;color:#888;">... و ${muParsedRows.length - 60} عضو إضافي</td></tr></tfoot>`;
  }
  el.previewTable.innerHTML = html;

  if (el.skippedNote) {
    const notes = [];
    if (muSkippedCount > 0) notes.push(`تم تجاهل ${muSkippedCount} صف بسبب نقص الاسم أو الرقم الوظيفي.`);
    if (muDuplicateInFileCount > 0) notes.push(`تم دمج ${muDuplicateInFileCount} صف مكرر لنفس العضو داخل الملف.`);
    if (muUnknownSheetsCount > 0) notes.push(`تم تجاهل ${muUnknownSheetsCount} شيت لم يُتعرّف عليه كقسم معتمد.`);
    if (notes.length) { el.skippedNote.style.display = ""; el.skippedNote.textContent = "تنبيه: " + notes.join(" "); }
    else el.skippedNote.style.display = "none";
  }

  if (el.confirmBtn) el.confirmBtn.disabled = false;
}

// ==================== حذف الأعضاء القدامى لنفس الأقسام غير الموجودين بالملف الجديد ====================
async function removeStaleMembersForDepartments(uploadedRows) {
  if (!uploadedRows.length) return;

  const departmentsInFile = new Set(uploadedRows.map(r => r.department));
  const keepIds = new Set(uploadedRows.map(r => memberDocId(r.employeeNumber, r.department)));

  for (const dept of departmentsInFile) {
    try {
      const snap = await getDocs(query(collection(db, "departmentMembers"), where("department", "==", dept)));
      const toDelete = snap.docs.filter(d => !keepIds.has(d.id));
      if (!toDelete.length) continue;

      const BATCH_SIZE = 450;
      for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
        const chunk = toDelete.slice(i, i + BATCH_SIZE);
        const batch = writeBatch(db);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (err) {
      console.error(`تعذر تنظيف الأعضاء القدامى لقسم ${dept}:`, err);
    }
  }
}

// ==================== حفظ نسخة الملف للتنزيل لاحقًا ====================
async function uploadFileToStorage(file) {
  try {
    const storageRef = ref(storage, "membersFiles/current.xlsx");
    await uploadBytes(storageRef, file);
    const fileUrl = await getDownloadURL(storageRef);
    await setDoc(doc(db, "settings", "membersFile"), {
      fileName: file.name,
      fileUrl,
      uploadedAt: serverTimestamp(),
      uploadedBy: currentAdminName,
    });
  } catch (err) {
    console.error("تعذر حفظ نسخة ملف الأعضاء للتنزيل لاحقًا:", err);
  }
}

async function loadCurrentFileInfo() {
  const wrap = el.currentFileWrap;
  if (!wrap) return;
  try {
    const snap = await getDoc(doc(db, "settings", "membersFile"));
    if (snap.exists()) {
      const data = snap.data();
      wrap.style.display = "";
      wrap.innerHTML = `
        <span style="display:inline-flex;align-items:center;gap:8px;background:#eef3ff;border-radius:8px;padding:8px 12px;font-size:13px;flex-wrap:wrap;">
          <i class="ti ti-file-spreadsheet"></i>
          آخر ملف مرفوع: <strong>${esc(data.fileName || "—")}</strong>
          <a href="${data.fileUrl}" target="_blank" rel="noopener" download="${esc(data.fileName || "")}"
             style="color:#1a3a6b;font-weight:600;text-decoration:underline;display:inline-flex;align-items:center;gap:4px;">
            <i class="ti ti-download"></i> تنزيل للتعديل
          </a>
        </span>`;
    } else {
      wrap.style.display = "none";
      wrap.innerHTML = "";
    }
  } catch (err) {
    console.error("تعذر تحميل معلومات آخر ملف أعضاء مرفوع:", err);
    wrap.style.display = "none";
    wrap.innerHTML = "";
  }
}

// ==================== تأكيد الرفع ====================
// إذا كان الرفع انتهى بنجاح، الضغط على الزر (تم الرفع) يغلق النافذة فقط
// بدل ما يحاول يرفع الملف من جديد
function handleConfirmBtnClick() {
  if (muUploadDone) {
    closeModal();
    return;
  }
  confirmUpload();
}

async function confirmUpload() {
  if (!muParsedRows.length) return;

  el.confirmBtn.disabled = true;
  if (el.progressWrap) el.progressWrap.style.display = "";
  if (el.resultNote) el.resultNote.style.display = "none";

  const total = muParsedRows.length;
  const BATCH_SIZE = 450;
  let written = 0;

  try {
    for (let i = 0; i < total; i += BATCH_SIZE) {
      const chunk = muParsedRows.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach(row => {
        const docId = memberDocId(row.employeeNumber, row.department);
        batch.set(doc(db, "departmentMembers", docId), { ...row, updatedAt: serverTimestamp() }, { merge: true });
      });
      await batch.commit();
      written += chunk.length;
      if (el.progressText) el.progressText.textContent = `جاري الرفع... (${written} / ${total})`;
    }

    if (el.progressText) el.progressText.textContent = "جاري تحديث بيانات الأعضاء القدامى لنفس الأقسام...";
    await removeStaleMembersForDepartments(muParsedRows);

    let localDownloadUrl = null;
    if (muCurrentFile) {
      try { localDownloadUrl = URL.createObjectURL(muCurrentFile); } catch (e) { console.error(e); }
    }
    if (muCurrentFile) await uploadFileToStorage(muCurrentFile);

    if (el.progressWrap) el.progressWrap.style.display = "none";
    if (el.resultNote) {
      el.resultNote.style.display = "";
      el.resultNote.style.color = "#1a7a3c";
      el.resultNote.innerHTML =
        `<i class="ti ti-circle-check"></i> تم رفع/تحديث ${written} عضو بنجاح. ستظهر التحديثات مباشرة في شاشة تسجيل الحضور.` +
        (localDownloadUrl
          ? `<br><a href="${localDownloadUrl}" download="${esc(muCurrentFile.name)}" style="color:#1a3a6b;font-weight:600;text-decoration:underline;display:inline-flex;align-items:center;gap:4px;margin-top:8px;"><i class="ti ti-download"></i> تنزيل نفس الملف الذي رفعته (للتعديل)</a>`
          : "");
    }
    muUploadDone = true;
    el.confirmBtn.disabled = false;
    el.confirmBtn.innerHTML = '<i class="ti ti-check"></i> تم الرفع';
    loadCurrentFileInfo();
  } catch (err) {
    console.error("خطأ في رفع بيانات الأعضاء:", err);
    if (el.progressWrap) el.progressWrap.style.display = "none";
    if (el.resultNote) {
      el.resultNote.style.display = "";
      el.resultNote.style.color = "#b00020";
      el.resultNote.textContent = "حدث خطأ أثناء الرفع. حاول مرة أخرى.";
    }
    el.confirmBtn.disabled = false;
  }
}

// ==================== التهيئة العامة ====================
export function initMembersUpload(adminName) {
  currentAdminName = adminName || "الأدمن";
  cacheEls();
  if (!el.modal) return; // العناصر غير موجودة بهذه الصفحة

  if (el.openBtn) el.openBtn.addEventListener("click", openModal);
  if (el.closeBtn) el.closeBtn.addEventListener("click", closeModal);
  if (el.cancelBtn) el.cancelBtn.addEventListener("click", closeModal);
  if (el.overlay) el.overlay.addEventListener("click", closeModal);
  if (el.dropZone) el.dropZone.addEventListener("click", () => el.fileInput && el.fileInput.click());

  if (el.dropZone) {
    ["dragenter", "dragover"].forEach(evt => {
      el.dropZone.addEventListener(evt, e => { e.preventDefault(); el.dropZone.classList.add("cu-dragover"); });
    });
    ["dragleave", "drop"].forEach(evt => {
      el.dropZone.addEventListener(evt, e => { e.preventDefault(); el.dropZone.classList.remove("cu-dragover"); });
    });
    el.dropZone.addEventListener("drop", e => {
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    });
  }

  if (el.fileInput) {
    el.fileInput.addEventListener("change", () => {
      const file = el.fileInput.files?.[0];
      if (file) handleFile(file);
    });
  }

  if (el.confirmBtn) el.confirmBtn.addEventListener("click", handleConfirmBtnClick);
}
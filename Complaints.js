import { auth, db, storage } from "./firebase.js";
import {
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


const DEPT_KEY_MAP = {
  "قسم الفيزياء":   "physics",
  "قسم الإحصاء":    "statistics",
  "قسم الرياضيات":  "math",
  "قسم الأحياء":    "biology",
  "قسم الكيمياء":   "chemistry",
};


let currentUser = null;

onAuthStateChanged(auth, (user) => {
  currentUser = user || null;
});

// =====================================================
//  مساعد: رفع مرفق إلى Storage
// =====================================================
async function uploadAttachment(file, complaintId) {
  const ext      = file.name.split(".").pop();
  const filePath = `complaints/${complaintId}/${Date.now()}.${ext}`;
  const fileRef  = ref(storage, filePath);
  await uploadBytes(fileRef, file);
  return await getDownloadURL(fileRef);
}

// =====================================================
//  الدالة الرئيسية: إرسال الشكوى
// =====================================================
async function submitComplaint() {
  // ── جمع القيم ──────────────────────────────────────
  const targetEl  = document.getElementById("target");
  const subjectEl = document.getElementById("subject");
  const detailsEl = document.getElementById("details");
  const fileInput = document.getElementById("file-input");

  const targetAr = targetEl?.value?.trim()   || "";
  const subject  = subjectEl?.value?.trim()  || "";
  const details  = detailsEl?.value?.trim()  || "";
  const typeEl   = document.querySelector('input[name="type"]:checked');
  const type     = typeEl ? typeEl.value : "شكوى";

  // ── التحقق ─────────────────────────────────────────
  const missing = [];
  if (!targetAr) missing.push("الجهة المعنية");
  if (!subject)  missing.push("العنوان");
  if (!details)  missing.push("التفاصيل");
  if (missing.length) {
    alert("يرجى تعبئة: " + missing.join("، "));
    return;
  }

  // ── تحديد هدف التوجيه ──────────────────────────────
  // target    : "college" | "department"
  // departmentKey : مثال "physics" (فقط عند target=department)
  let target        = "college";
  let departmentKey = null;
  let departmentAr  = null;

  if (targetAr === "الكلية") {
    target = "college";
  } else {
    target        = "department";
    departmentKey = DEPT_KEY_MAP[targetAr] || targetAr;
    departmentAr  = targetAr;
  }

  // ── تعطيل زر الإرسال أثناء المعالجة ───────────────
  const submitBtn = document.querySelector('button[onclick="submitForm()"]');
  if (submitBtn) {
    submitBtn.disabled    = true;
    submitBtn.textContent = "جاري الإرسال...";
  }

  try {
    // ── إنشاء وثيقة في Firestore (بدون مرفق أولاً) ──
    const payload = {
      type,              // "شكوى" | "اقتراح" | "استفسار"
      subject,
      details,
      target,            // "college" | "department"
      targetAr,          // النص العربي الكامل
      ...(departmentKey && { departmentKey }),
      ...(departmentAr  && { departmentAr }),
      status:     "new", // new | under_review | resolved | dismissed
      createdAt:  serverTimestamp(),
      updatedAt:  serverTimestamp(),
      // معلومات الطالب إذا كان مسجلاً
      studentUid: currentUser?.uid  || null,
      studentEmail: currentUser?.email || null,
      attachmentUrl: null,
    };

    const docRef = await addDoc(collection(db, "complaints"), payload);

    // ── رفع المرفق إذا وُجد ────────────────────────
    const file = fileInput?.files?.[0];
    if (file) {
      try {
        const url = await uploadAttachment(file, docRef.id);
        // تحديث الوثيقة بـ URL المرفق
        const { updateDoc, doc } = await import(
          "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
        );
        await updateDoc(doc(db, "complaints", docRef.id), {
          attachmentUrl: url
        });
      } catch (uploadErr) {
        console.warn("فشل رفع المرفق (تم حفظ الشكوى بدونه):", uploadErr);
      }
    }

    // ── عرض شاشة النجاح ────────────────────────────
    const trackNum = "CMP-" + new Date().getFullYear() + "-" + docRef.id.slice(0, 6).toUpperCase();
    document.getElementById("tracking-num").textContent = "رقم المتابعة: " + trackNum;
    document.getElementById("success-msg").style.display = "block";
    document.getElementById("complaint-form").reset();




  } catch (err) {
    console.error("خطأ في إرسال الشكوى:", err);
    alert("حدث خطأ أثناء الإرسال، يرجى المحاولة مجدداً.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled    = false;
      submitBtn.textContent = "إرسال الطلب";
    }
  }
}

// =====================================================
//  تعريض الدوال للـ HTML (onclick)
// =====================================================
window.submitForm = submitComplaint;

window.handleFile = function (input) {
  if (!input.files.length) return;
  const file = input.files[0];
  if (file.size > 10 * 1024 * 1024) {
    alert("حجم الملف يتجاوز 10 ميجا، يرجى اختيار ملف أصغر");
    input.value = "";
    return;
  }
  document.getElementById("upload-area").classList.add("has-file");
  document.getElementById("upload-text").innerHTML = "✓ &nbsp;" + file.name;
};

window.resetForm = function () {
  document.getElementById("form-view").style.display    = "block";
  document.getElementById("success-view").style.display = "none";
  document.getElementById("target").value  = "";
  document.getElementById("subject").value = "";
  document.getElementById("details").value = "";
  document.getElementById("file-input").value = "";
  document.getElementById("upload-area").classList.remove("has-file");
  document.getElementById("upload-text").innerHTML =
    'اضغط لرفع ملف أو صورة<br><span style="color:var(--primary);font-weight:bold;">PDF, JPG, PNG, DOCX</span> — حتى 10 ميجا';
  const firstType = document.querySelector('input[name="type"]');
  if (firstType) firstType.checked = true;
};
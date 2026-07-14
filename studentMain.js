import { auth, db } from "./firebase.js";
import { getCurrentSemester } from "./semester.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =========================================================
   حذف طلبات الطالبة عند تغيير التخصص
   =========================================================
   المنطق: نحذف كل طلبات الطالبة (بدون فلتر التخصص) لأن:
   - قيمة assignedDepartment قد لا تطابق major بالضبط
   - عند تغيير التخصص، جميع الطلبات السابقة أصبحت غير ذات صلة

   ما يُحذف:
     ① requests      — فلتر على studentUid
     ② excuses       — فلتر على studentUid
     ③ visitRequests — فلتر على uid

   ما لا يُحذف:
     ✗ complaints — تبقى بغض النظر عن التخصص
========================================================= */
async function deleteOldDepartmentData(uid) {

  // ① حذف طلبات الحذف/الإضافة
  try {
    const q    = query(collection(db, "requests"), where("studentUid", "==", uid));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "requests", d.id))));
    console.log(`تم حذف ${snap.size} طلب من requests`);
  } catch (err) {
    console.error("خطأ أثناء حذف requests:", err);
  }

  // ② حذف الأعذار (كلها — سواء كانت مرتبطة بالقسم أو بشؤون الطالبات)
  try {
    const q    = query(collection(db, "excuses"), where("studentUid", "==", uid));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "excuses", d.id))));
    console.log(`تم حذف ${snap.size} عذر من excuses`);
  } catch (err) {
    console.error("خطأ أثناء حذف excuses:", err);
  }

  // ③ حذف طلبات الزيارة (الفلتر على uid وليس studentUid)
  try {
    const q    = query(collection(db, "visitRequests"), where("uid", "==", uid));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "visitRequests", d.id))));
    console.log(`تم حذف ${snap.size} طلب من visitRequests`);
  } catch (err) {
    console.error("خطأ أثناء حذف visitRequests:", err);
  }

  // ✗ complaints — لا تُحذف عند تغيير التخصص
}

// ==================== Auth ====================

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "loginPage.html";
    return;
  }

  const docRef = doc(db, "students", user.uid);
  const snap   = await getDoc(docRef);

  if (!snap.exists()) {
    console.log("لا توجد بيانات للطالب");
    return;
  }

  const data = snap.data();

  document.getElementById("fullName").textContent     = data.fullName     || "-";
  document.getElementById("universityId").textContent = data.universityId || "-";
  document.getElementById("major").textContent        = data.major        || "-";
  document.getElementById("phoneNumber").textContent  = data.phoneNumber  || "-";

  // عرض اسم الفصل الدراسي الحالي
  try {
    const semesterLineEl = document.getElementById("currentSemesterLine");
    if (semesterLineEl) {
      const currentSemester = await getCurrentSemester();
      semesterLineEl.textContent = currentSemester?.name
        ? `الفصل الدراسي الحالي: ${currentSemester.name}`
        : "";
    }
  } catch (e) {
    console.error("خطأ في عرض الفصل الحالي:", e);
  }

  // ==================== مودال تعديل البيانات ====================

  const editBtn = document.getElementById("editProfileBtn");
  const modal   = document.getElementById("editModal");

  editBtn.addEventListener("click", () => {
    document.getElementById("editMajor").value = data.major       || "";
    document.getElementById("editPhone").value = data.phoneNumber || "";
    modal.style.display = "block";
  });

  document.getElementById("closeModalBtn").addEventListener("click", () => {
    modal.style.display = "none";
  });

  document.getElementById("saveProfileBtn").addEventListener("click", async () => {

    const newMajor = document.getElementById("editMajor").value.trim();
    const newPhone = document.getElementById("editPhone").value.trim();
    const oldMajor = data.major || "";

    try {
      await updateDoc(docRef, {
        major:       newMajor,
        phoneNumber: newPhone
      });

      // إذا تغيّر التخصص فعليًا → احذف جميع الطلبات القديمة
      if (newMajor && oldMajor && newMajor !== oldMajor) {
        await deleteOldDepartmentData(user.uid);
      }

      document.getElementById("major").textContent       = newMajor;
      document.getElementById("phoneNumber").textContent = newPhone;
      data.major       = newMajor;
      data.phoneNumber = newPhone;

      modal.style.display = "none";
      alert("تم تحديث البيانات بنجاح");

    } catch (error) {
      console.error(error);
      alert("حدث خطأ أثناء التحديث");
    }
  });

});

// ==================== تسجيل الخروج ====================

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "loginPage.html";
  } catch (error) {
    console.error("خطأ أثناء تسجيل الخروج:", error);
    alert("حدث خطأ أثناء تسجيل الخروج");
  }
});

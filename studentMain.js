import { auth, db } from "./firebase.js";

import { 
  onAuthStateChanged, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "loginPage.html";
    return;
  }

  const docRef = doc(db, "students", user.uid);
  const snap = await getDoc(docRef);

  if (!snap.exists()) {
    console.log("لا توجد بيانات");
    return;
  }

  const data = snap.data();

  document.getElementById("fullName").textContent = data.fullName || "-";
  document.getElementById("universityId").textContent = data.universityId || "-";
  document.getElementById("major").textContent = data.major || "-";
  document.getElementById("phoneNumber").textContent = data.phoneNumber || "-";

  const editBtn = document.getElementById("editProfileBtn");
  const modal = document.getElementById("editModal");

  editBtn.addEventListener("click", () => {
    document.getElementById("editMajor").value = data.major || "";
    document.getElementById("editPhone").value = data.phoneNumber || "";
    modal.style.display = "block";
  });

  document.getElementById("closeModalBtn").addEventListener("click", () => {
    modal.style.display = "none";
  });

  document.getElementById("saveProfileBtn").addEventListener("click", async () => {

    const newMajor = document.getElementById("editMajor").value.trim();
    const newPhone = document.getElementById("editPhone").value.trim();

    try {
      await updateDoc(docRef, {
        major: newMajor,
        phoneNumber: newPhone
      });

      document.getElementById("major").textContent = newMajor;
      document.getElementById("phoneNumber").textContent = newPhone;

      data.major = newMajor;
      data.phoneNumber = newPhone;

      modal.style.display = "none";

      alert("تم تحديث البيانات بنجاح");

    } catch (error) {
      console.error(error);
      alert("حدث خطأ أثناء التحديث");
    }

  });

});

// زر تسجيل الخروج
const logoutBtn = document.getElementById("logoutBtn");

logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "loginPage.html";
  } catch (error) {
    console.error("خطأ أثناء تسجيل الخروج:", error);
    alert("حدث خطأ أثناء تسجيل الخروج");
  }
});

import { auth, db } from "./firebase.js";

import { onAuthStateChanged }
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  updateDoc
}
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentUserId = null;

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUserId = user.uid;

  const docRef = doc(db, "students", user.uid);
  const snap = await getDoc(docRef);

  if (!snap.exists()) {
    console.log("لا توجد بيانات");
    return;
  }

  const data = snap.data();

  document.getElementById("fullName").textContent =
    data.fullName || "-";

  document.getElementById("universityId").textContent =
    data.universityId || "-";

  document.getElementById("major").textContent =
    data.major || "-";

  document.getElementById("phoneNumber").textContent =
    data.phoneNumber || "-";
});


const editBtn = document.getElementById("editProfileBtn");
const modal = document.getElementById("profileModal");
const closeBtn = document.getElementById("closeModalBtn");
const saveBtn = document.getElementById("saveProfileBtn");

editBtn.addEventListener("click", () => {

  document.getElementById("editPhone").value =
    document.getElementById("phoneNumber").textContent;

  document.getElementById("editMajor").value =
    document.getElementById("major").textContent;

  modal.style.display = "flex";
});

closeBtn.addEventListener("click", () => {
  modal.style.display = "none";
});

saveBtn.addEventListener("click", async () => {

  const phoneNumber =
    document.getElementById("editPhone").value.trim();

  const major =
    document.getElementById("editMajor").value.trim();

  if (!phoneNumber || !major) {
    alert("يرجى تعبئة جميع الحقول");
    return;
  }

  try {

    await updateDoc(
      doc(db, "students", currentUserId),
      {
        phoneNumber,
        major
      }
    );

    document.getElementById("phoneNumber").textContent =
      phoneNumber;

    document.getElementById("major").textContent =
      major;

    modal.style.display = "none";

    alert("تم تحديث البيانات بنجاح");

  } catch (error) {

    console.error(error);
    alert("حدث خطأ أثناء تحديث البيانات");

  }
});
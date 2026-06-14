import { auth, db } from "./firebase.js";

import { onAuthStateChanged } 
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { doc, getDoc } 
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "login.html";
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

});
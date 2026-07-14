import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const studentNameEl  = document.getElementById("studentName");
const visitsTableBody = document.getElementById("visitsTableBody");

// ==================== أدوات مساعدة ====================

function getVisitTypeText(visitType) {
  const map = { internal: "داخلي", external: "خارجي" };
  return map[visitType] || visitType || "-";
}

function getStatusInfo(status) {
  switch (status) {
    case "approved": return { text: "مقبول",        cls: "status-approved" };
    case "rejected": return { text: "مرفوض",        cls: "status-rejected" };
    default:         return { text: "قيد المراجعة", cls: "status-review"   };
  }
}

// ==================== Auth ====================

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "loginPage.html";
    return;
  }

  try {

    // جلب اسم الطالبة
    const studentSnap = await getDoc(doc(db, "students", user.uid));
    if (studentSnap.exists()) {
      studentNameEl.textContent = studentSnap.data().fullName || "الطالب";
    }

    // جلب طلبات الزيارة — الفلتر على "uid" كما في قواعد Firestore
    const q        = query(collection(db, "visitRequests"), where("uid", "==", user.uid));
    const snapshot = await getDocs(q);

    visitsTableBody.innerHTML = "";

    if (snapshot.empty) {
      visitsTableBody.innerHTML = `<tr><td colspan="4">لا توجد طلبات زيارة سابقة</td></tr>`;
      return;
    }

    // ترتيب الأحدث أولاً
    const visits = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

    let count = 1;
    visits.forEach((item) => {
      const { text: statusText, cls: statusClass } = getStatusInfo(item.status);

      visitsTableBody.innerHTML += `
        <tr>
          <td>${count++}</td>
          <td>${getVisitTypeText(item.visitType)}</td>
          <td>${item.visitPlace || "-"}</td>
          <td><span class="status ${statusClass}">${statusText}</span></td>
        </tr>
      `;
    });

  } catch (error) {
    console.error("visitsHistory error:", error);
    visitsTableBody.innerHTML = `<tr><td colspan="4">حدث خطأ: ${error.message}</td></tr>`;
  }

});

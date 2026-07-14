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

const studentNameEl    = document.getElementById("studentName");
const excusesContainer = document.getElementById("excusesTableBody");

// ==================== أدوات مساعدة ====================

function getExamTypeText(examType) {
  const map = {
    final:    "اختبار نهائي",
    midterm1: "اختبار فصلي أول",
    midterm2: "اختبار فصلي ثاني"
  };
  return map[examType] || examType || "-";
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

    // ✅ الفلترة على "studentUid" وليس "uid" لتطابق قواعد Firestore
    const q        = query(collection(db, "excuses"), where("studentUid", "==", user.uid));
    const snapshot = await getDocs(q);

    excusesContainer.innerHTML = "";

    if (snapshot.empty) {
      excusesContainer.innerHTML = `<tr><td colspan="4">لا توجد طلبات أعذار سابقة</td></tr>`;
      return;
    }

    // ترتيب الأحدث أولاً
    const excuses = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

    excuses.forEach((item) => {
      const { text: statusText, cls: statusClass } = getStatusInfo(item.status);

      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${item.courseCode || "-"}</td>
        <td>${getExamTypeText(item.examType)}</td>
        <td><span class="status ${statusClass}">${statusText}</span></td>
        <td>${item.rejectReason || "-"}</td>
      `;
      excusesContainer.appendChild(row);
    });

  } catch (error) {
    console.error("excusesHistory error:", error);
    excusesContainer.innerHTML = `<tr><td colspan="4">حدث خطأ: ${error.message}</td></tr>`;
  }

});

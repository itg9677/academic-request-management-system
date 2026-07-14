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

const studentNameEl = document.getElementById("studentName");
const tableBody     = document.getElementById("requestsTableBody");

// ==================== أدوات مساعدة ====================

function getTypeText(type) {
  const map = { "شكوى": "شكوى", "اقتراح": "اقتراح", "استفسار": "استفسار" };
  return map[type] || type || "-";
}

function getStatusInfo(status) {
  switch (status) {
    case "resolved":     return { text: "تم الحل",       cls: "status-approved" };
    case "dismissed":    return { text: "مرفوضة",         cls: "status-rejected" };
    case "under_review": return { text: "قيد المراجعة",  cls: "status-review"   };
    case "new":
    default:             return { text: "جديد",           cls: "status-review"   };
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

    // جلب الشكاوى والاقتراحات
    const q        = query(collection(db, "complaints"), where("studentUid", "==", user.uid));
    const snapshot = await getDocs(q);

    tableBody.innerHTML = "";

    if (snapshot.empty) {
      tableBody.innerHTML = `<tr><td colspan="4">لا توجد شكاوى أو اقتراحات مرسلة</td></tr>`;
      return;
    }

    // ترتيب الأحدث أولاً
    const complaints = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

    complaints.forEach((item) => {
      const { text: statusText, cls: statusClass } = getStatusInfo(item.status);
      const reply = item.adminReply || "-";

      tableBody.innerHTML += `
        <tr>
          <td>${getTypeText(item.type)}</td>
          <td>${item.subject || "-"}</td>
          <td><span class="${statusClass}">${statusText}</span></td>
          <td>${reply}</td>
        </tr>
      `;
    });

  } catch (error) {
    console.error("Previouscomplaints error:", error);
    tableBody.innerHTML = `<tr><td colspan="4">حدث خطأ: ${error.message}</td></tr>`;
  }

});

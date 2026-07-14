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

function getRequestTypeText(type) {
  const map = { add: "إضافة", remove: "حذف", change: "تغيير شعبة" };
  return map[type] || type || "-";
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

    // جلب طلبات الحذف والإضافة
    const q        = query(collection(db, "requests"), where("studentUid", "==", user.uid));
    const snapshot = await getDocs(q);

    tableBody.innerHTML = "";

    if (snapshot.empty) {
      tableBody.innerHTML = `<tr><td colspan="6">لا توجد طلبات مرسلة</td></tr>`;
      return;
    }

    // ترتيب الأحدث أولاً
    const requests = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

    let count = 1;
    requests.forEach((item) => {
      const { text: statusText, cls: statusClass } = getStatusInfo(item.status);

      const courseDisplay = item.courseName
        ? `${item.courseCode || ""} - ${item.courseName}`
        : (item.courseCode || "-");

      const rejectNote = item.status === "rejected"
        ? (item.rejectReason || "-")
        : "-";

      tableBody.innerHTML += `
        <tr>
          <td>${count++}</td>
          <td>${getRequestTypeText(item.requestType)}</td>
          <td>${courseDisplay}</td>
          <td>${item.requestedSection || "-"}</td>
          <td><span class="${statusClass}">${statusText}</span></td>
          <td>${rejectNote}</td>
        </tr>
      `;
    });

  } catch (error) {
    console.error("previousRequests error:", error);
    tableBody.innerHTML = `<tr><td colspan="6">حدث خطأ: ${error.message}</td></tr>`;
  }

});

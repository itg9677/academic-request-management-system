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

const studentName = document.getElementById("studentName");
const tableBody = document.getElementById("requestsTableBody");

// =====================================================
//  مساعد: تحويل نوع الطلب إلى نص ظاهر
// =====================================================
function getTypeText(type) {
  if (type === "شكوى") return "شكوى";
  if (type === "اقتراح") return "اقتراح";
  if (type === "استفسار") return "استفسار";
  return type || "-";
}

// =====================================================
//  مساعد: تحويل حالة الطلب إلى نص + كلاس CSS
// =====================================================
function getStatusInfo(status) {
  switch (status) {
    case "resolved":
      return { text: "تم الحل", cls: "status-approved" };
    case "dismissed":
      return { text: "مرفوضة", cls: "status-rejected" };
    case "under_review":
      return { text: "قيد المراجعة", cls: "status-review" };
    case "new":
    default:
      return { text: "جديدة", cls: "status-review" };
  }
}

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "loginPage.html";
    return;
  }

  if (!db) {
    console.error("db غير معرف! تحقق من ملف firebase.js");
    tableBody.innerHTML = `<tr><td colspan="4">خطأ في الاتصال بقاعدة البيانات</td></tr>`;
    return;
  }

  try {

    const studentSnap = await getDoc(
      doc(db, "students", user.uid)
    );

    if (studentSnap.exists()) {
      studentName.textContent =
        studentSnap.data().fullName || "الطالب";
    }

    const q = query(
      collection(db, "complaints"),
      where("studentUid", "==", user.uid)
    );

    const snapshot = await getDocs(q);

    tableBody.innerHTML = "";

    if (snapshot.empty) {
      tableBody.innerHTML = `<tr><td colspan="4">لا توجد شكاوى أو اقتراحات مرسلة</td></tr>`;
      return;
    }

    // ترتيب الأحدث أولاً
    const complaints = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    complaints.sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() || 0;
      const bTime = b.createdAt?.toMillis?.() || 0;
      return bTime - aTime;
    });

    complaints.forEach((data) => {

      const { text: statusText, cls: statusClass } = getStatusInfo(data.status);

      const notes = data.adminReply || "-";

      tableBody.innerHTML += `
        <tr>
          <td>${getTypeText(data.type)}</td>
          <td>${data.subject || "-"}</td>
          <td>
            <span class="${statusClass}">
              ${statusText}
            </span>
          </td>
          <td>${notes}</td>
        </tr>
      `;
    });

  } catch (error) {
    console.error("Error:", error);
    tableBody.innerHTML = `<tr><td colspan="4">حدث خطأ: ${error.message}</td></tr>`;
  }

});
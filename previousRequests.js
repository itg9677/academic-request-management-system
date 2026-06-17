import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const tableBody = document.getElementById("requestsTableBody");

function getRequestTypeText(type){
  if(type === "add") return "إضافة";
  if(type === "remove") return "حذف";
  if(type === "change") return "تغيير شعبة";
  return type || "-";
}

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "loginPage.html";
    return;
  }

  if (!db) {
    console.error("db غير معرف! تحقق من ملف firebase.js");
    tableBody.innerHTML = `<tr><td colspan="6">خطأ في الاتصال بقاعدة البيانات</td></tr>`;
    return;
  }

  try {

    const q = query(
      collection(db, "requests"),
where("studentUid", "==", user.uid)    );

    const snapshot = await getDocs(q);

tableBody.innerHTML = "";

if (snapshot.empty) {
  tableBody.innerHTML = `<tr><td colspan="6">لا توجد طلبات مرسلة</td></tr>`;
  return;
}


// ترتيب الأحدث أولاً
const requests = snapshot.docs.map(doc => ({
  id: doc.id,
  ...doc.data()
}));

requests.sort((a, b) => {

  const aTime = a.createdAt?.toMillis?.() || 0;
  const bTime = b.createdAt?.toMillis?.() || 0;

  return bTime - aTime;

});


let count = 1;

requests.forEach((data) => {

      let statusText = "قيد المراجعة";
      let statusClass = "status-review";

      if (data.status === "approved") {
        statusText = "مقبول";
        statusClass = "status-approved";
      }

      if (data.status === "rejected") {
        statusText = "مرفوض";
        statusClass = "status-rejected";
      }

      const courseDisplay = data.courseName
        ? `${data.courseCode || ""} - ${data.courseName}`
        : (data.courseCode || "-");

      tableBody.innerHTML += `
        <tr>
          <td>${count++}</td>
          <td>${getRequestTypeText(data.requestType)}</td>
          <td>${courseDisplay}</td>
          <td>${data.requestedSection || "-"}</td>
          <td>
            <span class="${statusClass}">
              ${statusText}
            </span>
          </td>
        <td>
 ${
   data.status === "rejected"
     ? (data.rejectReason || "-")
     : "-"
 }
</td>
        </tr>
      `;
    });

  } catch (error) {
    console.error("Error:", error);
    tableBody.innerHTML = `<tr><td colspan="6">حدث خطأ: ${error.message}</td></tr>`;
  }

});
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const tableBody = document.getElementById("requestsTableBody");

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {

    const q = query(
      collection(db, "requests"),
      where("studentUid", "==", user.uid)
    );

    const snapshot = await getDocs(q);

    tableBody.innerHTML = "";

    let count = 1;

    snapshot.forEach((doc) => {

      const data = doc.data();

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

      tableBody.innerHTML += `
        <tr>
          <td>${count++}</td>
          <td>${data.requestType || "-"}</td>
          <td>${data.courseCode || "-"}</td>
          <td>${data.courseName || "-"}</td>
          <td>
            <span class="${statusClass}">
              ${statusText}
            </span>
          </td>
        </tr>
      `;
    });

  } catch (error) {
    console.error("Error:", error);
  }

});
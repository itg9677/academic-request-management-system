import { auth, db } from "./firebase.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    collection,
    query,
    where,
    getDocs,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


const studentName = document.getElementById("studentName");
const excusesContainer = document.getElementById("excusesTableBody");

onAuthStateChanged(auth, async (user) => {

    console.log("USER UID:", user.uid);

    if (!user) {
        window.location.href = "loginPage.html";
        return;
    }

 

    /* =========================
       جلب اسم الطالب
    ========================= */
    const studentSnap = await getDoc(
        doc(db, "students", user.uid)
    );

    if (studentSnap.exists()) {
        studentName.textContent =
            studentSnap.data().fullName || "الطالب";
    }

    /* =========================
       جلب طلبات الطالب
    ========================= */
    const excusesQuery = query(
        collection(db, "excuses"),
        where("uid", "==", user.uid)
    );

    const snapshot = await getDocs(excusesQuery);

    excusesContainer.innerHTML = `
<tr>
    <td colspan="3">لا توجد طلبات سابقة</td>
</tr>
`;

snapshot.forEach(docItem => {

    const data = docItem.data();

    const row = document.createElement("tr");

    row.innerHTML = `
        <td>${docItem.id}</td>
        <td>${data.examType || "-"}</td>
        <td>${data.status || "pending"}</td>
    `;

    excusesContainer.appendChild(row);
});
});
import { auth, db } from "./firebase.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    doc,
    getDoc,
    collection,
    query,
    where,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const studentName = document.getElementById("studentName");
const excusesTableBody = document.getElementById("excusesTableBody");

onAuthStateChanged(auth, async (user) => {

    if (!user) {
        window.location.href = "login.html";
        return;
    }

    try {

        // جلب اسم الطالب
        const studentSnap = await getDoc(
            doc(db, "students", user.uid)
        );

        if (studentSnap.exists()) {
            studentName.textContent =
                studentSnap.data().fullName || "الطالب";
        }

        // جلب الأعذار
        const excusesQuery = query(
            collection(db, "excuses"),
            where("studentUid", "==", user.uid)
        );

        const excusesSnap = await getDocs(excusesQuery);

        excusesTableBody.innerHTML = "";

        if (excusesSnap.empty) {

            excusesTableBody.innerHTML = `
                <tr>
                    <td colspan="3">
                        لا توجد أعذار سابقة
                    </td>
                </tr>
            `;

            return;
        }

        let count = 1;

        excusesSnap.forEach((excuseDoc) => {

            const data = excuseDoc.data();

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

            excusesTableBody.innerHTML += `
                <tr>
                    <td>${count++}</td>

                    <td>
                        ${data.excuseType || "عذر"}
                    </td>

                    <td>
                        <span class="${statusClass}">
                            ${statusText}
                        </span>
                    </td>
                </tr>
            `;
        });

    } catch (error) {
        console.error("Error loading excuses:", error);
    }

});
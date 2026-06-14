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
const visitsTableBody = document.getElementById("visitsTableBody");

onAuthStateChanged(auth, async (user) => {

    if (!user) {
        window.location.href = "login.html";
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

        const visitsQuery = query(
            collection(db, "visits"),
            where("studentUid", "==", user.uid)
        );

        const visitsSnap = await getDocs(visitsQuery);

        visitsTableBody.innerHTML = "";

        if (visitsSnap.empty) {

            visitsTableBody.innerHTML = `
                <tr>
                    <td colspan="4">
                        لا توجد طلبات زيارة سابقة
                    </td>
                </tr>
            ` ;

            return;
        }

        let count = 1;

        visitsSnap.forEach((visitDoc) => {

            const data = visitDoc.data();

            let statusText = "قيد المراجعة";

            if (data.status === "approved") {
                statusText = "مقبول";
            }

            if (data.status === "rejected") {
                statusText = "مرفوض";
            }

            visitsTableBody.innerHTML += `
                <tr>
                    <td>${count++}</td>
                    <td>${data.visitType || "-"}</td>
                    <td>${data.assignedDepartment || "-"}</td>
                    <td>${statusText}</td>
                </tr>
            `;
        });

    } catch (error) {
        console.error(error);
    }

});

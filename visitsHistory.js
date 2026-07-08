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
            collection(db, "visitRequests"),
            where("uid", "==", user.uid)
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
            `;

            return;
        }

        let count = 1;

        visitsSnap.forEach((visitDoc) => {

            const data = visitDoc.data();

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

            let visitTypeText = "-";

            if (data.visitType === "internal") {
                visitTypeText = "داخلي";
            } else if (data.visitType === "external") {
                visitTypeText = "خارجي";
            } else if (data.visitType) {
                visitTypeText = data.visitType;
            }

            visitsTableBody.innerHTML += `
                <tr>
                    <td>${count++}</td>
                    <td>${visitTypeText}</td>
                    <td>${data.visitPlace || "-"}</td>
                    <td><span class="status ${statusClass}">${statusText}</span></td>
                </tr>
            `;
        });

    } catch (error) {
        console.error(error);
    }

});
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

    if (!user) {
        window.location.href = "loginPage.html";
        return;
    }

    console.log("USER UID:", user.uid);

    try {

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
           جلب طلبات الأعذار
        ========================= */
        const excusesQuery = query(
            collection(db, "excuses"),
            where("uid", "==", user.uid)
        );

        const snapshot = await getDocs(excusesQuery);

        excusesContainer.innerHTML = "";

        if (snapshot.empty) {
            excusesContainer.innerHTML = `
                <tr>
                    <td colspan="3">لا توجد طلبات سابقة</td>
                </tr>
            `;
            return;
        }

        snapshot.forEach((docItem) => {

            const data = docItem.data();

            /* =========================
               تحويل الحالة للعربي
            ========================= */
            let statusText = "قيد المراجعة";

            if (data.status === "approved") {
                statusText = "مقبول";
            }

            if (data.status === "rejected") {
                statusText = "مرفوض";
            }

            /* =========================
               تحويل نوع الاختبار للعربي
            ========================= */
            let examTypeArabic = "-";

            switch (data.examType) {

                case "final":
                    examTypeArabic = "اختبار نهائي";
                    break;

                case "midterm1":
                    examTypeArabic = "اختبار فصلي أول";
                    break;

                case "midterm2":
                    examTypeArabic = "اختبار فصلي ثاني";
                    break;

                default:
                    examTypeArabic = data.examType || "-";
            }

            const row = document.createElement("tr");

            row.innerHTML = `
                <td>${data.courseCode || "-"}</td>
                <td>${examTypeArabic}</td>
                <td>${statusText}</td>
            `;

            excusesContainer.appendChild(row);
        });

    } catch (error) {

        console.error("Error:", error);

        excusesContainer.innerHTML = `
            <tr>
                <td colspan="3">
                    حدث خطأ أثناء تحميل الطلبات
                </td>
            </tr>
        `;
    }
});
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
        // ✅ لازم نفلتر على "studentUid" مو "uid"، لأن قاعدة الصلاحيات في
        // firestore.rules تتحقق من resource.data.studentUid == request.auth.uid.
        // الفلترة على حقل مختلف عن اللي يتحقق منه الرول تخلي فايرستور يرفض
        // الاستعلام كاملاً بخطأ Missing or insufficient permissions.
        const excusesQuery = query(
            collection(db, "excuses"),
            where("studentUid", "==", user.uid)
        );

        const snapshot = await getDocs(excusesQuery);

        excusesContainer.innerHTML = "";

        if (snapshot.empty) {
            excusesContainer.innerHTML = `
                <tr>
                    <td colspan="4">لا توجد طلبات سابقة</td>
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
            let statusClass = "status-review";

            if (data.status === "approved") {
                statusText = "مقبول";
                statusClass = "status-approved";
            }

            if (data.status === "rejected") {
                statusText = "مرفوض";
                statusClass = "status-rejected";
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

            /* =========================
               بناء الصف
            ========================= */
            const row = document.createElement("tr");

            row.innerHTML = `
                <td>${data.courseCode || "-"}</td>
                <td>${examTypeArabic}</td>
                <td><span class="status ${statusClass}">${statusText}</span></td>
                <td>${data.rejectReason || "-"}</td>
            `;

            excusesContainer.appendChild(row);
        });

    } catch (error) {

        console.error("Error:", error);

        excusesContainer.innerHTML = `
            <tr>
                <td colspan="4">
                    حدث خطأ أثناء تحميل الطلبات
                </td>
            </tr>
        `;
    }
});
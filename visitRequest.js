import { auth, db } from "./firebase.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    collection,
    addDoc,
    doc,
    getDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let courseCounter = 1;

/* ==========================
   إضافة صف مادة (بدون ساعات)
========================== */
window.addCourseRow = function () {

    const tbody = document.getElementById("coursesBody");
    const row   = document.createElement("tr");
    row.id      = `row_${courseCounter}`;

    row.innerHTML = `
        <td>${courseCounter}</td>

        <td>
            <input
                type="text"
                name="courseName_${courseCounter}"
                placeholder="اسم المادة">
        </td>

        <td>
            <input
                type="text"
                name="courseCode_${courseCounter}"
                placeholder="الرمز">
        </td>

        <td>
            <input
                type="text"
                name="section_${courseCounter}"
                placeholder="الشعبة">
        </td>
    `;

    tbody.appendChild(row);
    courseCounter++;
};

/* ==========================
   أول صف تلقائياً
========================== */
window.addEventListener("load", () => {
    addCourseRow();
});

/* ==========================
   عرض رابط تحميل نموذج الزيارة (يرفعه الأدمن من لوحة التحكم)
========================== */

async function loadVisitFormDownload() {
    const container = document.getElementById("visitFormDownload");
    if (!container) return;

    try {
        const snap = await getDoc(doc(db, "settings", "visitForm"));

        if (snap.exists()) {
            const data = snap.data();

            container.innerHTML = `
                <a href="${data.fileUrl}"
                   target="_blank"
                   rel="noopener"
                   class="download-form-link"
                   download="${data.fileName || "نموذج_الزيارة.pdf"}">
                    <span class="download-icon">⬇</span> تحميل نموذج الزيارة
                </a>
            `;
        } else {
            container.innerHTML =
                `<span class="no-form-msg">لم يتم رفع نموذج الزيارة بعد</span>`;
        }
    } catch (error) {
        console.error("loadVisitFormDownload error:", error);
        container.innerHTML =
            `<span class="no-form-msg">تعذر تحميل النموذج، حاولي لاحقاً</span>`;
    }
}

/* ==========================
   بيانات الطالبة
========================== */
onAuthStateChanged(auth, async (user) => {

    if (!user) {
        window.location.href = "loginPage.html";
        return;
    }

    loadVisitFormDownload();

    const studentSnap = await getDoc(doc(db, "students", user.uid));

    if (studentSnap.exists()) {
        const data = studentSnap.data();
        document.getElementById("fullName").value    = data.fullName    || "";
        document.getElementById("universityId").value = data.universityId || "";
        document.getElementById("major").value        = data.major        || "";
        document.getElementById("phone").value         = data.phoneNumber  || "";
    }

    // جلب نموذج الزيارة إذا موجود
    try {
        const settingsSnap = await getDoc(doc(db, "settings", "visitForm"));
        const downloadArea  = document.getElementById("visitFormDownload");

        if (settingsSnap.exists() && settingsSnap.data().fileUrl) {
            const url = settingsSnap.data().fileUrl;
            downloadArea.innerHTML = `
                <a href="${url}" target="_blank" class="download-form-btn">
                    <i>📄</i> تحميل نموذج الزيارة
                </a>`;
        } else {
            downloadArea.innerHTML = `<span class="no-form-msg">لا يوجد نموذج مرفوع حالياً</span>`;
        }
    } catch (_) {
        document.getElementById("visitFormDownload").innerHTML =
            `<span class="no-form-msg">لا يوجد نموذج مرفوع حالياً</span>`;
    }
});

/* ==========================
   إرسال الطلب
========================== */
document.getElementById("submitBtn")
.addEventListener("click", async (e) => {

    e.preventDefault();

    const user = auth.currentUser;
    if (!user) return;

    const visitType  = document.querySelector('input[name="visitType"]:checked')?.value;
    const level      = document.getElementById("level").value;
    const visitPlace = document.getElementById("visitPlace").value;
    const reason     = document.getElementById("reason").value;

    if (!visitType || !level || !visitPlace || !reason) {
        alert("رجاءً تعبئة جميع الحقول");
        return;
    }

    const rows = document.querySelectorAll("#coursesBody tr");

    if (rows.length === 0) {
        alert("رجاءً إضافة مادة واحدة على الأقل");
        return;
    }

    const courses = [];

    rows.forEach(row => {
        const n = row.id.split("_")[1];
        courses.push({
            courseName: document.querySelector(`[name="courseName_${n}"]`)?.value || "",
            courseCode: document.querySelector(`[name="courseCode_${n}"]`)?.value || "",
            section:    document.querySelector(`[name="section_${n}"]`)?.value    || ""
        });
    });

    try {
        await addDoc(collection(db, "visitRequests"), {
            uid:          user.uid,
            fullName:     document.getElementById("fullName").value,
            universityId: document.getElementById("universityId").value,
            major:        document.getElementById("major").value,
            phone:        document.getElementById("phone").value,
            visitType,
            level,
            visitPlace,
            reason,
            courses,
            status:    "new",
            createdAt: serverTimestamp()
        });

        alert("تم إرسال الطلب بنجاح ✅");

        // إعادة ضبط
        document.getElementById("level").value      = "";
        document.getElementById("visitPlace").value = "";
        document.getElementById("reason").value     = "";
        document.getElementById("coursesBody").innerHTML = "";
        const checked = document.querySelector('input[name="visitType"]:checked');
        if (checked) checked.checked = false;
        courseCounter = 1;
        addCourseRow();

    } catch (error) {
        console.error(error);
        alert("حدث خطأ أثناء الإرسال");
    }
});

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    collection, addDoc, doc, getDoc, getDocs, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// قائمة مقررات قسم الطالبة (تُجلب مرة واحدة بحسب التخصص)
let courseOptions = []; // [{ code, name }]
let courseCount = 0;

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "loginPage.html";
        return;
    }

    const studentSnap = await getDoc(doc(db, "students", user.uid));
    if (studentSnap.exists()) {
        const data = studentSnap.data();
        document.getElementById("fullName").value  = data.fullName  || "";
        document.getElementById("universityId").value = data.universityId || "";
        document.getElementById("major").value     = data.major     || "";
        document.getElementById("phone").value     = data.phoneNumber || "";

        // جلب مقررات القسم المطابق لتخصص الطالبة من مجموعة "courses"
        if (data.major) {
            try {
                const coursesQuery = query(
                    collection(db, "courses"),
                    where("department", "==", data.major)
                );
                const coursesSnap = await getDocs(coursesQuery);

                courseOptions = coursesSnap.docs
                    .map((d) => d.data())
                    .map((c) => ({ code: c.courseCode || "", name: c.courseName || "" }))
                    .filter((c) => c.code)
                    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
            } catch (err) {
                console.error("Error loading courses:", err);
                courseOptions = [];
            }
        }
    }
});

// إضافة صف مادة جديد للجدول
window.addCourseRow = function () {
    courseCount++;
    const n = courseCount;

    const tbody = document.getElementById("coursesBody");
    const tr = document.createElement("tr");
    tr.id = `course_${n}`;

    const sBig   = "width:100%;border:none;background:transparent;text-align:center;font-family:Tajawal;font-size:0.9rem;";
    const sSmall = "width:60px;border:none;background:transparent;text-align:center;font-family:Tajawal;font-size:0.9rem;";
    const sNum   = "width:50px;border:none;background:transparent;text-align:center;font-family:Tajawal;font-size:0.9rem;";

    let courseCellHtml;
    let codeCellHtml;

    if (courseOptions.length) {
        // قائمة منسدلة لمقررات القسم — مرتبطة برمز المقرر تلقائيًا
        const options = courseOptions
            .map((c) => `<option value="${c.code}">${c.name}</option>`)
            .join("");

        courseCellHtml = `
            <select name="courseSelect_${n}" style="${sBig}">
                <option value="">اختر المادة</option>
                ${options}
            </select>
        `;
        codeCellHtml = `<input type="text" name="courseCode_${n}" readonly class="readonly-field" style="${sBig}">`;
    } else {
        // لا توجد مقررات مرتبطة بالقسم — إدخال يدوي كما كان
        courseCellHtml = `<input type="text" name="courseName_${n}" placeholder="اسم المادة" style="${sBig}">`;
        codeCellHtml   = `<input type="text" name="courseCode_${n}" placeholder="الرمز" style="${sBig}">`;
    }

    tr.innerHTML = `
        <td>${n}</td>
        <td>${courseCellHtml}</td>
        <td>${codeCellHtml}</td>
        <td><input type="text" name="section_${n}" placeholder="الشعبة" style="${sSmall}"></td>
        <td><input type="number" name="theoryHours_${n}" placeholder="0" min="0" max="6" style="${sNum}"></td>
        <td><input type="number" name="labHours_${n}" placeholder="0" min="0" max="6" style="${sNum}"></td>
    `;

    tbody.appendChild(tr);

    // ربط القائمة المنسدلة برمز المقرر عند الاختيار
    const selectEl = tr.querySelector(`select[name="courseSelect_${n}"]`);
    const codeInput = tr.querySelector(`input[name="courseCode_${n}"]`);
    if (selectEl && codeInput) {
        selectEl.addEventListener("change", () => {
            codeInput.value = selectEl.value;
        });
    }
};

document.getElementById("submitBtn").addEventListener("click", async (e) => {
    e.preventDefault();

    const user = auth.currentUser;
    if (!user) return;

    const visitType  = document.querySelector('input[name="visitType"]:checked')?.value;
    const level      = document.getElementById("level").value;
    const visitPlace = document.getElementById("visitPlace").value;
    const reason     = document.getElementById("reason").value;

    if (!visitType || !level || !visitPlace || !reason) {
        alert("رجاءً عبّي جميع الحقول");
        return;
    }

    const rows = document.querySelectorAll("#coursesBody tr");
    if (rows.length === 0) {
        alert("رجاءً أضيفي مادة واحدة على الأقل");
        return;
    }

    const courses = [];
    let missingCourse = false;

    rows.forEach(row => {
        const n = row.id.split('_')[1];
        const select = row.querySelector(`[name="courseSelect_${n}"]`);

        let courseName = "";
        let courseCode = "";

        if (select) {
            const opt = select.options[select.selectedIndex];
            courseCode = select.value;
            courseName = courseCode ? (opt?.textContent || "") : "";
            if (!courseCode) missingCourse = true;
        } else {
            courseName = document.querySelector(`[name="courseName_${n}"]`)?.value || "";
            courseCode = document.querySelector(`[name="courseCode_${n}"]`)?.value || "";
        }

        courses.push({
            courseName,
            courseCode,
            section:     document.querySelector(`[name="section_${n}"]`)?.value     || "",
            theoryHours: document.querySelector(`[name="theoryHours_${n}"]`)?.value || "0",
            labHours:    document.querySelector(`[name="labHours_${n}"]`)?.value    || "0",
        });
    });

    if (missingCourse) {
        alert("رجاءً اختاري المادة لكل صف مضاف");
        return;
    }

    try {
        await addDoc(collection(db, "visitRequests"), {
            uid:       user.uid,
            fullName:  document.getElementById("fullName").value,
            universityId: document.getElementById("universityId").value,
            major:     document.getElementById("major").value,
            phone:     document.getElementById("phone").value,
            visitType, level, visitPlace, reason, courses,
            status:    "pending",
            createdAt: serverTimestamp()
        });

        alert("تم إرسال الطلب بنجاح ✅");

        document.getElementById("level").value      = "";
        document.getElementById("visitPlace").value = "";
        document.getElementById("reason").value     = "";
        document.getElementById("coursesBody").innerHTML = "";
        const checked = document.querySelector('input[name="visitType"]:checked');
        if (checked) checked.checked = false;

    } catch (error) {
        console.error(error);
        alert("حدث خطأ أثناء الإرسال");
    }
});
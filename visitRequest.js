import { auth, db } from "./firebase.js";
import { getCurrentSemester } from "./semester.js";

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
   إضافة صف مادة
========================== */
window.addCourseRow = function () {

    const tbody = document.getElementById("coursesBody");
    const row   = document.createElement("tr");
    row.id      = `row_${courseCounter}`;

    row.innerHTML = `
        <td>${courseCounter}</td>

        <td>
            <input type="text" name="courseName_${courseCounter}" placeholder="اسم المادة">
        </td>

        <td>
            <input type="text" name="courseCode_${courseCounter}" placeholder="الرمز">
        </td>

        <td>
            <input type="text" name="section_${courseCounter}" placeholder="الشعبة">
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
   ربط التخصص + المقر برمز نموذج الزيارة
========================== */
const majorKeys = {
    "فيزياء":  "physics",
    "كيمياء":  "chemistry",
    "إحصاء":   "statistics",
    "رياضيات": "math",
    "أحياء":   "biology"
};

/* خريطة المقرات المتاحة لكل تخصص */
const majorPlaces = {
    "فيزياء":  ["الأسياح", "عنيزة", "البكيرية", "البدائع", "الرس", "المذنب", "عقلة الصقور", "النبهانية"],
    "كيمياء":  ["عنيزة", "الرس"],
    "أحياء":   ["عنيزة"],
    "رياضيات": ["الأسياح", "عنيزة", "البكيرية", "البدائع", "الرس", "المذنب", "عقلة الصقور", "النبهانية", "رياض الخبراء"],
    "إحصاء":   []
};

/* تصفية قائمة المقر بناءً على التخصص — تخفي غير المتاح */
function populatePlaceSelect(major) {
    const placeSel = document.getElementById("visitPlace");
    if (!placeSel) return;

    const allowed = majorPlaces[major] || [];

    Array.from(placeSel.options).forEach(opt => {
        if (!opt.value) return; // الخيار الافتراضي "اختاري المقر" يبقى دايماً
        opt.hidden   = allowed.length > 0 && !allowed.includes(opt.value);
        opt.disabled = opt.hidden;
    });

    // إعادة تعيين الاختيار لو القيمة الحالية أصبحت مخفية
    if (placeSel.value && !allowed.includes(placeSel.value)) {
        placeSel.value = "";
    }
}

const placeKeys = {
    "البدائع":       "badaya",
    "عنيزة":         "unaizah",
    "الرس":          "rass",
    "الأسياح":       "asyah",
    "البكيرية":      "bukayriyah",
    "رياض الخبراء":  "riyadh_alkhabra",
    "المذنب":        "mithnab",
    "عقلة الصقور":     "uqlat_suqur",
    "النبهانية":     "nihaniyah"
};

function getVisitFormDocId(major, place) {
    const m = majorKeys[major];
    const p = placeKeys[place];
    if (!m || !p) return null;
    return `visitForm_${m}_${p}`;
}

let currentMajor = "";

/* ==========================
   تحميل نموذج الزيارة
========================== */
async function loadVisitFormDownload(visitFormDoc) {

    const container = document.getElementById("visitFormDownload");
    if (!container) return;

    if (!visitFormDoc) {
        container.innerHTML = `<span class="no-form-msg">لا يوجد نموذج متاح لهذا التخصص اوالمقر</span>`;
        return;
    }

    try {
        const snap = await getDoc(doc(db, "settings", visitFormDoc));

        if (snap.exists()) {
            const data = snap.data();
            container.innerHTML = `
                <a href="${data.fileUrl}"
                   target="_blank"
                   class="download-form-link"
                   download="${data.fileName || "نموذج_الزيارة.pdf"}">
                    <span class="download-icon">⬇</span>
                    تحميل نموذج الزيارة
                </a>
            `;
        } else {
            container.innerHTML = `<span class="no-form-msg">لا يوجد نموذج مرفوع لهذا التخصص والمقر</span>`;
        }

    } catch (error) {
        console.error(error);
        container.innerHTML = `<span class="no-form-msg">تعذر تحميل النموذج</span>`;
    }
}

/* ==========================
   إظهار/إخفاء قسم نموذج الزيارة
   يظهر فقط عند: نوع الزيارة = داخلية + تحديد المقر
========================== */
async function updateVisitFormSection() {

    const section   = document.getElementById("visitFormSection");
    const visitType = document.querySelector('input[name="visitType"]:checked')?.value;
    const place     = document.getElementById("visitPlace")?.value;
    const placeGroup = document.getElementById("visitPlaceGroup");

    // إظهار/إخفاء حقل المقر حسب نوع الزيارة
    if (placeGroup) {
        if (visitType === "internal") {
            placeGroup.style.display = "";
        } else {
            placeGroup.style.display = "none";
            if (document.getElementById("visitPlace"))
                document.getElementById("visitPlace").value = "";
        }
    }

    if (!section) return;

    if (visitType !== "internal" || !place) {
        section.classList.add("hidden");
        document.getElementById("visitFormDownload").innerHTML = "";
        return;
    }

    section.classList.remove("hidden");

    const docId = getVisitFormDocId(currentMajor, place);
    await loadVisitFormDownload(docId);
}

/* ==========================
   ربط مستمعي الأحداث لإظهار النموذج
========================== */
window.addEventListener("load", () => {
    document.querySelectorAll('input[name="visitType"]').forEach(radio => {
        radio.addEventListener("change", updateVisitFormSection);
    });
    document.getElementById("visitPlace")?.addEventListener("change", updateVisitFormSection);
});

/* ==========================
   تحميل بيانات الطالبة + النموذج
========================== */
onAuthStateChanged(auth, async (user) => {

    if (!user) {
        window.location.href = "loginPage.html";
        return;
    }

    const studentSnap = await getDoc(doc(db, "students", user.uid));

    if (studentSnap.exists()) {

        const data = studentSnap.data();

        document.getElementById("fullName").value     = data.fullName      || "";
        document.getElementById("universityId").value = data.universityId  || "";
        document.getElementById("major").value        = data.major         || "";
        document.getElementById("phone").value        = data.phoneNumber   || "";

        currentMajor = data.major || "";

        populatePlaceSelect(currentMajor);
        await updateVisitFormSection();
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
        const currentSemester = await getCurrentSemester();

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
            semester:  currentSemester?.semester || null,
            status:    "new",
            createdAt: serverTimestamp()
        });

        alert("تم إرسال الطلب بنجاح ✅");

        // إعادة ضبط النموذج
        document.getElementById("level").value      = "";
        document.getElementById("visitPlace").value = "";
        document.getElementById("reason").value     = "";
        document.getElementById("coursesBody").innerHTML = "";
        const checked = document.querySelector('input[name="visitType"]:checked');
        if (checked) checked.checked = false;

        populatePlaceSelect(currentMajor); // إعادة تعبئة المقرات بعد الإرسال

        courseCounter = 1;
        addCourseRow();

        await updateVisitFormSection();

    } catch (error) {
        console.error(error);
        alert("حدث خطأ أثناء الإرسال");
    }
});
import { auth, db, storage } from "./firebase.js";
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

import {
    ref,
    uploadBytes,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

let courseCounter = 1;

/* ==========================
   إضافة صف مادة
========================== */
window.addCourseRow = function () {

    const tbody = document.getElementById("coursesBody");
    const row   = document.createElement("tr");
    row.id      = `row_${courseCounter}`;

    const displayNumber = tbody.children.length + 1;

    row.innerHTML = `
        <td class="row-number">${displayNumber}</td>

        <td>
            <input type="text" name="courseName_${courseCounter}" placeholder="اسم المادة">
        </td>

        <td>
            <input type="text" name="courseCode_${courseCounter}" placeholder="الرمز">
        </td>

        <td>
            <div class="section-cell">
                <input type="text" name="section_${courseCounter}" placeholder="الشعبة">
                <button type="button" class="btn-remove-course" aria-label="حذف المادة" onclick="removeCourseRow('row_${courseCounter}')">✕</button>
            </div>
        </td>
    `;

    tbody.appendChild(row);
    courseCounter++;

    // إخفاء رسالة الخطأ فور ما الطالب يبدأ يعبي اسم المادة
    row.querySelector(`[name="courseName_${row.id.split("_")[1]}"]`)
        ?.addEventListener("input", () => showCoursesError(false));
};

/* ==========================
   حذف صف مادة
========================== */
window.removeCourseRow = function (rowId) {

    const tbody = document.getElementById("coursesBody");

    if (tbody.children.length <= 1) {
        alert("لازم يبقى مادة واحدة على الأقل");
        return;
    }

    const row = document.getElementById(rowId);
    if (!row) return;

    row.remove();

    // إعادة ترقيم عمود "م" فقط، بدون المساس بأسماء الحقول
    Array.from(tbody.children).forEach((r, index) => {
        const numCell = r.querySelector(".row-number");
        if (numCell) numCell.textContent = index + 1;
    });
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

    const section     = document.getElementById("visitFormSection");
    const visitType   = document.querySelector('input[name="visitType"]:checked')?.value;
    const place       = document.getElementById("visitPlace")?.value;
    const placeGroup  = document.getElementById("visitPlaceGroup");
    const externalGroup      = document.getElementById("externalVisitGroup");
    const externalUniversity = document.getElementById("externalUniversity");
    const courseDescFile     = document.getElementById("courseDescriptionFile");

    // إظهار/إخفاء حقل المقر حسب نوع الزيارة (داخلية فقط)
    if (placeGroup) {
        if (visitType === "internal") {
            placeGroup.style.display = "";
        } else {
            placeGroup.style.display = "none";
            if (document.getElementById("visitPlace"))
                document.getElementById("visitPlace").value = "";
        }
    }

    // إظهار/إخفاء حقول الزيارة الخارجية (اسم الجامعة + مرفق توصيف المقررات)
    if (externalGroup) {
        if (visitType === "external") {
            externalGroup.style.display = "flex";
        } else {
            externalGroup.style.display = "none";
            if (externalUniversity) externalUniversity.value = "";
            if (courseDescFile) courseDescFile.value = "";
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
   التحقق من وجود مادة واحدة على الأقل معبأة
========================== */
function hasAtLeastOneFilledCourse() {
    const rows = document.querySelectorAll("#coursesBody tr");

    return Array.from(rows).some(row => {
        const n = row.id.split("_")[1];
        const name = document.querySelector(`[name="courseName_${n}"]`)?.value.trim();
        return !!name;
    });
}

function showCoursesError(show) {
    const errorEl = document.getElementById("coursesError");
    if (!errorEl) return;
    errorEl.classList.toggle("hidden", !show);
}

/* ==========================
   رفع مرفق توصيف المقررات (للزيارة الخارجية فقط)
========================== */
async function uploadCourseDescriptionFile(file, uid) {
    const safeName = file.name.replace(/[^\w.\-]/g, "_");
    const path = `visitRequests/${uid}/${Date.now()}_${safeName}`;
    const storageRef = ref(storage, path);

    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    return { url, fileName: file.name };
}

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

    const externalUniversity = document.getElementById("externalUniversity")?.value.trim() || "";
    const courseDescInput    = document.getElementById("courseDescriptionFile");
    const courseDescFile     = courseDescInput?.files?.[0] || null;

    if (!visitType || !level || !reason || (visitType === "internal" && !visitPlace)) {
        alert("رجاءً تعبئة جميع الحقول");
        return;
    }

    if (visitType === "external" && (!externalUniversity || !courseDescFile)) {
        alert("رجاءً إدخال اسم الجامعة وإرفاق ملف توصيف المقررات");
        return;
    }

    const rows = document.querySelectorAll("#coursesBody tr");

    if (rows.length === 0 || !hasAtLeastOneFilledCourse()) {
        showCoursesError(true);
        document.getElementById("coursesError").scrollIntoView({ behavior: "smooth", block: "center" });
        return;
    }

    showCoursesError(false);

    const courses = [];

    rows.forEach(row => {
        const n = row.id.split("_")[1];
        courses.push({
            courseName: document.querySelector(`[name="courseName_${n}"]`)?.value || "",
            courseCode: document.querySelector(`[name="courseCode_${n}"]`)?.value || "",
            section:    document.querySelector(`[name="section_${n}"]`)?.value    || ""
        });
    });

    const submitBtn = document.getElementById("submitBtn");
    const originalBtnText = submitBtn.textContent;

    try {
        submitBtn.disabled = true;

        let courseDescriptionUrl  = null;
        let courseDescriptionName = null;

        if (visitType === "external" && courseDescFile) {
            submitBtn.textContent = "جاري رفع المرفق...";
            const uploaded = await uploadCourseDescriptionFile(courseDescFile, user.uid);
            courseDescriptionUrl  = uploaded.url;
            courseDescriptionName = uploaded.fileName;
        }

        submitBtn.textContent = "جاري الإرسال...";

        const currentSemester = await getCurrentSemester();

        await addDoc(collection(db, "visitRequests"), {
            uid:          user.uid,
            fullName:     document.getElementById("fullName").value,
            universityId: document.getElementById("universityId").value,
            major:        document.getElementById("major").value,
            phone:        document.getElementById("phone").value,
            visitType,
            level,
            visitPlace:   visitType === "internal" ? visitPlace : null,
            externalUniversity:    visitType === "external" ? externalUniversity : null,
            courseDescriptionUrl,
            courseDescriptionName,
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
        document.getElementById("reason").value      = "";
        if (document.getElementById("externalUniversity"))
            document.getElementById("externalUniversity").value = "";
        if (courseDescInput) courseDescInput.value = "";
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
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
    }
});
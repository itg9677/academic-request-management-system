import { auth, db, storage } from "./firebase.js";
import { getCurrentSemester } from "./semester.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    collection,
    addDoc,
    serverTimestamp,
    doc,
    getDoc,
    getDocs,
    query,
    where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
    ref,
    uploadBytes,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";


const form = document.getElementById("excuseForm");

let currentUser = null;
let studentData  = null;

/* =========================
   تحميل المقررات في القائمة
========================= */
async function loadCourses(user) {
    try {
        // جلب بيانات الطالب
        const studentSnap = await getDoc(doc(db, "students", user.uid));

        if (!studentSnap.exists()) {
            console.warn("بيانات الطالب غير موجودة");
            return;
        }

        studentData = studentSnap.data();

        // جلب المقررات المطابقة لتخصص الطالب أو شؤون الطالبات
        const coursesSnap = await getDocs(collection(db, "courses"));

        const courseSelect = document.getElementById("courseSelect");
        courseSelect.innerHTML = '<option value="">اختر المقرر</option>';

        const matched = coursesSnap.docs
            .map(d => d.data())
            .filter(c => {
                const dept = (c.department || "").trim();
                return (
                    dept === (studentData.major || "").trim() ||
                    dept === "شؤون الطالبات"
                );
            });

        if (matched.length === 0) {
            const opt = document.createElement("option");
            opt.disabled = true;
            opt.textContent = "لا توجد مقررات مسجّلة لتخصصك";
            courseSelect.appendChild(opt);
            return;
        }

        matched.forEach(course => {
            const option = document.createElement("option");
            option.value       = course.courseCode;
            option.textContent = `${course.courseCode} - ${course.courseName}`;
            courseSelect.appendChild(option);
        });

    } catch (error) {
        console.error("خطأ في تحميل المقررات:", error);
    }
}

/* =========================
   مراقبة حالة تسجيل الدخول
========================= */
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "loginPage.html";
        return;
    }

    currentUser = user;
    await loadCourses(user);
});

/* =========================
   منطق توزيع الطلب على الموظفين
========================= */
function getTargetDepartment(examType, studentMajor) {
    // الاختبار النهائي يروح لشؤون الطالبات
    // الفصلي الأول والثاني يروح لقسم الطالبة (تخصصها)
    return examType === "final"
        ? "شؤون الطالبات"
        : studentMajor;
}

async function getTargetEmployeeIds(targetDept) {

    const empQuery = query(
        collection(db, "employees"),
        where("department", "==", targetDept),
        where("role", "==", "employee")
    );

    const snap = await getDocs(empQuery);
    return snap.docs.map(d => d.id);
}

/* =========================
   إرسال الطلب
========================= */
form.addEventListener("submit", async (e) => {

    e.preventDefault();

    if (!currentUser || !studentData) {
        alert("حدث خطأ في بيانات المستخدم، يرجى تحديث الصفحة");
        return;
    }

    try {
        const courseCode = document.getElementById("courseSelect").value;
        const examDate   = document.getElementById("examDate").value;
        const examType   = document.getElementById("examType").value;
        const reason     = document.getElementById("reason").value.trim();
        const file       = document.getElementById("fileInput").files[0];

        if (!courseCode || !examDate || !examType || !reason) {
            alert("يرجى تعبئة جميع الحقول");
            return;
        }

        // رفع الملف
        let attachmentUrl  = "";
        let attachmentName = "";

        if (file) {
            const storageRef = ref(
                storage,
                `excuses/${currentUser.uid}/${Date.now()}_${file.name}`
            );
            await uploadBytes(storageRef, file);
            attachmentUrl  = await getDownloadURL(storageRef);
            attachmentName = file.name;
        }

        // تحديد القسم المستهدف بناءً على نوع الاختبار
        const targetDept = getTargetDepartment(examType, studentData.major);

        // تحديد الموظفين المستهدفين في ذلك القسم
        const targetEmployeeIds = await getTargetEmployeeIds(targetDept);

        if (targetEmployeeIds.length === 0) {
            alert("لم يتم العثور على موظفين مختصين. تواصل مع الإدارة.");
            return;
        }

        // تحديد الفصل الدراسي الحالي
        const currentSemester = await getCurrentSemester();

        // حفظ الطلب في Firestore
        await addDoc(collection(db, "excuses"), {
            uid:               currentUser.uid,
            studentUid:               currentUser.uid,
            studentName:       studentData.fullName     || "",
            universityId:      studentData.universityId || "",
            major:             studentData.major        || "",
            courseCode,
            examDate,
            examType,
            reason,
            attachmentUrl,
            attachmentName,
            assignedDepartment: targetDept,
            assignedEmployees:  targetEmployeeIds,
            semester:           currentSemester?.semester || null,
            status:             "new",
            createdAt:          serverTimestamp(),
            updatedAt:          serverTimestamp()
        });

        alert("تم إرسال الطلب بنجاح ✅");
        form.reset();

    } catch (error) {
        console.error("Submit error:", error);
        alert("حدث خطأ أثناء إرسال الطلب: " + error.message);
    }
});
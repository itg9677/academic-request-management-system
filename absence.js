import { auth, db, storage } from "./firebase.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    collection,
    addDoc,
    serverTimestamp,
    getDocs,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
    ref,
    uploadBytes,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";


const form = document.getElementById("excuseForm");

let currentUser = null;
let studentData = null;
let availableCourses = [];

/* =========================
   Normalize
========================= */
function normalize(text) {
    return (text || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

/* =========================
   تحميل الطالب + المقررات
========================= */
async function loadCourses(user) {

    try {

        // 🔥 جلب الطالب باستخدام document ID (نفس uid)
        const studentRef = doc(db, "students", user.uid);
        const studentSnap = await getDoc(studentRef);

        if (!studentSnap.exists()) {
            console.log("Student not found");
            return;
        }

        studentData = studentSnap.data();

        // 🔥 جلب المقررات
        const snap = await getDocs(collection(db, "courses"));

        const courseSelect = document.getElementById("courseSelect");

        courseSelect.innerHTML = '<option value="">اختر المقرر</option>';

        availableCourses = snap.docs
            .map(d => d.data())
            .filter(c =>
                normalize(c.department) === normalize(studentData.major) ||
                normalize(c.department) === normalize("شؤون الطالبات")
            );

        availableCourses.forEach(course => {
            const option = document.createElement("option");
            option.value = course.courseCode;
            option.textContent = `${course.courseCode} - ${course.courseName}`;
            courseSelect.appendChild(option);
        });

    } catch (error) {
        console.error("Error loading courses:", error);
    }
}

/* =========================
   تسجيل الدخول
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
   إرسال الطلب
========================= */
form.addEventListener("submit", async (e) => {

    e.preventDefault();

    if (!currentUser || !studentData) {
        alert("حدث خطأ في بيانات المستخدم");
        return;
    }

    const courseCode = document.getElementById("courseSelect").value;
    const examDate = document.getElementById("examDate").value;
    const examType = document.getElementById("examType").value;
    const reason = document.getElementById("reason").value;
    const file = document.getElementById("fileInput").files[0];

    try {

        let attachmentUrl = "";
        let attachmentName = "";

        /* =========================
           رفع الملف
        ========================= */
        if (file) {

            attachmentName = file.name;

            const storageRef = ref(
                storage,
                `excuses/${currentUser.uid}/${Date.now()}_${file.name}`
            );

            console.log("بدء رفع الملف...");

            await uploadBytes(storageRef, file);

            attachmentUrl = await getDownloadURL(storageRef);

            console.log("تم رفع الملف");
        }

        /* =========================
           حفظ الطلب في Firestore
        ========================= */
        const docRef = await addDoc(
            collection(db, "excuses"),
            {
                uid: currentUser.uid,

                universityId: studentData.universityId,
                studentName: studentData.fullName,
                major: studentData.major,

                courseCode,
                examDate,
                examType,
                reason,

                attachmentUrl,
                attachmentName,

                status: "pending",
                createdAt: serverTimestamp()
            }
        );

        console.log("تم حفظ الطلب:", docRef.id);

        alert("تم إرسال الطلب بنجاح");

        form.reset();

    } catch (error) {

        console.error("خطأ:", error);

        alert("فشل الإرسال:\n" + error.message);
    }
});
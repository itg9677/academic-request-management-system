import { auth, db } from "./firebase.js";

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
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const form = document.getElementById("excuseForm");

// جيب المستخدم الحالي بشكل مضمون
function getCurrentUser() {
    return new Promise((resolve) => {
        const unsub = onAuthStateChanged(auth, (user) => {
            unsub();
            resolve(user);
        });
    });
}

/*
  منطق التوزيع:
  - فصلي أول / فصلي ثاني  → موظفو قسم الطالب  (department === student.major)
  - نهائي                 → موظفو شؤون الطالبات (department === "شؤون الطالبات")
  ترجع الدالة مصفوفة UIDs للموظفين المؤهلين
*/
async function getTargetEmployeeIds(examType, studentMajor) {

    let targetDept;

    if (examType === "final") {
        targetDept = "شؤون الطالبات";
    } else {
        // midterm1 أو midterm2 → قسم الطالب
        targetDept = studentMajor;
    }

    const empQuery = query(
        collection(db, "employees"),
        where("department", "==", targetDept),
        where("role", "==", "employee")
    );

    const snap = await getDocs(empQuery);

    return snap.docs.map(d => d.id); // UIDs الموظفين
}

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    try {
        const user = await getCurrentUser();

        if (!user) {
            alert("يجب تسجيل الدخول أولاً");
            window.location.href = "login.html";
            return;
        }

        // جيب بيانات الطالب
        const studentSnap = await getDoc(doc(db, "students", user.uid));

        if (!studentSnap.exists()) {
            alert("لم يتم العثور على بيانات الطالب");
            return;
        }

        const student = studentSnap.data();

        const courseCode  = document.getElementById("courseCode").value.trim();
        const absenceDate = document.getElementById("absenceDate").value;
        const examType    = document.getElementById("examType").value;
        const reason      = document.getElementById("reason").value.trim();
        const file        = document.getElementById("fileInput").files[0];

        if (!courseCode || !absenceDate || !examType || !reason) {
            alert("يرجى تعبئة جميع الحقول");
            return;
        }

        // رفع الملف
        let attachmentUrl  = "";
        let attachmentName = "";

        if (file) {
            const storage    = getStorage();
            const storageRef = ref(
                storage,
                `excuses/${user.uid}/${Date.now()}_${file.name}`
            );
            await uploadBytes(storageRef, file);
            attachmentUrl  = await getDownloadURL(storageRef);
            attachmentName = file.name;
        }

        // حدّد الموظفين المستهدفين
        const targetEmployeeIds = await getTargetEmployeeIds(examType, student.major);

        if (targetEmployeeIds.length === 0) {
            alert("لم يتم العثور على موظفين مختصين. تواصل مع الإدارة.");
            return;
        }

        // حفظ الطلب في Firestore
        // assignedEmployees: مصفوفة UIDs لكل الموظفين المستهدفين
        // كل موظف في قسمه سيرى الطلبات التي تحتوي uid الخاص به في assignedEmployees
        await addDoc(collection(db, "excuses"), {
            uid:              user.uid,
            studentName:      student.fullName      || "",
            universityId:     student.universityId  || "",
            major:            student.major         || "",
            courseCode,
            examDate:         absenceDate,
            examType,
            reason,
            attachmentUrl,
            attachmentName,
            assignedEmployees: targetEmployeeIds,  // مصفوفة UIDs
            status:           "new",
            createdAt:        serverTimestamp(),
            updatedAt:        serverTimestamp()
        });

        alert("تم إرسال الطلب بنجاح ✅");
        form.reset();

    } catch (error) {
        console.error("Submit error:", error);
        alert("حدث خطأ أثناء إرسال الطلب: " + error.message);
    }
});
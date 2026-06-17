import { auth, db } from "./firebase.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    collection,
    addDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const form = document.getElementById("excuseForm");

// دالة تجيب المستخدم بشكل مضمون
function getCurrentUser() {
    return new Promise((resolve) => {
        const unsub = onAuthStateChanged(auth, (user) => {
            unsub();
            resolve(user);
        });
    });
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

        const courseCode = document.getElementById("courseCode").value;
        const absenceDate = document.getElementById("absenceDate").value;
        const examType = document.getElementById("examType").value;
        const reason = document.getElementById("reason").value;
        const file = document.getElementById("fileInput").files[0];

        let fileUrl = "";

        // رفع الملف إذا موجود
        if (file) {
            const storage = getStorage();
            const storageRef = ref(
                storage,
                `excuses/${user.uid}/${Date.now()}_${file.name}`
            );

            await uploadBytes(storageRef, file);
            fileUrl = await getDownloadURL(storageRef);
        }

        // حفظ الطلب في Firestore
        await addDoc(collection(db, "excuses"), {
            studentUid: user.uid,
            courseCode,
            absenceDate,
            examType,
            reason,
            fileUrl,
            status: "pending",
            createdAt: serverTimestamp()
        });

        alert("تم إرسال الطلب بنجاح");
        form.reset();

    } catch (error) {
        console.error("Submit error:", error);
        alert("حدث خطأ أثناء إرسال الطلب");
    }
});
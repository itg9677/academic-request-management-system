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

let currentUser = null;

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }
    currentUser = user;
});

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!currentUser) return;

    const courseCode = document.getElementById("courseCode").value;
    const absenceDate = document.getElementById("absenceDate").value;
    const examType = document.getElementById("examType").value;
    const reason = document.getElementById("reason").value;
    const file = document.getElementById("fileInput").files[0];

    try {
        let fileUrl = "";

        if (file) {
            const storage = getStorage();
            const storageRef = ref(
                storage,
                `excuses/${currentUser.uid}/${Date.now()}_${file.name}`
            );

            await uploadBytes(storageRef, file);
            fileUrl = await getDownloadURL(storageRef);
        }

        await addDoc(collection(db, "excuses"), {
            studentUid: currentUser.uid,
            courseCode: courseCode,
            absenceDate: absenceDate,
            examType: examType,
            excuseType: examType,
            reason: reason,
            fileUrl: fileUrl,
            status: "pending",
            createdAt: serverTimestamp()
        });

        alert("تم إرسال الطلب بنجاح");
        form.reset();

    } catch (error) {
        console.error("Error submitting excuse:", error);
        alert("حدث خطأ أثناء إرسال الطلب");
    }
});
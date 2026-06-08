import { auth, db } from "./firebase.js";

import {
    signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    collection,
    query,
    where,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

console.log("LOGIN LOADED");

const form = document.getElementById("loginForm");

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const universityId = document.getElementById("studentId").value.trim();
    const password = document.getElementById("password").value;

    try {

        const q = query(
            collection(db, "students"),
            where("universityId", "==", universityId)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            alert("❌ الرقم الجامعي غير صحيح");
            return;
        }

        let studentData;

        snapshot.forEach(doc => studentData = doc.data());

        const email = studentData.email;

        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        await user.reload();

        if (!user.emailVerified) {
            alert("⚠️ يجب تفعيل الحساب عبر البريد الإلكتروني أولاً");
            await auth.signOut();
            return;
        }

        window.location.href = "studentMainPage.html";

    } catch (error) {
        console.error(error);
        alert(error.message);
    }
});
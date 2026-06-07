

import { auth, db } from "./firebase.js";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";

const form = document.getElementById("registerForm");
const msg = document.getElementById("msg");

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const studentId = document.getElementById("studentId").value;
    const fullName = document.getElementById("fullName").value;
    const major = document.getElementById("major").value;
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    try {
        msg.style.color = "blue";
        msg.textContent = "جاري إنشاء الحساب...";

        const userCredential = await createUserWithEmailAndPassword(
            auth,
            email,
            password
        );

        const user = userCredential.user;

        msg.style.color = "green";
        msg.textContent = "تم إنشاء الحساب بنجاح";

        console.log("User ID:", user.uid);
        console.log({
            studentId,
            fullName,
            major,
            email
        });

    } catch (error) {
        msg.style.color = "red";
        msg.textContent = error.message;
    }
});


import { auth, db } from "./firebase.js";
import { 
    createUserWithEmailAndPassword,
    sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
    doc, 
    setDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        await sendEmailVerification(user);

        await setDoc(doc(db, "students", user.uid), {
            studentId,
            fullName,
            major,
            email,
            role: "student",
            emailVerified: false,
            createdAt: serverTimestamp()
        });

        msg.style.color = "green";
        msg.textContent = "تم إنشاء الحساب!";

        setTimeout(() => {
            window.location.href = "verifyEmail.html";
        }, 1500);

    } catch (error) {
        console.error(error);
        msg.style.color = "red";
        msg.textContent = error.message;
    }
});
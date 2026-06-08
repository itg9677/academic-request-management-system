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

// التحقق من صيغة الإيميل
    const emailPattern = /^\d{9}@qu\.edu\.sa$/;
    if (!emailPattern.test(email)) {
        msg.style.color = "red";
        msg.textContent = "البريد الإلكتروني يجب أن يكون البريد الجامعي ";
        return;
    }

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
        createdAt: serverTimestamp()
    });

    await auth.signOut();

    msg.style.color = "green";
    msg.textContent = "تم إنشاء الحساب! تحقق من بريدك الإلكتروني";

window.location.href = "verifyEmail.html?type=student";
} catch (error) {
    console.error(error);
    msg.style.color = "red";
    msg.textContent = error.message;
}
});
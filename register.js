import { auth, db } from "./firebase.js";

import {
    createUserWithEmailAndPassword,
    sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    doc,
    setDoc,
    serverTimestamp,
    collection,
    query,
    where,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("registerForm");
const msg = document.getElementById("msg");

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const universityId = document.getElementById("universityId").value.trim();
    const fullName = document.getElementById("fullName").value.trim();
    const phoneNumber = document.getElementById("phoneNumber").value.trim();
    const major = document.getElementById("major").value;
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    // ❌ منع البريد الجامعي
    if (email.endsWith("@qu.edu.sa")) {
        msg.style.color = "red";
        msg.textContent = "لا تستخدم البريد الجامعي";
        return;
    }

    // ❌ التحقق من الرقم الجامعي (9 أرقام)
    const idPattern = /^\d{9}$/;
    if (!idPattern.test(universityId)) {
        msg.style.color = "red";
        msg.textContent = "الرقم الجامعي يجب أن يكون 9 أرقام فقط";
        return;
    }

    // ❌ التحقق من الجوال (يبدأ بـ 05)
    const phonePattern = /^05\d{8}$/;
    if (!phonePattern.test(phoneNumber)) {
        msg.style.color = "red";
        msg.textContent = "رقم الجوال يجب أن يبدأ بـ 05 ويكون 10 أرقام";
        return;
    }

    try {
        msg.style.color = "blue";
        msg.textContent = "جاري التحقق من البيانات...";

        // ❌ منع تكرار الرقم الجامعي
        const q = query(
            collection(db, "students"),
            where("universityId", "==", universityId)
        );

        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            msg.style.color = "red";
            msg.textContent = "الرقم الجامعي مسجل مسبقاً";
            return;
        }

        msg.textContent = "جاري إنشاء الحساب...";

        const userCredential = await createUserWithEmailAndPassword(
            auth,
            email,
            password
        );

        const user = userCredential.user;

        await sendEmailVerification(user);

        await setDoc(doc(db, "students", user.uid), {
            universityId,
            fullName,
            phoneNumber,
            major,
            email,
            role: "student",
            emailVerified: false,
            createdAt: serverTimestamp()
        });

        msg.style.color = "green";
        msg.textContent = "تم إنشاء الحساب بنجاح";

        // ✅ مهم: تأكد من الانتقال
        setTimeout(() => {
            window.location.href = "verifyEmail.html?type=student";
        }, 1000);

    } catch (error) {
        console.error(error);

        msg.style.color = "red";

        switch (error.code) {
            case "auth/email-already-in-use":
                msg.textContent = "البريد الإلكتروني مستخدم مسبقاً";
                break;

            case "auth/weak-password":
                msg.textContent = "كلمة المرور يجب أن تكون 6 أحرف أو أكثر";
                break;

            case "auth/invalid-email":
                msg.textContent = "البريد الإلكتروني غير صحيح";
                break;

            default:
                msg.textContent = "حدث خطأ أثناء إنشاء الحساب";
        }
    }
});
import { auth } from "./firebase.js";

import {
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


// ======================================
// 1. قراءة نوع المستخدم من الرابط
// ======================================
const params = new URLSearchParams(window.location.search);
const type = params.get("type"); 
// type = student أو employee


// ======================================
// 2. عناصر الصفحة
// ======================================
const emailInput = document.getElementById("email");
const resetBtn = document.getElementById("resetBtn");
const msg = document.getElementById("msg");


// ======================================
// 3. تحديد زر الرجوع حسب النوع
// ======================================
const backLink = document.getElementById("backLink");

if (type === "employee") {
    backLink.href = "EmployeeLogin.html";
} else {
    backLink.href = "loginpage.html";
}

// ======================================
// 4. عند الضغط على زر الإرسال
// ======================================
resetBtn.addEventListener("click", async () => {

    const email = emailInput.value.trim();

    // ----------------------------------
    // التحقق من الإدخال
    // ----------------------------------
    if (!email) {
        msg.style.color = "red";
        msg.textContent = "يرجى إدخال البريد الإلكتروني";
        return;
    }

    // ----------------------------------
    // التحقق من صيغة الإيميل
    // ----------------------------------
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
        msg.style.color = "red";
        msg.textContent = "يرجى إدخال بريد إلكتروني صحيح";
        return;
    }

    // ----------------------------------
    // إرسال رابط إعادة التعيين
    // ----------------------------------
    try {

        msg.style.color = "blue";
        msg.textContent = "جاري إرسال رابط إعادة تعيين كلمة المرور...";

        await sendPasswordResetEmail(auth, email);

        msg.style.color = "green";
        msg.textContent =
            "تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني";

    } catch (error) {

        console.error(error);

        msg.style.color = "red";

        switch (error.code) {

            case "auth/user-not-found":
                msg.textContent = "لا يوجد حساب مرتبط بهذا البريد الإلكتروني";
                break;

            case "auth/invalid-email":
                msg.textContent = "البريد الإلكتروني غير صحيح";
                break;

            case "auth/too-many-requests":
                msg.textContent = "تم إجراء محاولات كثيرة، حاول لاحقاً";
                break;

            default:
                msg.textContent = "حدث خطأ أثناء إرسال الرابط";
        }
    }
});
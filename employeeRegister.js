import { auth, db } from "./firebase.js";
import { 
    createUserWithEmailAndPassword,
    sendEmailVerification,
    signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { 
    doc, 
    setDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


const form = document.getElementById("employeeRegisterForm");
const msg = document.getElementById("msg");


form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = document.getElementById("employeeName").value.trim();
    const employeeId = document.getElementById("employeeId").value.trim();
    const department = document.getElementById("department").value;
    const email = document.getElementById("email").value.trim().toLowerCase();
    const password = document.getElementById("password").value;

    try {
        msg.style.color = "blue";
        msg.textContent = "جاري إنشاء الحساب...";

        // 1. إنشاء الحساب
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // 2. إرسال التحقق
        await sendEmailVerification(user);

        // 3. حفظ بيانات الموظف
        // لا يوجد أي حقل isAdmin هنا - الأدمنية تُدار حصريًا من كولكشن adminUids
        await setDoc(doc(db, "employees", user.uid), {
            fullName,
            employeeId,
            jobNumber: employeeId,
            department,
            email,
            role: "employee",
            createdAt: serverTimestamp()
        });

        // 3.5 حفظ سجل بحث بسيط (الرقم الوظيفي → الإيميل فقط) يُستخدم
        // في صفحة تسجيل الدخول قبل أي مصادقة، ولا يحتوي أي بيانات حساسة
        await setDoc(doc(db, "employeeLookup", employeeId), {
            email
        });

        // 4. تسجيل خروج (مهم جدًا)
        await signOut(auth);

        msg.style.color = "green";
        msg.textContent = "تم إنشاء الحساب! تحقق من بريدك الإلكتروني";

        // 5. تحويل لصفحة التحقق
        window.location.href = "verifyEmail.html?type=employee";
    } catch (error) {
        console.error(error);
        msg.style.color = "red";
        msg.textContent = error.message;
    }
});
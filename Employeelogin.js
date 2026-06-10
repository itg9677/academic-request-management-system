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

console.log("EMPLOYEE LOGIN LOADED 🔥");

const form = document.getElementById("employeeLoginForm");

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const employeeId = document.getElementById("employeeId").value.trim();
    const password = document.getElementById("password").value;

    try {

        // 🔍 البحث في employees collection
        const q = query(
            collection(db, "employees"),
            where("employeeId", "==", employeeId)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            alert("❌ الرقم الوظيفي غير صحيح");
            return;
        }

        let employeeData;

        snapshot.forEach(doc => employeeData = doc.data());

        const email = employeeData.email;

        // 🔐 تسجيل الدخول
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        await user.reload();

        // ⚠️ التحقق من الإيميل
        if (!user.emailVerified) {
            alert("⚠️ يجب تفعيل الحساب عبر البريد الإلكتروني");
            await auth.signOut();
            return;
        }

        // 🚀 تحويل للصفحة الرئيسية للموظف
        window.location.href = "EmployeeDashboard.html"

    } catch (error) {
        console.error(error);
        alert(error.message);
    }
});
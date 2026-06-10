import { auth, db } from "./firebase.js";
import {
    signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const form = document.querySelector("form");
const msg = document.getElementById("msg");

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const employeeId = document.getElementById("studentId").value.trim();
    const password = document.getElementById("password").value;

    if (!employeeId || !password) {
        showMsg("يرجى تعبئة جميع الحقول", "red");
        return;
    }

    showMsg("جاري تسجيل الدخول...", "blue");

    try {
        // البحث عن الموظف عن طريق الرقم الوظيفي
        const { getDocs, collection, query, where } = await import(
            "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
        );

        const q = query(
            collection(db, "employees"),
            where("employeeId", "==", employeeId)
        );
        const snap = await getDocs(q);

        if (snap.empty) {
            showMsg("الرقم الوظيفي غير موجود", "red");
            return;
        }

        const empData = snap.docs[0].data();
        const email = empData.email;

        // تسجيل الدخول باستخدام الإيميل وكلمة المرور
        await signInWithEmailAndPassword(auth, email, password);

        // التحقق من الدور
        const userCred = auth.currentUser;
        const empSnap = await getDoc(doc(db, "employees", userCred.uid));

        if (!empSnap.exists() || empSnap.data().role !== "employee") {
            showMsg("ليس لديك صلاحية الدخول", "red");
            return;
        }

        showMsg("تم تسجيل الدخول بنجاح، جاري التحويل...", "green");

        setTimeout(() => {
            window.location.href = "EmployeeDashboard.html";
        }, 1000);

    } catch (error) {
        console.error(error);
        if (error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") {
            showMsg("كلمة المرور غير صحيحة", "red");
        } else if (error.code === "auth/too-many-requests") {
            showMsg("تم تجاوز عدد المحاولات، حاول لاحقاً", "red");
        } else {
            showMsg("حدث خطأ، حاول مجدداً", "red");
        }
    }
});

function showMsg(text, color) {
    msg.style.color = color;
    msg.textContent = text;
}
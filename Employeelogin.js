import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDg4iYMZEdc8pjJU67KtXbSvhBaqdoP0iA",
  authDomain:        "studentsreq-d9ea1.firebaseapp.com",
  projectId:         "studentsreq-d9ea1",
  storageBucket:     "studentsreq-d9ea1.appspot.com",
  messagingSenderId: "375395162945",
  appId:             "1:375395162945:web:e3edb97c48a30ab6401fc0"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

const form = document.getElementById("employeeLoginForm");
const msg  = document.getElementById("msg");

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const employeeId = document.getElementById("employeeId").value.trim();
    const password   = document.getElementById("password").value;

    if (!employeeId || !password) {
        showMsg("يرجى تعبئة جميع الحقول", "red");
        return;
    }

    showMsg("جاري تسجيل الدخول...", "blue");

    try {
        // البحث عن الموظف عن طريق الرقم الوظيفي
        const q    = query(collection(db, "employees"), where("employeeId", "==", employeeId));
        const snap = await getDocs(q);

        if (snap.empty) {
            showMsg("الرقم الوظيفي غير موجود", "red");
            return;
        }

        const empData = snap.docs[0].data();
        const email   = empData.email;

        if (!email) {
            showMsg("لا يوجد بريد إلكتروني مرتبط بهذا الحساب", "red");
            return;
        }

        // تسجيل الدخول
        const userCred = await signInWithEmailAndPassword(auth, email, password);

        // التحقق من الدور
        const empSnap = await getDoc(doc(db, "employees", userCred.user.uid));

        if (!empSnap.exists() || empSnap.data().role !== "employee") {
            showMsg("ليس لديك صلاحية الدخول", "red");
            return;
        }

        showMsg("تم تسجيل الدخول بنجاح، جاري التحويل...", "green");

        setTimeout(() => {
            window.location.href = "EmployeeDashboard.html";
        }, 1000);

    } catch (error) {
        console.error("Login error:", error.code, error.message);

        const errorMessages = {
            "auth/wrong-password":         "كلمة المرور غير صحيحة",
            "auth/invalid-credential":     "كلمة المرور غير صحيحة",
            "auth/user-not-found":         "البريد الإلكتروني غير مسجل",
            "auth/invalid-email":          "البريد الإلكتروني غير صحيح",
            "auth/too-many-requests":      "تم تجاوز عدد المحاولات، حاول لاحقاً",
            "auth/network-request-failed": "تحقق من اتصال الإنترنت",
            "auth/user-disabled":          "هذا الحساب موقوف",
        };

        showMsg(errorMessages[error.code] || "حدث خطأ: " + error.message, "red");
    }
});

function showMsg(text, color) {
    msg.style.color  = color;
    msg.textContent  = text;
}
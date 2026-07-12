import { auth, db } from "./firebase.js";

import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    browserLocalPersistence,
    setPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    collection,
    query,
    where,
    getDocs,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

console.log("EMPLOYEE LOGIN LOADED 🔥");

const form = document.getElementById("employeeLoginForm");

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const employeeId = document.getElementById("employeeId").value.trim();
    const password   = document.getElementById("password").value;

    try {

        // 🔍 البحث في employees collection
        const q = query(
            collection(db, "employees"),
            where("employeeNumber", "==", employeeId)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            alert("❌ الرقم الوظيفي غير صحيح");
            return;
        }

        let employeeData;
        snapshot.forEach(d => employeeData = d.data());

        const email = employeeData.email;

        // ✅ تأكيد حفظ الجلسة في localStorage قبل تسجيل الدخول
        await setPersistence(auth, browserLocalPersistence);

        // 🔐 تسجيل الدخول
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        await user.reload();

        // ⚠️ التحقق من الإيميل
        if (!user.emailVerified) {
            alert("⚠️ يجب تفعيل الحساب عبر البريد الإلكتروني");
            await signOut(auth);
            return;
        }

        // ✅ انتظر Firebase يثبّت الجلسة قبل التوجيه
        await new Promise((resolve, reject) => {
            const unsub = onAuthStateChanged(auth, (firebaseUser) => {
                if (firebaseUser) {
                    unsub();
                    resolve();
                }
            }, reject);
        });

        // 🚀 التحقق من الأدمنية عبر كولكشن adminUids (بدلًا من حقل isAdmin)
        const adminSnap = await getDoc(doc(db, "adminUids", user.uid));

        if (adminSnap.exists()) {
            window.location.href = "adminDashboard.html";
        } else {
            window.location.href = "employeedashboard.html";
        }

    } catch (error) {
        console.error(error);
        alert(error.message);
    }
});
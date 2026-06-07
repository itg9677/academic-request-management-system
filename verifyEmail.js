import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "firebase/auth";
import { doc, updateDoc, getDoc } from "firebase/firestore";

const msg = document.getElementById("msg");

onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    await user.reload();

    if (user.emailVerified) {

        let foundCollection = null;

        // 🔍 نبحث في students
        const studentRef = doc(db, "students", user.uid);
        const studentSnap = await getDoc(studentRef);

        if (studentSnap.exists()) {
            foundCollection = "students";
        }

        // 🔍 نبحث في employees
        const employeeRef = doc(db, "employees", user.uid);
        const employeeSnap = await getDoc(employeeRef);

        if (employeeSnap.exists()) {
            foundCollection = "employees";
        }

        // 🔥 تحديث الكولكشن الصحيح
        if (foundCollection) {
            await updateDoc(doc(db, foundCollection, user.uid), {
                emailVerified: true
            });
        }

        msg.style.color = "green";
        msg.textContent = "تم التحقق من البريد بنجاح 🎉";

        setTimeout(() => {
            window.location.href = "login.html";
        }, 2000);

    } else {
        msg.style.color = "blue";
        msg.textContent = "يرجى التحقق من البريد الإلكتروني...";
    }
});
import { auth } from "./firebase.js";
import { onAuthStateChanged } from "firebase/auth";

const msg = document.getElementById("msg");

const params = new URLSearchParams(window.location.search);
const type = params.get("type");

onAuthStateChanged(auth, async (user) => {

    if (!user) return;

    await user.reload();

    if (user.emailVerified) {

        msg.style.color = "green";
        msg.textContent = "تم التحقق بنجاح 🎉";

        setTimeout(() => {

            if (type === "employee") {
                window.location.href = "EmployeeLogin.html";
            } else {
                window.location.href = "loginPage.html";
            }

        }, 2000);

    } else {
        msg.style.color = "blue";
        msg.textContent = "يرجى فتح البريد وتفعيل الحساب...";
    }
});
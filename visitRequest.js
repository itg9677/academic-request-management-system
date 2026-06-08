import { db } from "./js/firebase-config.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const submitBtn = document.getElementById("submitBtn");

submitBtn.addEventListener("click", async (e) => {
    e.preventDefault();

    const visitType = document.querySelector('input[name="visitType"]:checked')?.value;
    const courseCode = document.getElementById("courseCode").value;
    const courseName = document.getElementById("courseName").value;
    const department = document.getElementById("department").value;
    const visitPlace = document.getElementById("visitPlace").value;
    const reason = document.getElementById("reason").value;

    // تحقق بسيط
    if (!visitType || !courseCode || !courseName || !department || !visitPlace || !reason) {
        alert("رجاءً عبّي جميع الحقول");
        return;
    }

    try {
        await addDoc(collection(db, "visitRequests"), {
            visitType,
            courseCode,
            courseName,
            department,
            visitPlace,
            reason,
            status: "pending",
            createdAt: serverTimestamp()
        });

        alert("تم إرسال الطلب بنجاح");

        // تنظيف الفورم
        document.getElementById("courseCode").value = "";
        document.getElementById("courseName").value = "";
        document.getElementById("department").value = "";
        document.getElementById("visitPlace").value = "";
        document.getElementById("reason").value = "";
        document.querySelector('input[name="visitType"]:checked').checked = false;

    } catch (error) {
        console.error(error);
        alert("حدث خطأ أثناء الإرسال");
    }
});
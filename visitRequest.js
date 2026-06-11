import { auth, db } from "./js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, addDoc, doc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "loginPage.html";
        return;
    }

    const studentSnap = await getDoc(doc(db, "students", user.uid));
    if (studentSnap.exists()) {
        const data = studentSnap.data();
        document.getElementById("fullName").value  = data.fullName  || "";
        document.getElementById("studentId").value = data.studentId || "";
        document.getElementById("major").value     = data.major     || "";
        document.getElementById("phone").value     = data.phone     || "";
    }
});

document.getElementById("submitBtn").addEventListener("click", async (e) => {
    e.preventDefault();

    const user = auth.currentUser;
    if (!user) return;

    const visitType  = document.querySelector('input[name="visitType"]:checked')?.value;
    const level      = document.getElementById("level").value;
    const visitPlace = document.getElementById("visitPlace").value;
    const reason     = document.getElementById("reason").value;

    if (!visitType || !level || !visitPlace || !reason) {
        alert("رجاءً عبّي جميع الحقول");
        return;
    }

    const rows = document.querySelectorAll("#coursesBody tr");
    if (rows.length === 0) {
        alert("رجاءً أضيفي مادة واحدة على الأقل");
        return;
    }

    const courses = [];
    rows.forEach(row => {
        const n = row.id.split('_')[1];
        courses.push({
            courseName:  document.querySelector(`[name="courseName_${n}"]`)?.value  || "",
            courseCode:  document.querySelector(`[name="courseCode_${n}"]`)?.value  || "",
            section:     document.querySelector(`[name="section_${n}"]`)?.value     || "",
            theoryHours: document.querySelector(`[name="theoryHours_${n}"]`)?.value || "0",
            labHours:    document.querySelector(`[name="labHours_${n}"]`)?.value    || "0",
        });
    });

    try {
        await addDoc(collection(db, "visitRequests"), {
            uid:       user.uid,
            fullName:  document.getElementById("fullName").value,
            studentId: document.getElementById("studentId").value,
            major:     document.getElementById("major").value,
            phone:     document.getElementById("phone").value,
            visitType, level, visitPlace, reason, courses,
            status:    "pending",
            createdAt: serverTimestamp()
        });

        alert("تم إرسال الطلب بنجاح ✅");

        document.getElementById("level").value      = "";
        document.getElementById("visitPlace").value = "";
        document.getElementById("reason").value     = "";
        document.getElementById("coursesBody").innerHTML = "";
        const checked = document.querySelector('input[name="visitType"]:checked');
        if (checked) checked.checked = false;

    } catch (error) {
        console.error(error);
        alert("حدث خطأ أثناء الإرسال");
    }
});

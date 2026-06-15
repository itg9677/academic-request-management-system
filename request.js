import { auth, db } from "./firebase.js";

import {
    collection,
    getDocs,
    addDoc,
    serverTimestamp,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged } 
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


let availableCourses = [];
let counters = { add:0, remove:0, change:0 };

/* ===================== */
async function loadCourses(user) {

    const studentRef = doc(db, "students", user.uid);
    const studentSnap = await getDoc(studentRef);

    if (!studentSnap.exists()) return;

    const student = studentSnap.data();

    const snap = await getDocs(collection(db, "courses"));

    availableCourses = snap.docs
        .map(d => d.data())
        .filter(c =>
            c.department === student.major ||
            c.department === "شؤون الطالبات "
        );
}

/* ===================== */
/* دالة للبحث عن اسم المقرر بناءً على رمزه */
function getCourseNameByCode(code){
    const course = availableCourses.find(c => c.courseCode === code);
    return course ? course.courseName : "";
}

/* ===================== */
function createCourseSelect(name){

    return `
    <div class="combo-wrapper">

        <select name="${name}" class="combo-select">
            <option value="">اختر المادة</option>

            ${availableCourses.map(c=>`
                <option value="${c.courseCode}">
                    ${c.courseCode} - ${c.courseName}
                </option>
            `).join("")}

        </select>

    </div>`;
}

/* ===================== */
window.addRow = function(type){

    counters[type]++;

    const container = document.getElementById(type + "List");

    const div = document.createElement("div");
    div.className = "section-block";

    if(type === "add"){

        div.innerHTML = `
            <label>المقرر</label>
            ${createCourseSelect(`add_${counters[type]}`)}

            <label>رقم الشعبة</label>
            <input type="text" name="add_section_${counters[type]}" required>

            <button type="button" class="btn-remove" onclick="this.parentElement.remove()">
                حذف الطلب
            </button>
        `;
    }

    else if(type === "remove"){

        div.innerHTML = `
            <label>المقرر</label>
            ${createCourseSelect(`remove_${counters[type]}`)}

            <button type="button" class="btn-remove" onclick="this.parentElement.remove()">
                حذف الطلب
            </button>
        `;
    }

    else{

        div.innerHTML = `
            <label>المقرر</label>
            ${createCourseSelect(`change_${counters[type]}`)}

            <label>رقم الشعبة الجديدة (إجباري)</label>
            <input type="text" name="change_new_${counters[type]}" required>

            <button type="button" class="btn-remove" onclick="this.parentElement.remove()">
                حذف الطلب
            </button>
        `;
    }

    container.appendChild(div);
};

/* ===================== */
window.goToRequests = function(){
    window.location.href = "requests.html";
};

/* ===================== */
/* التحقق من الشعبة */
function validateChangeSections() {

    const blocks = document.querySelectorAll("#changeList .section-block");

    for (let block of blocks) {

        const course = block.querySelector("select")?.value;
        const section = block.querySelector("input")?.value?.trim();

        if (course && (!section || section === "")) {
            alert("يرجى إدخال رقم الشعبة الجديدة لكل طلب تغيير شعبة");
            return false;
        }
    }

    return true;
}

/* ===================== */
/* إرسال الطلب */
document.getElementById("submitBtn").addEventListener("click", async () => {

    const user = auth.currentUser;
    if(!user) return;

    if (!validateChangeSections()) return;

    const studentRef = doc(db,"students",user.uid);
    const studentSnap = await getDoc(studentRef);
    const student = studentSnap.data();

    const assignedDepartment =
        student.major === "شؤون الطالبات "
            ? "شؤون الطالبات "
            : student.major;

    const notes = document.getElementById("notes").value;

    const requests = [];

    /* ===== ADD ===== */
    document.querySelectorAll("#addList .section-block").forEach(block=>{
        const course = block.querySelector("select")?.value;
        const section = block.querySelector("input")?.value;

        if(course){
            requests.push({
                uid:user.uid,
                universityId:student.universityId,
                requestType:"add",
                courseCode:course,
                courseName:getCourseNameByCode(course),
                requestedSection:section || null,
                assignedDepartment,
                status:"pending",
                notes,
                createdAt:serverTimestamp(),
                updatedAt:serverTimestamp()
            });
        }
    });

    /* ===== REMOVE ===== */
    document.querySelectorAll("#removeList .section-block").forEach(block=>{
        const course = block.querySelector("select")?.value;

        if(course){
            requests.push({
                uid:user.uid,
                universityId:student.universityId,
                requestType:"remove",
                courseCode:course,
                courseName:getCourseNameByCode(course),
                assignedDepartment,
                status:"pending",
                notes,
                createdAt:serverTimestamp(),
                updatedAt:serverTimestamp()
            });
        }
    });

    /* ===== CHANGE ===== */
    document.querySelectorAll("#changeList .section-block").forEach(block=>{
        const course = block.querySelector("select")?.value;
        const section = block.querySelector("input")?.value?.trim();

        if(course){
            requests.push({
                uid:user.uid,
                universityId:student.universityId,
                requestType:"change",
                courseCode:course,
                courseName:getCourseNameByCode(course),
                requestedSection:section,
                assignedDepartment,
                status:"pending",
                notes,
                createdAt:serverTimestamp(),
                updatedAt:serverTimestamp()
            });
        }
    });

    for (let r of requests){
        await addDoc(collection(db,"requests"), r);
    }

    /* ===================== */
    /* 🔥 RESET الصفحة بدل تحويل */

    document.getElementById("addList").innerHTML = "";
    document.getElementById("removeList").innerHTML = "";
    document.getElementById("changeList").innerHTML = "";

    counters = { add:0, remove:0, change:0 };

    document.getElementById("notes").value = "";

    alert("تم إرسال الطلبات بنجاح");
});

/* ===================== */
onAuthStateChanged(auth, async(user)=>{

    if(!user){
        window.location.href = "loginPage.html";
        return;
    }

    await loadCourses(user);
});
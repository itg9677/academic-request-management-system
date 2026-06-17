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
function getCourseNameByCode(code){
    const course = availableCourses.find(c => c.courseCode === code);
    return course ? course.courseName : "";
}
function getCourseDepartmentByCode(code){

    const course = availableCourses.find(
        c => c.courseCode === code
    );

    return course?.department || "";
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

            <label>رقم الشعبة الجديدة</label>
            <input type="text" name="change_new_${counters[type]}" required>

            <button type="button" class="btn-remove" onclick="this.parentElement.remove()">
                حذف الطلب
            </button>
        `;
    }

    container.appendChild(div);
};

/* ===================== */
function validateChangeSections() {

    const blocks = document.querySelectorAll("#changeList .section-block");

    for (let block of blocks) {

        const course = block.querySelector("select")?.value;
        const section = block.querySelector("input")?.value?.trim();

        if (course && (!section || section === "")) {
            alert("يرجى إدخال رقم الشعبة الجديدة");
            return false;
        }
    }

    return true;
}

/* ===================== */
document.getElementById("submitBtn").addEventListener("click", async () => {

    const user = auth.currentUser;
    if(!user) return;

    const studentRef = doc(db,"students",user.uid);
    const studentSnap = await getDoc(studentRef);
    const student = studentSnap.data();

   

    const notes = document.getElementById("notes").value;

    /* ===== Snapshot بيانات الطالب ===== */
    const studentSnapshot = {
        studentUid: user.uid,
        fullName: student.fullName || "",
        universityId: student.universityId || "",
        phoneNumber: student.phoneNumber || "",
        major: student.major || ""
    };

    const requests = [];

    /* ===== ADD ===== */
    document.querySelectorAll("#addList .section-block").forEach(block=>{
        const course = block.querySelector("select")?.value;
        const section = block.querySelector("input")?.value;

        if(course){
          requests.push({
    ...studentSnapshot,

    requestType:"add",
    courseCode:course,
    courseName:getCourseNameByCode(course),
    requestedSection:section || null,
    assignedDepartment: getCourseDepartmentByCode(course),
    status:"new",
    notes,
    createdAt:serverTimestamp(),
    updatedAt:serverTimestamp()
});;
        }
    });

    /* ===== REMOVE ===== */
    document.querySelectorAll("#removeList .section-block").forEach(block=>{
        const course = block.querySelector("select")?.value;

        if(course){
     requests.push({
    ...studentSnapshot,

    requestType:"add",
    courseCode:course,
    courseName:getCourseNameByCode(course),
    assignedDepartment: getCourseDepartmentByCode(course),
    status:"new",
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
    ...studentSnapshot,

    requestType:"add",
    courseCode:course,
    courseName:getCourseNameByCode(course),
    requestedSection:section || null,
    assignedDepartment: getCourseDepartmentByCode(course),
    status:"new",
    notes,
    createdAt:serverTimestamp(),
    updatedAt:serverTimestamp()
});
        }
    });

    if (!validateChangeSections()) return;

    if (requests.length === 0) {
        alert("يرجى إضافة مادة واحدة على الأقل");
        return;
    }

    for (let r of requests){
        await addDoc(collection(db,"requests"), r);
    }

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
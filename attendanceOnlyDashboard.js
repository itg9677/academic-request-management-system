import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initAttendanceEmp, openAttendanceTab, bindAttendanceEvents } from "./attendanceEmp.js";

// ==================== التواريخ ====================
function setDates() {
  const now  = new Date();
  const days = ["الاحد","الاثنين","الثلاثاء","الاربعاء","الخميس","الجمعة","السبت"];
  const gregEl  = document.getElementById("gregDate");
  const hijriEl = document.getElementById("hijriDate");
  if (gregEl)  gregEl.textContent  = days[now.getDay()] + "، " + now.toLocaleDateString("ar-SA-u-ca-gregory");
  if (hijriEl) hijriEl.textContent = now.toLocaleDateString("ar-SA-u-ca-islamic");
}

// تسجيل الخروج
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "EmployeeLogin.html";
});

// عرض حالة "بانتظار الصلاحية" أو "خطأ" برسالة واضحة — تُستخدم كحل احتياطي
// حتى لا تظهر الصفحة فاضية أبدًا مهما كان سبب المشكلة
function showWaitingState({ isError = false, title, text } = {}) {
  const waitingEl = document.getElementById("attWaitingPermission");
  const section    = document.getElementById("attendanceSectionEmp");
  if (section) section.style.display = "none";
  if (!waitingEl) return;

  waitingEl.style.display = "flex";
  waitingEl.classList.toggle("is-error", isError);

  const titleEl = document.getElementById("attWaitingTitle");
  const textEl  = document.getElementById("attWaitingText");
  if (title && titleEl) titleEl.textContent = title;
  if (text  && textEl)  textEl.textContent  = text;
}

function showAttendanceSection() {
  const waitingEl = document.getElementById("attWaitingPermission");
  const section    = document.getElementById("attendanceSectionEmp");
  if (waitingEl) waitingEl.style.display = "none";
  // نفس القيمة المستخدمة بالضبط بصفحة الموظفين العادية (اللي كانت تشتغل صح)
  // بدل الاعتماد فقط على تفريغ initAttendanceEmp للـ style الداخلي
  if (section) section.style.display = "block";
}

// ==================== Auth ====================
auth.authStateReady().then(() => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.replace("EmployeeLogin.html"); return; }

    try {
      const empSnap = await getDoc(doc(db, "employees", user.uid));
      if (!empSnap.exists()) { window.location.replace("EmployeeLogin.html"); return; }

      const empData = empSnap.data();
      if (empData.role !== "employee") { window.location.replace("EmployeeLogin.html"); return; }

      // هذه الصفحة خاصة بموظفي/موظفات "الشؤون التعليمية" فقط — أي موظف آخر
      // يُعاد توجيهه لصفحته العادية بكل الصلاحيات
      if ((empData.department || "").trim() !== "الشؤون التعليمية") {
        window.location.replace("employeedashboard.html");
        return;
      }

      // تعبئة بيانات المستخدم بالسايدبار وقسم الترحيب
      const empName  = empData.fullName || "-";
      const empEmail = empData.email || user.email || "-";

      const elName  = document.getElementById("empName");
      const elEmail = document.getElementById("empEmail");
      if (elName)  elName.textContent  = empName;
      if (elEmail) elEmail.textContent = empEmail;

      const elWelcomeName = document.getElementById("empNameWelcome");
      if (elWelcomeName) elWelcomeName.textContent = empName;

      setDates();

      // ====== فحص صلاحية متابعة الحضور وتهيئتها (مباشرة، بدون تبويبات) ======
      // initAttendanceEmp يرجع true/false حسب وجود مستند attendancePermissions
      // لهذا المستخدم. نغلّفها بـ try/catch مستقل حتى لو صار أي خطأ تقني هنا
      // (مثل مشكلة صلاحيات Firestore) تظهر رسالة واضحة بدل صفحة فاضية.
      try {
        const hasPermission = await initAttendanceEmp(user.uid, { fullName: empData.fullName });

        if (hasPermission) {
          showAttendanceSection();
          bindAttendanceEvents();
          await openAttendanceTab();
        } else {
          showWaitingState({
            isError: false,
            title: "بانتظار منح الصلاحية",
            text: "لم تُمنح صلاحية تسجيل الحضور والغياب لحسابك بعد. يرجى التواصل مع الأدمن لمنحك الصلاحية وتحديد القسم الذي ستتابعين حضوره، ثم أعيدي تحميل الصفحة."
          });
        }
      } catch (attErr) {
        console.error("خطأ أثناء تهيئة صفحة الحضور:", attErr);
        showWaitingState({
          isError: true,
          title: "تعذّر تحميل صفحة الحضور",
          text: "حدث خطأ تقني أثناء التحقق من صلاحيتك. أعيدي تحميل الصفحة، وإذا استمرت المشكلة تواصلي مع الأدمن."
        });
      }

    } catch (err) {
      console.error("Auth error:", err);
      await signOut(auth);
      window.location.replace("EmployeeLogin.html");
    }
  });
});

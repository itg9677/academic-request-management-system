import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDg4iYMZEdc8pjJU67KtXbSvhBaqdoP0iA",
  authDomain:        "studentsreq-d9ea1.firebaseapp.com",
  projectId:         "studentsreq-d9ea1",
  storageBucket:     "studentsreq-d9ea1.appspot.com",
  messagingSenderId: "375395162945",
  appId:             "1:375395162945:web:e3edb97c48a30ab6401fc0"
};

const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const msg    = document.getElementById("msg");
const params = new URLSearchParams(window.location.search);
const type   = params.get("type");

// فحص كل 3 ثواني إذا فعّل المستخدم إيميله
function startPolling(user) {
  const interval = setInterval(async () => {
    await user.reload();
    if (user.emailVerified) {
      clearInterval(interval);
      msg.style.color   = "green";
      msg.textContent   = "تم التحقق بنجاح 🎉";
      setTimeout(() => {
        window.location.href = type === "employee" ? "EmployeeLogin.html" : "loginPage.html";
      }, 2000);
    }
  }, 3000);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    msg.style.color = "red";
    msg.textContent = "لم يتم تسجيل الدخول، يرجى التسجيل أولاً";
    return;
  }

  await user.reload();

  if (user.emailVerified) {
    msg.style.color = "green";
    msg.textContent = "تم التحقق بنجاح 🎉";
    setTimeout(() => {
      window.location.href = type === "employee" ? "EmployeeLogin.html" : "loginPage.html";
    }, 2000);
  } else {
    msg.style.color = "blue";
    msg.textContent = "يرجى فتح البريد وتفعيل الحساب...";
    startPolling(user);
  }
});
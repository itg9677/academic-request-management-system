import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
const db   = getFirestore(app);

const form = document.getElementById("loginForm");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const universityId = document.getElementById("universityId").value.trim();
  const password     = document.getElementById("password").value;

  try {
    const q        = query(collection(db, "students"), where("universityId", "==", universityId));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      alert("❌ الرقم الجامعي غير صحيح");
      return;
    }

    let studentData;
    snapshot.forEach(doc => studentData = doc.data());

    const email          = studentData.email;
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user           = userCredential.user;

    await user.reload();

    if (!user.emailVerified) {
      alert("⚠️ يجب تفعيل الحساب عبر البريد الإلكتروني أولاً");
      await auth.signOut();
      return;
    }

    window.location.href = "studentMainPage.html";

  } catch (error) {
    console.error(error);
    const errorMessages = {
      "auth/wrong-password":         "كلمة المرور غير صحيحة",
      "auth/invalid-credential":     "كلمة المرور غير صحيحة",
      "auth/too-many-requests":      "تم تجاوز عدد المحاولات، حاول لاحقاً",
      "auth/network-request-failed": "تحقق من اتصال الإنترنت",
      "auth/user-disabled":          "هذا الحساب موقوف",
    };
    alert(errorMessages[error.code] || "حدث خطأ: " + error.message);
  }
});
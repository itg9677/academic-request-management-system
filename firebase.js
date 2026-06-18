import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
const firebaseConfig = {
  apiKey: "AIzaSyDg4iYMZEdc8pjJU67KtXbSvhBaqdoP0iA",
  authDomain: "studentsreq-d9ea1.firebaseapp.com",
  projectId: "studentsreq-d9ea1",
  storageBucket: "studentsreq-d9ea1.firebasestorage.app",
  messagingSenderId: "375395162945",
  appId: "1:375395162945:web:e3edb97c48a30ab6401fc0"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);



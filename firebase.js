import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
 apiKey: "AIzaSyDg4iYMZEdc8pjJU67KtXbSvhBaqdoP0iA",
  authDomain: "studentsreq-d9ea1.firebaseapp.com",
  projectId: "studentsreq-d9ea1",
  storageBucket: "studentsreq-d9ea1.firebasestorage.app",
  messagingSenderId: "375395162945",
  appId: "1:375395162945:web:e3edb97c48a30ab6401fc0",
  measurementId: "G-QE6WFE692J"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

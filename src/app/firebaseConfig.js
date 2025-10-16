// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBaR05suHX0sL3OmNQ7QL0fg0CcN0lvLaE",
  authDomain: "tomarlista-aaf22.firebaseapp.com",
  projectId: "tomarlista-aaf22",
  storageBucket: "tomarlista-aaf22.firebasestorage.app",
  messagingSenderId: "1091175180065",
  appId: "1:1091175180065:web:08571da0e96d911b374060",
  measurementId: "G-GYG47VR1VZ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Initialize Analytics only in browser environment
let analytics = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  });
}

export { db };
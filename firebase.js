import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

// Isi dari Firebase Console > Project settings > Your apps > Web app.
// Konfigurasi web bukan pengganti Security Rules; jangan pernah menaruh service-account key di frontend.
export const firebaseConfig = {
  apiKey: "GANTI_API_KEY",
  authDomain: "GANTI_PROJECT_ID.firebaseapp.com",
  projectId: "GANTI_PROJECT_ID",
  storageBucket: "GANTI_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "GANTI_SENDER_ID",
  appId: "GANTI_APP_ID"
};
const configured = !Object.values(firebaseConfig).some(v => String(v).startsWith("GANTI_"));
export const app = configured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const functions = app ? getFunctions(app, "asia-southeast2") : null;
export const storage = app ? getStorage(app) : null;
export { configured };
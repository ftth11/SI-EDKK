// Isi konfigurasi dari Firebase Console > Project settings > Your apps.
// Konfigurasi web Firebase bukan kredensial server. Jangan pernah menaruh service-account key di frontend.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "GANTI_DENGAN_FIREBASE_API_KEY",
  authDomain: "GANTI_PROJECT_ID.firebaseapp.com",
  projectId: "GANTI_PROJECT_ID",
  storageBucket: "GANTI_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "GANTI_SENDER_ID",
  appId: "GANTI_APP_ID"
};

export const firebaseConfigured = !Object.values(firebaseConfig).some(v => String(v).startsWith("GANTI_"));
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

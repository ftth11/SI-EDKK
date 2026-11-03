import { auth, db } from "../config/firebase.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

export async function login(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const snap = await getDoc(doc(db, "users", credential.user.uid));
  if (!snap.exists() || snap.data().aktif !== true) {
    await signOut(auth);
    throw new Error("Akun belum diaktifkan atau profil pengguna belum disiapkan administrator.");
  }
  return { ...snap.data(), uid: credential.user.uid, email: credential.user.email };
}
export const logout = () => signOut(auth);
export const observeAuth = callback => onAuthStateChanged(auth, callback);

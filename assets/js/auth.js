import { auth, db, configured } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

export async function login(email, password) {
  if (!configured) throw new Error("Konfigurasi Firebase belum diisi. Periksa assets/js/firebase.js.");
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const snap = await getDoc(doc(db, "users", credential.user.uid));
  if (!snap.exists() || snap.data().aktif !== true) {
    await signOut(auth);
    throw new Error("Akun belum terdaftar atau dinonaktifkan. Hubungi administrator.");
  }
  return { user: credential.user, profile: snap.data() };
}
export function observeAuth(callback) {
  if (!configured) { callback(null, null); return () => {}; }
  return onAuthStateChanged(auth, async user => {
    if (!user) return callback(null, null);
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists() || snap.data().aktif !== true) { await signOut(auth); return callback(null, null); }
      callback(user, snap.data());
    } catch (e) { console.error(e); callback(null, null); }
  });
}
export async function logout() { if (auth) await signOut(auth); }
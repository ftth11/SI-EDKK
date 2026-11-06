import { auth, db, configured } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

function validProfile(data) {
  return !!data && data.aktif === true && ["Admin", "User"].includes(data.role);
}

export async function login(email, password) {
  if (!configured) throw new Error("Konfigurasi Firebase belum diisi. Periksa assets/js/firebase.js.");
  const credential = await signInWithEmailAndPassword(auth, email, password);
  try {
    const snap = await getDoc(doc(db, "users", credential.user.uid));
    if (!snap.exists() || !validProfile(snap.data())) {
      await signOut(auth);
      throw new Error("Akun tidak aktif atau role belum sesuai. Hubungi administrator.");
    }
    return { user: credential.user, profile: snap.data() };
  } catch (error) {
    if (auth.currentUser) await signOut(auth).catch(() => {});
    throw error;
  }
}

export function observeAuth(callback) {
  if (!configured) { callback(null, null); return () => {}; }
  return onAuthStateChanged(auth, async user => {
    if (!user) return callback(null, null);
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists() || !validProfile(snap.data())) {
        await signOut(auth);
        return callback(null, null);
      }
      callback(user, snap.data());
    } catch (error) {
      console.error("Pemeriksaan profil akun gagal:", error);
      await signOut(auth).catch(() => {});
      callback(null, null);
    }
  });
}

export async function logout() {
  if (auth) await signOut(auth);
}

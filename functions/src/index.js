const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
initializeApp();
const db = getFirestore();
const auth = getAuth();
const REGION = "asia-southeast2";

async function profileFor(uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists || snap.data().aktif !== true) throw new HttpsError("permission-denied", "Akun tidak aktif.");
  return snap.data();
}
function clean(v, max=6000) {
  if (typeof v !== "string") throw new HttpsError("invalid-argument", "Format data tidak valid.");
  const s=v.trim();
  if (!s || s.length>max) throw new HttpsError("invalid-argument", "Ada kolom kosong atau melebihi batas.");
  return s;
}
async function nextNumber(prefix) {
  const year = new Date().getFullYear();
  const ref=db.doc(`counters/${prefix}-${year}`);
  return db.runTransaction(async tx=>{
    const snap=await tx.get(ref); const n=(snap.exists?snap.data().value:0)+1;
    tx.set(ref,{value:n,updatedAt:FieldValue.serverTimestamp()},{merge:true});
    return `${prefix}/${year}/${String(n).padStart(4,"0")}`;
  });
}
async function audit(actorUid, action, target, details={}) {
  await db.collection("auditLogs").add({actorUid,action,target,details,createdAt:FieldValue.serverTimestamp()});
}
exports.healthCheck = onRequest({region:REGION}, (req,res)=>res.status(200).json({service:"SI-ETIK",status:"ok"}));

exports.submitPublicReport = onCall({region:REGION, enforceAppCheck:false}, async request=>{
  const d=request.data||{};
  const jenis=clean(d.jenis,40), unit=clean(d.unit,120), uraian=clean(d.uraian,6000);
  const tanggalKejadian=clean(d.tanggalKejadian,20);
  if (!["Etik","Disiplin","Etik dan Disiplin"].includes(jenis)) throw new HttpsError("invalid-argument","Jenis laporan tidak valid.");
  const reporterMode=d.modePelapor==="teridentifikasi"?"teridentifikasi":"anonim";
  const namaPelapor=reporterMode==="teridentifikasi"?clean(d.namaPelapor,120):"Anonim";
  const nomor=await nextNumber("LAP");
  const ref=await db.collection("reports").add({
    nomor,jenis,unit,uraian,tanggalKejadian,reporterMode,namaPelapor,
    kontakPelapor:reporterMode==="teridentifikasi"?(String(d.kontakPelapor||"").slice(0,160)):"",
    pihakTerkait:String(d.pihakTerkait||"").slice(0,500),
    status:"Baru",source:"public",createdAt:FieldValue.serverTimestamp(),
    createdBy:request.auth?.uid||null,assignedUids:[],auditVisible:false
  });
  await audit(request.auth?.uid||"public", "PUBLIC_REPORT_SUBMITTED", ref.id, {nomor});
  return {nomor};
});

exports.submitInternalReport = onCall({region:REGION}, async request=>{
  if(!request.auth) throw new HttpsError("unauthenticated","Silakan masuk.");
  const p=await profileFor(request.auth.uid);
  const d=request.data||{};
  if (!["Admin", "User"].includes(p.role)) {
    throw new HttpsError(
      "permission-denied",
      "Hanya Admin dan User yang dapat membuat laporan."
    );
  }
  const jenis=clean(d.jenis,40), unit=clean(d.unit,120), uraian=clean(d.uraian,6000);
  const nomor=await nextNumber("LAP");
  const ref=await db.collection("reports").add({nomor,jenis,unit,uraian,tanggalKejadian:clean(d.tanggalKejadian,20),
    namaPelapor:String(d.namaPelapor||p.nama||"").slice(0,120),reporterMode:"teridentifikasi",
    pihakTerkait:String(d.pihakTerkait||"").slice(0,500),status:"Baru",source:"internal",
    createdBy:request.auth.uid,assignedUids:[],createdAt:FieldValue.serverTimestamp()});
  await audit(request.auth.uid,"INTERNAL_REPORT_SUBMITTED",ref.id,{nomor});
  return {nomor};
});

// Kasus dibuat dari laporan setelah pemeriksaan awal oleh petugas komite.
// Callable ini sengaja mensyaratkan role komite dan mencatat audit trail.

exports.convertReportToCase = onCall({ region: REGION }, async request => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Silakan masuk.");
  }

  const p = await profileFor(request.auth.uid);

  if (p.role !== "Admin") {
    throw new HttpsError(
      "permission-denied",
      "Hanya Admin yang dapat mengonversi laporan menjadi kasus."
    );
  }

  const reportId = clean(request.data?.reportId, 150);

  const reportRef = db.doc(`reports/${reportId}`);

  const year = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Jakarta",
    year: "numeric"
  }).format(new Date());

  const counterRef = db.doc(`counters/KAS-${year}`);
  const caseRef = db.collection("cases").doc();

  const result = await db.runTransaction(async tx => {
    const reportSnap = await tx.get(reportRef);

    if (!reportSnap.exists) {
      throw new HttpsError("not-found", "Laporan tidak ditemukan.");
    }

    const reportData = reportSnap.data();

    if (reportData.deletedAt) {
      throw new HttpsError(
        "failed-precondition",
        "Laporan yang sudah dihapus tidak dapat dikonversi."
      );
    }

    if (reportData.status !== "Baru") {
      throw new HttpsError(
        "failed-precondition",
        "Laporan sudah diproses."
      );
    }

    const counterSnap = await tx.get(counterRef);
    const nextValue = (counterSnap.exists
      ? Number(counterSnap.data().value) || 0
      : 0) + 1;

    const nomor = `KAS/${year}/${String(nextValue).padStart(4, "0")}`;

    tx.set(counterRef, {
      value: nextValue,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    tx.set(caseRef, {
      nomor,
      reportId,
      jenis: reportData.jenis,
      unit: reportData.unit,
      uraian: reportData.uraian,
      tanggalKejadian: reportData.tanggalKejadian,
      status: "Dalam Telaah",
      assignedUids: [],
      auditVisible: false,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: request.auth.uid
    });

    tx.update(reportRef, {
      status: "Dikonversi",
      caseId: caseRef.id,
      updatedAt: FieldValue.serverTimestamp()
    });

    return {
      caseId: caseRef.id,
      nomor
    };
  });

  await audit(
    request.auth.uid,
    "REPORT_CONVERTED_TO_CASE",
    result.caseId,
    {
      nomor: result.nomor,
      reportId
    }
  );

  return result;
});



exports.updateCaseStatus = onCall({ region: REGION }, async request => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Silakan masuk.");
  }

  const p = await profileFor(request.auth.uid);

  if (p.role !== "Admin") {
    throw new HttpsError(
      "permission-denied",
      "Hanya Admin yang dapat mengubah status kasus."
    );
  }

  const caseId = clean(request.data?.caseId, 150);
  const status = clean(request.data?.status, 60);

  const allowed = [
    "Dalam Telaah",
    "Pemeriksaan",
    "Menunggu Klarifikasi",
    "Rekomendasi",
    "Selesai",
    "Ditutup"
  ];

  if (!allowed.includes(status)) {
    throw new HttpsError(
      "invalid-argument",
      "Status tidak valid."
    );
  }

  const caseRef = db.doc(`cases/${caseId}`);

  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(caseRef);

    if (!snap.exists) {
      throw new HttpsError(
        "not-found",
        "Data kasus tidak ditemukan."
      );
    }

    const oldStatus = snap.data().status || "";

    if (oldStatus === status) {
      return false;
    }

    tx.update(caseRef, {
      status,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: request.auth.uid
    });

    return true;
  });

  if (result) {
    await audit(
      request.auth.uid,
      "CASE_STATUS_UPDATED",
      caseId,
      { status }
    );
  }

  return { ok: true };
});

exports.setUserRole = onCall({ region: REGION }, async request => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Silakan masuk.");
  }

  const adminProfile = await profileFor(request.auth.uid);

  if (adminProfile.role !== "Admin") {
    throw new HttpsError(
      "permission-denied",
      "Hanya Admin yang dapat mengubah role akun."
    );
  }

  const uid = clean(request.data?.uid, 150);
  const role = clean(request.data?.role, 20);

  if (!["Admin", "User"].includes(role)) {
    throw new HttpsError(
      "invalid-argument",
      "Role hanya boleh Admin atau User."
    );
  }

  if (uid === request.auth.uid) {
    throw new HttpsError(
      "failed-precondition",
      "Admin tidak dapat mengubah role akunnya sendiri."
    );
  }

  const userRef = db.doc(`users/${uid}`);

  await db.runTransaction(async tx => {
    const userSnap = await tx.get(userRef);

    if (!userSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Akun pengguna tidak ditemukan."
      );
    }

    const target = userSnap.data();

    if (
      target.role === "Admin" &&
      target.aktif === true &&
      role !== "Admin"
    ) {
      const adminQuery = db.collection("users")
        .where("role", "==", "Admin")
        .where("aktif", "==", true);

      const adminsSnap = await tx.get(adminQuery);

      if (adminsSnap.size <= 1) {
        throw new HttpsError(
          "failed-precondition",
          "Admin aktif terakhir tidak dapat diubah menjadi User."
        );
      }
    }

    tx.update(userRef, {
      role,
      updatedAt: FieldValue.serverTimestamp()
    });
  });

  await audit(
    request.auth.uid,
    "USER_ROLE_SET",
    uid,
    { role }
  );

  return { ok: true };
});

// ADMIN: Membuat akun pengguna baru

exports.createManagedUser = onCall({ region: REGION }, async request => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Silakan masuk.");
  }

  const adminProfile = await profileFor(request.auth.uid);

  if (adminProfile.role !== "Admin") {
    throw new HttpsError(
      "permission-denied",
      "Hanya Admin yang dapat membuat akun."
    );
  }

  const email = clean(request.data?.email, 160).toLowerCase();
  const password = request.data?.password;
  const nama = clean(request.data?.nama, 120);
  const role = clean(request.data?.role, 20);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Format email tidak valid.");
  }

  if (typeof password !== "string" || password.length < 8) {
    throw new HttpsError(
      "invalid-argument",
      "Password minimal 8 karakter."
    );
  }

  if (!["Admin", "User"].includes(role)) {
    throw new HttpsError(
      "invalid-argument",
      "Role hanya boleh Admin atau User."
    );
  }

  let newUser = null;
  let profileCreated = false;

  try {
    newUser = await auth.createUser({
      email,
      password,
      displayName: nama,
      disabled: false
    });

    await db.doc(`users/${newUser.uid}`).create({
      uid: newUser.uid,
      email,
      nama,
      role,
      aktif: true,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: request.auth.uid,
      updatedAt: FieldValue.serverTimestamp()
    });

    profileCreated = true;

    await audit(
      request.auth.uid,
      "USER_CREATED",
      newUser.uid,
      { email, role }
    );

    return {
      ok: true,
      uid: newUser.uid,
      email
    };

  } catch (error) {
    if (newUser) {
      if (profileCreated) {
        await db.doc(`users/${newUser.uid}`).delete().catch(() => {});
      }

      await auth.deleteUser(newUser.uid).catch(() => {});
    }

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      "Gagal membuat akun pengguna. Silakan coba kembali."
    );
  }
});

// ADMIN: Melihat daftar akun pengguna


exports.listManagedUsers = onCall({ region: REGION }, async request => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Silakan masuk.");
  }

  const adminProfile = await profileFor(request.auth.uid);

  if (adminProfile.role !== "Admin") {
    throw new HttpsError(
      "permission-denied",
      "Hanya Admin yang dapat melihat daftar akun."
    );
  }

  const snapshot = await db.collection("users").get();

  const roleMap = {
    "Admin": "Admin",
    "Ketua Komite": "Admin",
    "Sekretaris": "Admin",
    "User": "User",
    "Anggota Komite": "User",
    "Perawat": "User",
    "Auditor": "User"
  };

  const batch = db.batch();
  const users = [];
  let migrated = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const normalizedRole = roleMap[data.role];

    if (!normalizedRole) {
      throw new HttpsError(
        "failed-precondition",
        `Role akun ${data.email || doc.id} tidak dikenali. Periksa data akun tersebut.`
      );
    }

    if (data.role !== normalizedRole) {
      batch.update(doc.ref, {
        role: normalizedRole,
        updatedAt: FieldValue.serverTimestamp()
      });
      migrated++;
    }

    users.push({
      uid: doc.id,
      nama: data.nama || data.displayName || "",
      email: data.email || "",
      role: normalizedRole,
      aktif: data.aktif === true,
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null
    });
  }

  if (migrated > 0) {
    await batch.commit();

    await audit(
      request.auth.uid,
      "LEGACY_ROLES_MIGRATED",
      "users",
      { migrated }
    );
  }

  users.sort((a, b) =>
    a.nama.localeCompare(b.nama, "id", {
      sensitivity: "base"
    })
  );

  return {
    users,
    total: users.length,
    totalAktif: users.filter(u => u.aktif).length,
    totalNonaktif: users.filter(u => !u.aktif).length,
    migrated
  };
});

// ADMIN: Mengaktifkan atau menonaktifkan akun


exports.setUserActive = onCall({ region: REGION }, async request => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Silakan masuk.");
  }

  const adminProfile = await profileFor(request.auth.uid);

  if (adminProfile.role !== "Admin") {
    throw new HttpsError(
      "permission-denied",
      "Hanya Admin yang dapat mengubah status akun."
    );
  }

  const uid = clean(request.data?.uid, 150);
  const aktif = request.data?.aktif;

  if (typeof aktif !== "boolean") {
    throw new HttpsError(
      "invalid-argument",
      "Status akun tidak valid."
    );
  }

  if (uid === request.auth.uid && !aktif) {
    throw new HttpsError(
      "failed-precondition",
      "Admin tidak dapat menonaktifkan akunnya sendiri."
    );
  }

  const userRef = db.doc(`users/${uid}`);
  const authUser = await auth.getUser(uid);

  const previousAktif = await db.runTransaction(async tx => {
    const userSnap = await tx.get(userRef);

    if (!userSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Akun pengguna tidak ditemukan."
      );
    }

    const target = userSnap.data();
    const previous = target.aktif === true;

    if (previous === aktif) {
      return previous;
    }

    if (!aktif && target.role === "Admin" && previous) {
      const adminQuery = db.collection("users")
        .where("role", "==", "Admin")
        .where("aktif", "==", true);

      const adminsSnap = await tx.get(adminQuery);

      if (adminsSnap.size <= 1) {
        throw new HttpsError(
          "failed-precondition",
          "Admin aktif terakhir tidak dapat dinonaktifkan."
        );
      }
    }

    tx.update(userRef, {
      aktif,
      updatedAt: FieldValue.serverTimestamp()
    });

    return previous;
  });

  if (previousAktif === aktif) {
    return { ok: true, aktif };
  }

  try {
    await auth.updateUser(uid, {
      disabled: !aktif
    });
  } catch (error) {
    // Pulihkan status Firestore jika perubahan Auth gagal.
    await db.runTransaction(async tx => {
      const snap = await tx.get(userRef);

      if (snap.exists && snap.data().aktif === aktif) {
        tx.update(userRef, {
          aktif: previousAktif,
          updatedAt: FieldValue.serverTimestamp()
        });
      }
    }).catch(() => {});

    throw new HttpsError(
      "internal",
      "Gagal mengubah status akun. Status sebelumnya dipulihkan."
    );
  }

  await audit(
    request.auth.uid,
    aktif ? "USER_ACTIVATED" : "USER_DEACTIVATED",
    uid,
    { email: authUser.email || "" }
  );

  return { ok: true, aktif };
});


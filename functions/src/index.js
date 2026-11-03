const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
initializeApp();
const db = getFirestore();
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
exports.healthCheck = onRequest({region:REGION}, (req,res)=>res.status(200).json({service:"SI-EDKK",status:"ok"}));

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
  if(!["Admin","Ketua Komite","Sekretaris","Anggota Komite","Perawat"].includes(p.role)) throw new HttpsError("permission-denied","Tidak memiliki hak pelaporan.");
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
exports.convertReportToCase = onCall({region:REGION}, async request=>{
  if(!request.auth) throw new HttpsError("unauthenticated","Silakan masuk.");
  const p=await profileFor(request.auth.uid);
  if(!["Admin","Ketua Komite","Sekretaris"].includes(p.role)) throw new HttpsError("permission-denied","Hanya ketua/sekretaris/admin.");
  const reportId=clean(request.data?.reportId,150);
  const reportRef=db.doc(`reports/${reportId}`);
  const result=await db.runTransaction(async tx=>{
    const snap=await tx.get(reportRef);
    if(!snap.exists) throw new HttpsError("not-found","Laporan tidak ditemukan.");
    if(snap.data().status!=="Baru") throw new HttpsError("failed-precondition","Laporan sudah diproses.");
    const nomor=await nextNumber("KAS");
    const caseRef=db.collection("cases").doc();
    tx.set(caseRef,{nomor,reportId,jenis:snap.data().jenis,unit:snap.data().unit,uraian:snap.data().uraian,
      tanggalKejadian:snap.data().tanggalKejadian,status:"Dalam Telaah",assignedUids:[],auditVisible:false,
      createdAt:FieldValue.serverTimestamp(),createdBy:request.auth.uid});
    tx.update(reportRef,{status:"Dikonversi",caseId:caseRef.id,updatedAt:FieldValue.serverTimestamp()});
    return {caseId:caseRef.id,nomor};
  });
  await audit(request.auth.uid,"REPORT_CONVERTED_TO_CASE",result.caseId,{nomor:result.nomor,reportId});
  return result;
});

exports.updateCaseStatus = onCall({region:REGION}, async request=>{
  if(!request.auth) throw new HttpsError("unauthenticated","Silakan masuk.");
  const p=await profileFor(request.auth.uid);
  if(!["Admin","Ketua Komite","Sekretaris"].includes(p.role)) throw new HttpsError("permission-denied","Tidak memiliki hak mengubah status.");
  const caseId=clean(request.data?.caseId,150), status=clean(request.data?.status,60);
  const allowed=["Dalam Telaah","Pemeriksaan","Menunggu Klarifikasi","Rekomendasi","Selesai","Ditutup"];
  if(!allowed.includes(status)) throw new HttpsError("invalid-argument","Status tidak valid.");
  await db.doc(`cases/${caseId}`).update({status,updatedAt:FieldValue.serverTimestamp(),updatedBy:request.auth.uid});
  await audit(request.auth.uid,"CASE_STATUS_UPDATED",caseId,{status});
  return {ok:true};
});

exports.setUserRole = onCall({region:REGION}, async request=>{
  if(!request.auth) throw new HttpsError("unauthenticated","Silakan masuk.");
  const p=await profileFor(request.auth.uid);
  if(p.role!=="Admin") throw new HttpsError("permission-denied","Hanya admin.");
  const uid=clean(request.data?.uid,150), role=clean(request.data?.role,50);
  const allowed=["Admin","Ketua Komite","Sekretaris","Anggota Komite","Perawat","Auditor"];
  if(!allowed.includes(role)) throw new HttpsError("invalid-argument","Role tidak dikenal.");
  await db.doc(`users/${uid}`).set({role,updatedAt:FieldValue.serverTimestamp(),aktif:true},{merge:true});
  await audit(request.auth.uid,"USER_ROLE_SET",uid,{role});
  return {ok:true};
});
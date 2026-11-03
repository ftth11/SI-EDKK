import { configured, functions } from "./firebase.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
const form=document.querySelector("#publicReportForm");
const mode=document.querySelector("#modePelapor");
const identity=document.querySelector("#identityFields");
mode.addEventListener("change",()=>identity.classList.toggle("hidden",mode.value!=="teridentifikasi"));
form.addEventListener("submit",async e=>{
  e.preventDefault(); const out=document.querySelector("#reportMessage"); out.textContent="";
  if(!configured){out.textContent="Layanan belum diaktifkan. Silakan hubungi administrator.";return;}
  const data=Object.fromEntries(new FormData(form)); data.source="public";
  try {
    const submit= httpsCallable(functions,"submitPublicReport");
    const result=await submit(data);
    out.textContent=`Laporan berhasil diterima. Simpan nomor referensi ini: ${result.data.nomor}.`;
    form.reset(); identity.classList.add("hidden");
  } catch(err){out.textContent="Laporan belum dapat dikirim. Silakan coba kembali atau hubungi sekretariat komite.";console.error(err);}
});
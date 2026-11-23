import { configured } from "./firebase.js";
const API_URL = "https://si-etik-api.baits-ap97.workers.dev";
const form=document.querySelector("#publicReportForm");
const mode=document.querySelector("#modePelapor");
const identity=document.querySelector("#identityFields");
mode.addEventListener("change",()=>identity.classList.toggle("hidden",mode.value!=="teridentifikasi"));
form.addEventListener("submit",async e=>{
  e.preventDefault(); const out=document.querySelector("#reportMessage"); out.textContent="";
  if(!configured){out.textContent="Layanan belum diaktifkan. Silakan hubungi administrator.";return;}
  const data=Object.fromEntries(new FormData(form));
  const button=form.querySelector('button[type="submit"]');
  if(button){button.disabled=true;button.textContent="Mengirim...";}
  try {
    const response=await fetch(`${API_URL}/public-report`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok||result.success!==true) throw new Error(result.error||"Laporan gagal dikirim.");
    out.textContent=`Laporan berhasil diterima. Simpan nomor referensi ini: ${result.nomor}.`;
    form.reset(); identity.classList.add("hidden");
  } catch(err){out.textContent=err.message||"Laporan belum dapat dikirim. Silakan coba kembali atau hubungi sekretariat komite.";console.error(err);}
  finally{if(button){button.disabled=false;button.textContent="Kirim laporan";}}
});

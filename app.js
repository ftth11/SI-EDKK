import { login, observeAuth, logout } from "./auth.js";
import { renderPage } from "./modules.js";
import { $, $$, toast, initTheme, setTheme } from "./ui.js";
import { configured } from "./firebase.js";

initTheme();
if ("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.warn));
const loginView=$("#loginView"), appView=$("#appView");
let currentPage="dashboard";
$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault(); $("#loginError").textContent="";
  try { await login($("#loginEmail").value.trim(),$("#loginPassword").value); }
  catch(err){ $("#loginError").textContent=err.message; }
});
observeAuth(async (user,profile)=>{
  if(!user){appView.classList.add("hidden");loginView.classList.remove("hidden");return;}
  window.currentProfile=profile;
  loginView.classList.add("hidden");appView.classList.remove("hidden");
  $("#userName").textContent=profile.nama||user.email; $("#userRole").textContent=profile.role||"User";
  $$(".admin-only").forEach(el=>el.classList.toggle("hidden",profile.role!=="Admin"));
  await navigate("dashboard");
});
async function navigate(page){
  currentPage=page; $$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  $("#sidebar").classList.remove("open"); await renderPage(page,window.currentProfile);
}
$("#mainNav").addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b)navigate(b.dataset.page);});
$("#pageContent").addEventListener("click",e=>{const b=e.target.closest("[data-goto]");if(b)navigate(b.dataset.goto);});
$("#logoutBtn").onclick=()=>logout().catch(e=>toast(e.message,"error"));
$("#themeToggle").onclick=()=>setTheme(document.documentElement.dataset.theme==="dark"?"light":"dark");
$("#menuToggle").onclick=()=>$("#sidebar").classList.toggle("open");
if(!configured) $("#loginError").textContent="Konfigurasi Firebase belum diisi. Lengkapi assets/js/firebase.js sebelum login.";
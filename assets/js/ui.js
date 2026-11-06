export const $ = (s, root=document) => root.querySelector(s);
export const $$ = (s, root=document) => [...root.querySelectorAll(s)];
export function toast(message, type="info") {
  const el=$("#toast"); if(!el) return;
  el.textContent=message; el.dataset.type=type; el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"),3500);
}
export function escapeHtml(value="") {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
export function dateLabel(value) {
  if(!value) return "-";
  const d=value?.toDate ? value.toDate() : new Date(value);
  return isNaN(d) ? "-" : new Intl.DateTimeFormat("id-ID",{dateStyle:"medium"}).format(d);
}
export function setTheme(theme) {
  document.documentElement.dataset.theme=theme;
  localStorage.setItem("si-edkk-theme",theme);
}
export function initTheme() { setTheme(localStorage.getItem("si-edkk-theme") || "light"); }
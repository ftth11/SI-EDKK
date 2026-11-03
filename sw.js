const CACHE_NAME = "si-edkk-shell-v1";
const SHELL = ["./", "./index.html", "./pelaporan.html", "./manifest.json", "./assets/css/main.css",
"./assets/js/app.js", "./assets/js/firebase.js", "./assets/js/auth.js", "./assets/js/ui.js",
"./assets/js/modules.js", "./assets/js/public-report.js", "./assets/images/icon.svg"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  // Never cache Firebase/API requests, authenticated data, or non-GET requests.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.includes("/__/") || url.pathname.includes("firestore") || url.pathname.includes("storage")) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok && response.type === "basic") {
      const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    }
    return response;
  })));
});

const CACHE_NAME = "si-etik-shell-v2";

const SHELL = [
  "./",
  "./index.html",
  "./pelaporan.html",
  "./manifest.json",
  "./assets/css/main.css",
  "./assets/js/app.js",
  "./assets/js/firebase.js",
  "./assets/js/auth.js",
  "./assets/js/ui.js",
  "./assets/js/modules.js",
  "./assets/js/public-report.js",
  "./assets/images/icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // Hanya menangani permintaan GET dari domain aplikasi.
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // Jangan menyimpan data Firebase/API ke cache.
  if (
    url.pathname.includes("/__/") ||
    url.pathname.includes("firestore") ||
    url.pathname.includes("storage")
  ) {
    return;
  }

  // File HTML selalu diperiksa ke server agar pembaruan aplikasi terdeteksi.
  if (
    request.mode === "navigate" ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith("/")
  ) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache =>
              cache.put(request, copy)
            );
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // File pendukung menggunakan cache terlebih dahulu.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache =>
            cache.put(request, copy)
          );
        }
        return response;
      });
    })
  );
});

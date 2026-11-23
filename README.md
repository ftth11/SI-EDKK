# SI-ETIK — UPTD RSUD Kelas D Pondokgede

Aplikasi SI-ETIK menggunakan dua role: **Admin** dan **User**.

## Arsitektur
- Frontend statis: GitHub Pages.
- Autentikasi dan profil login: Firebase Authentication + Firestore.
- Seluruh operasi data administratif dan pelaporan: Cloudflare Worker melalui Firestore REST API.
- Penyimpanan privat bukti foto dan dokumen: Cloudflare KV (`BUKTI_KV`).
- Firebase Cloud Functions tidak digunakan dan tidak perlu di-deploy.
- Firebase Storage tidak digunakan untuk penyimpanan bukti/dokumen aplikasi.

## Konfigurasi tetap
- Firebase project ID: `si-edkk`.
- Worker API: `https://si-etik-api.baits-ap97.workers.dev`.
- Allowed origin: `https://ftth11.github.io`.
- Worker secrets: `GOOGLE_SERVICE_ACCOUNT_JSON`, `FIREBASE_WEB_API_KEY`.
- Worker KV binding: `BUKTI_KV` ke namespace `SI-ETIK-BUKTI`.

Jangan pernah memasukkan Service Account JSON/private key ke GitHub atau file frontend.

## Deploy frontend
1. Unggah isi folder `SI-ETIK` ke root repository GitHub Pages yang digunakan.
2. Pastikan `assets/js/firebase.js` berisi konfigurasi Web App Firebase proyek `si-edkk`.
3. Pastikan Firebase Authentication > Authorized domains memuat `ftth11.github.io`.
4. Pastikan GitHub Pages menerbitkan versi commit terbaru.

## Deploy Cloudflare Worker
1. Buka Worker `si-etik-api` di Cloudflare Dashboard.
2. Ganti source Worker dengan isi `cloudflare/worker.js` secara utuh.
3. Pastikan binding KV bernama persis `BUKTI_KV` dan menunjuk namespace `SI-ETIK-BUKTI`.
4. Pastikan secret `FIREBASE_WEB_API_KEY` berisi Web API Key proyek Firebase `si-edkk`.
5. Pastikan secret `GOOGLE_SERVICE_ACCOUNT_JSON` berisi seluruh JSON Service Account backend.
6. Service Account harus memiliki izin Firestore (Cloud Datastore User) dan pengelolaan Firebase Authentication (Firebase Authentication Admin); aktifkan Identity Toolkit API pada proyek Google Cloud.
7. Deploy Worker, lalu buka `/health`. Respons harus menunjukkan `status: ok`, `firestore: connected`, dan `photoStorage: configured`.

File `cloudflare/wrangler.toml` adalah contoh konfigurasi Wrangler. Isi ID KV yang benar sebelum menggunakannya; jangan deploy dengan placeholder.

## Deploy Firestore Rules
Dari root folder proyek, jalankan hanya setelah memeriksa proyek Firebase yang aktif:
```bash
firebase use si-edkk
firebase deploy --only firestore:rules,firestore:indexes
```
Tidak ada perintah deploy Functions pada rilis ini.

## Endpoint Worker utama
- Publik: `POST /public-report` (dibatasi 5 kiriman per IP per 10 menit melalui KV).
- Autentikasi: `POST /auth-check`.
- Laporan: `GET /reports`, `GET /report`, `POST /internal-report`, `POST /delete-report`.
- Kasus: `GET /cases`, `GET /case`, `POST /convert-report`, `POST /case-status`.
- Bukti: `POST /upload-evidence`, `GET /evidence`.
- Dokumen: `GET/POST /documents`.
- Program dan evaluasi: `GET/POST /programs`, `GET/POST /evaluations`.
- Akun: `GET /managed-users`, `POST /create-user`, `POST /set-user-role`, `POST /set-user-active`.

Semua endpoint privat memverifikasi Firebase ID token dan role di backend. Jangan membuka akses tulis langsung ke koleksi Firestore dari browser.

## Catatan batasan
- Dokumen dibatasi 4 MB per file; bukti foto mengikuti batas 3 foto per laporan dan 1,5 MB per foto.
- Daftar data yang dimuat UI dibatasi sesuai endpoint (umumnya 100–500 data terbaru).
- Pembatasan formulir publik berbasis IP/KV merupakan mitigasi dasar, bukan pengganti CAPTCHA/WAF untuk layanan publik berskala besar.
- Pemeriksaan sintaks lokal tidak membuktikan integrasi live. Lakukan uji akun Admin/User, submit publik/internal, CRUD dokumen/program/evaluasi, pembuatan akun, perubahan role/status, bukti foto, dan audit log pada data uji sebelum go-live.

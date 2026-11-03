# SI-EDKK — UPTD RSUD Kelas D Pondokgede

Sistem Informasi Etik dan Disiplin Komite Keperawatan. Paket ini adalah **source release untuk konfigurasi dan uji penerimaan**, bukan instalasi produksi yang sudah terhubung ke proyek Firebase rumah sakit.

## Isi aplikasi
- Dashboard ringkasan.
- Formulir pelaporan publik: anonim/teridentifikasi, etik/disiplin.
- Pelaporan internal.
- Manajemen kasus dan database kasus.
- Repositori dokumen & akreditasi (daftar metadata).
- Monitoring & evaluasi (ringkasan awal).
- Program & kegiatan (daftar program).
- Pengaturan akun dasar.
- PWA responsif, tema terang/gelap.
- Firestore Rules, Storage Rules, indexes, Cloud Functions, Firebase CLI config.

## Struktur utama
```text
index.html
pelaporan.html
manifest.json
sw.js
firebase.json
.firebaserc
firestore.rules
firestore.indexes.json
storage.rules
assets/css/main.css
assets/js/{firebase,auth,ui,modules,app,public-report}.js
assets/images/
functions/
```

## 1. Buat proyek Firebase
1. Buat proyek Firebase baru khusus SI-EDKK (jangan gunakan proyek MEDIX).
2. Pilih lokasi Firestore/Storage yang sesuai kebutuhan tata kelola organisasi. Lokasi layanan Functions pada source ini `asia-southeast2` (Jakarta).
3. Aktifkan Authentication > Sign-in method > Email/Password.
4. Buat Firestore Database dan Storage.
5. Daftarkan aplikasi Web di Project settings dan salin konfigurasi web ke `assets/js/firebase.js`.
6. Ganti `GANTI_DENGAN_PROJECT_ID_FIREBASE` pada `.firebaserc`.

**Jangan pernah menaruh service-account JSON, private key, atau kredensial admin di folder hosting/browser.** Firebase web config bukan rahasia; proteksi data dilakukan oleh Authentication, Rules, Functions, App Check, dan tata kelola akun.

## 2. Bootstrap akun administrator
Buat user pertama melalui Firebase Authentication > Add user. Setelah itu buat dokumen Firestore `users/{UID}` secara manual melalui Firebase Console dengan field:
```json
{
  "nama": "Administrator SI-EDKK",
  "email": "admin@contoh.go.id",
  "role": "Admin",
  "aktif": true,
  "unit": "Komite Keperawatan",
  "createdAt": "gunakan Firestore timestamp"
}
```
Ganti UID/email dengan akun resmi. Batasi akses Firebase Console hanya kepada administrator teknis yang ditunjuk. Jangan memberikan role Admin kepada akun operasional biasa.

## 3. Instalasi dan deployment
Gunakan Node.js 22, npm, dan Firebase CLI:
```bash
npm install -g firebase-tools
firebase login
firebase use --add
```
Di root proyek:
```bash
cd functions
npm install
cd ..
firebase deploy --only firestore:rules,firestore:indexes,storage
firebase deploy --only functions
firebase deploy --only hosting
```
Untuk GitHub Pages: atur repository Pages ke branch/folder yang berisi source. Karena Functions/Firestore/Storage tetap berjalan di Firebase, domain GitHub Pages hanya menyajikan frontend. Pastikan URL hosting masuk ke daftar Authorized domains pada Firebase Authentication.

## 4. Skema data awal
- `users/{uid}`: nama, email, role, aktif, unit.
- `reports/{id}`: nomor, jenis, unit, tanggalKejadian, uraian, reporterMode, status, createdBy, createdAt.
- `cases/{id}`: nomor, reportId, jenis, unit, tanggalKejadian, uraian, status, assignedUids, createdAt.
- `documents/{id}`: nama, kategori, nomor/versi, storagePath, updatedAt.
- `programs/{id}`: nama, periode, pic, status, createdAt.
- `activities/{id}`: metadata kegiatan/rapat.
- `evaluations/{id}`: indikator, periode, target, realisasi, tindak lanjut.
- `auditLogs/{id}`: actorUid, action, target, details, createdAt.
- `counters/{id}`: penghitung nomor otomatis. Akses hanya backend.

## 5. Role awal
| Role | Akses awal |
|---|---|
| Admin | Pengelolaan akun dan akses administratif |
| Ketua Komite | Telaah, penugasan, keputusan/status kasus |
| Sekretaris | Administrasi laporan, kasus, program dan dokumen |
| Anggota Komite | Akses kerja komite sesuai penugasan/aturan |
| Perawat | Pelaporan internal |
| Auditor | Akses dokumen dan kasus yang ditandai dapat diaudit |

Role dan matriks kewenangan wajib disahkan oleh pimpinan/komite sebelum go-live. Rules saat ini sengaja fail-closed untuk mutasi sensitif: operasi tersebut harus lewat Cloud Functions.

## 6. Keamanan dan privasi — wajib sebelum produksi
1. Tinjau alur pelaporan anonim, kebutuhan tindak lanjut, perlindungan pelapor, dan mekanisme penyalahgunaan. Untuk pelaporan anonim, jangan menjanjikan kerahasiaan absolut bila metadata jaringan/operasional masih diproses penyedia layanan.
2. Aktifkan Firebase App Check dan terapkan enforcement setelah pengujian. Callable functions pada source perlu disesuaikan agar App Check diwajibkan sebelum produksi.
3. Terapkan MFA untuk akun dengan akses istimewa, kebijakan kata sandi, prosedur offboarding, dan tinjauan akses berkala.
4. Lakukan uji rules dengan Firebase Emulator Suite: akses lintas unit, user nonaktif, role tidak sah, pembacaan file, dan akses anonim.
5. Tetapkan retensi, legal hold, pemusnahan, backup, pemulihan bencana, klasifikasi data, dan prosedur insiden.
6. Hindari data pasien yang dapat mengidentifikasi individu. Gunakan kode internal bila diperlukan dan pastikan dasar hukum/persetujuan sesuai kebijakan rumah sakit dan UU Pelindungan Data Pribadi.
7. Audit trail harus append-only. Untuk kebutuhan audit yang lebih ketat, pindahkan log ke penyimpanan terpisah dengan retensi dan kontrol administrator khusus.
8. Uji penetrasi dan review oleh tim TI/keamanan informasi serta pejabat yang berwenang sebelum digunakan untuk kasus nyata.

## 7. Batasan rilis ini
- UI dan struktur modul sudah disiapkan, tetapi beberapa modul (unggah dokumen, notulen, berita acara, pemeriksaan terstruktur, penugasan, ekspor PDF/Excel, notifikasi, laporan analitik) masih memerlukan implementasi workflow final dan persetujuan format resmi rumah sakit.
- Fungsi `convertReportToCase` dan `updateCaseStatus` merupakan fondasi backend; perlu uji transaksi dan rules melalui emulator sebelum produksi.
- `setUserRole` menulis role di dokumen user. Dalam lingkungan produksi, pertimbangkan custom claims yang hanya ditetapkan lewat Admin SDK dan sinkronisasi rules yang konsisten.
- Formulir publik saat ini belum memiliki CAPTCHA/App Check enforcement, throttling/rate limit, atau dashboard tracking pelapor. Jangan publikasikan sebelum mitigasi spam dan penilaian privasi selesai.
- Data rahasia tidak disimpan offline. Service worker hanya menyimpan shell aplikasi same-origin, bukan data Firebase.

## 8. PWA dan HTTPS
PWA membutuhkan HTTPS (GitHub Pages menyediakan HTTPS). Setelah deployment, buka situs di Android Chrome/Edge dan pilih Install app / Tambahkan ke layar utama. Perubahan cache shell dapat memerlukan refresh setelah versi service worker dinaikkan.

## 9. Pengujian penerimaan minimum
- Login valid, login nonaktif, logout, session refresh.
- Setiap role hanya melihat data yang diizinkan.
- Laporan anonim dan teridentifikasi masuk dengan nomor unik.
- Laporan tidak dapat dibaca oleh pengguna umum.
- Konversi laporan ke kasus hanya oleh role berwenang.
- Perubahan status tercatat di audit log.
- File tidak dapat diakses melalui URL publik.
- Tidak ada data kasus di Cache Storage/IndexedDB/localStorage.
- Dark mode tidak menyisakan komponen putih yang tidak disengaja.
- Uji backup dan restore.

## Catatan penamaan
Firebase CLI menggunakan nama file **`firestore.indexes.json`** (jamak), bukan `firestore.index.json`.

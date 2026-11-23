# Checklist rilis SI-ETIK

## Konfigurasi dan deployment
- [ ] Pastikan proyek Firebase aktif adalah `si-edkk`.
- [ ] Pastikan Firebase Authentication Email/Password aktif dan Authorized Domains memuat `ftth11.github.io`.
- [ ] Pastikan Firestore database `(default)` berada di `asia-southeast2`.
- [ ] Deploy `firestore.rules` dan `firestore.indexes.json`.
- [ ] Pastikan minimal satu profil `users/{uid}` memiliki `role: "Admin"` dan `aktif: true`.
- [ ] Pastikan Service Account Worker memiliki izin Cloud Datastore User dan Firebase Authentication Admin.
- [ ] Pastikan Identity Toolkit API aktif.
- [ ] Deploy `cloudflare/worker.js` ke Worker `si-etik-api`.
- [ ] Pastikan Worker secret `GOOGLE_SERVICE_ACCOUNT_JSON` dan `FIREBASE_WEB_API_KEY` terpasang.
- [ ] Pastikan KV binding `BUKTI_KV` menunjuk namespace `SI-ETIK-BUKTI`.
- [ ] Pastikan `/health` menunjukkan Firestore dan KV terhubung.
- [ ] Publikasikan frontend melalui GitHub Pages.

## Uji fungsional dengan data uji
- [ ] Login Admin, login User, logout, akun nonaktif, dan role tidak sah.
- [ ] User dapat membuat laporan internal dan hanya melihat laporan miliknya yang teridentifikasi.
- [ ] Admin dapat melihat daftar laporan dan detail kasus.
- [ ] Pengiriman laporan publik menghasilkan nomor referensi dan batas kiriman per IP bekerja.
- [ ] Konversi laporan menjadi kasus tidak dapat dilakukan dua kali.
- [ ] Perubahan status kasus menyimpan catatan, riwayat, dan audit log.
- [ ] Upload, unduh, dan hapus dokumen bekerja; file hanya dapat diakses Admin melalui Worker.
- [ ] Tambah, edit, dan hapus program/kegiatan bekerja.
- [ ] Tambah, edit, dan hapus evaluasi bekerja.
- [ ] Admin dapat membuat akun baru, mengubah role, dan mengaktifkan/nonaktifkan akun.
- [ ] Admin aktif terakhir tidak dapat diturunkan role atau dinonaktifkan.
- [ ] Upload dan pembacaan bukti foto bekerja; User tidak dapat membaca bukti milik laporan orang lain.
- [ ] Uji tampilan desktop/mobile, refresh halaman, dan cache PWA.

## Keamanan dan operasional
- [ ] Jangan pernah commit Service Account JSON/private key ke repository.
- [ ] Pastikan tidak ada Firebase Functions yang di-deploy atau dipanggil oleh frontend.
- [ ] Pastikan Firestore Rules menolak seluruh mutasi browser.
- [ ] Pastikan akun uji dan data uji dihapus/ditandai sebelum operasional.
- [ ] Siapkan prosedur backup, pemulihan, audit, dan penanganan insiden.
- [ ] Dapatkan persetujuan pemilik proses dan lakukan UAT sebelum memasukkan data kasus nyata.

**Catatan:** Source sudah melalui pemeriksaan sintaks lokal. Uji integrasi live tetap wajib karena memerlukan kredensial, izin Service Account, binding KV, dan deployment pada akun Cloudflare/Firebase milik pemilik sistem.

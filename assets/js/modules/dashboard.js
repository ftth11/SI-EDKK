export function renderDashboard(user) {
  return `
  <div class="page-heading"><div><h3>Selamat datang, ${escapeHtml(user.nama || "Pengguna")}</h3><p>Ringkasan aktivitas Komite Keperawatan.</p></div></div>
  <div class="notice">Informasi yang ditampilkan pada dashboard mengikuti kewenangan akun. Data statistik kasus harus dihitung melalui query/backend yang telah menerapkan pembatasan akses.</div>
  <div class="stats-grid" style="margin-top:16px">
    ${stat("Laporan masuk","—","Menunggu integrasi data","▤")}
    ${stat("Dalam pemeriksaan","—","Kasus yang dapat diakses","⌕")}
    ${stat("Menunggu tindak lanjut","—","Rekomendasi terbuka","◷")}
    ${stat("Selesai","—","Periode berjalan","✓")}
  </div>
  <div class="dashboard-grid">
    <section class="panel"><h3>Aktivitas terbaru</h3><p class="panel-sub">Daftar aktivitas yang boleh dilihat akun ini.</p><div class="empty-state">Belum ada data aktivitas.</div></section>
    <section class="panel"><h3>Pengingat</h3><p class="panel-sub">Agenda dan tindak lanjut.</p><div class="empty-state">Belum ada pengingat.</div></section>
  </div>
  <h3 style="font-size:14px;margin:24px 0 0">Akses cepat</h3>
  <div class="quick-grid">
    ${quick("＋","Buat laporan","Pelaporan kasus","reporting")}
    ${quick("▤","Manajemen kasus","Kasus sesuai penugasan","cases")}
    ${quick("▣","Dokumen akreditasi","Regulasi dan bukti","accreditation")}
    ${quick("◷","Monitoring","Evaluasi tindak lanjut","monitoring")}
    ${quick("▦","Program kerja","Rencana dan kegiatan","programs")}
    ${quick("▥","Database","Data referensi","database")}
  </div>`;
}
function stat(title,value,note,icon){return `<article class="stat-card"><div class="stat-top"><span>${title}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></article>`}
function quick(icon,title,desc,page){return `<button class="quick-card" data-go="${page}"><span class="quick-icon">${icon}</span><span><strong>${title}</strong><small>${desc}</small></span></button>`}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

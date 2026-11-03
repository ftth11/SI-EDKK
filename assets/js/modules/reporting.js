export function renderReporting() {
 return `<div class="page-heading"><div><h3>Pelaporan Kasus</h3><p>Formulir penyampaian dugaan kejadian untuk diverifikasi oleh pihak berwenang.</p></div></div>
 <div class="notice">Pengiriman laporan tidak berarti bahwa pelanggaran telah terbukti. Hindari memasukkan data pribadi yang tidak relevan. Form ini merupakan kerangka UI; penyimpanan belum diaktifkan sebelum backend dan aturan akses diuji.</div>
 <section class="panel" style="margin-top:16px;max-width:850px">
  <form id="reportForm">
   <div class="field"><label for="jenis">Jenis dugaan</label><select id="jenis" required><option value="">Pilih jenis</option><option>Etik</option><option>Disiplin</option><option>Belum dapat diklasifikasikan</option></select></div>
   <div class="field"><label for="unit">Unit kerja kejadian</label><select id="unit" required><option value="">Pilih unit kerja</option></select></div>
   <div class="field"><label for="terlapor">Perawat terkait (ID internal)</label><input id="terlapor" required maxlength="80" placeholder="Cari melalui master data perawat"></div>
   <div class="field"><label for="tanggal">Tanggal kejadian</label><input id="tanggal" type="date" required></div>
   <div class="field"><label for="kronologi">Kronologi faktual</label><textarea id="kronologi" required maxlength="10000" placeholder="Tuliskan apa yang diketahui, kapan, di mana, dan sumber informasi..."></textarea></div>
   <div class="field"><label for="lampiran">Lampiran pendukung</label><input id="lampiran" type="file" multiple accept=".pdf,.jpg,.jpeg,.png"></div>
   <label style="display:flex;gap:9px;align-items:flex-start;font-size:11px;margin:16px 0"><input type="checkbox" required> Saya memahami bahwa laporan ini adalah dugaan yang perlu diverifikasi dan akan diproses secara rahasia.</label>
   <button class="btn primary" type="submit">Simpan sebagai draft (demo)</button>
  </form>
 </section>`;
}

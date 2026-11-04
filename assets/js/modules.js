
import { auth, db } from "./firebase.js";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { $, escapeHtml, dateLabel, toast } from "./ui.js";

const API_URL = "https://si-etik-api.baits-ap97.workers.dev";

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 1500000;

const pageTitles = {
  dashboard: "Dashboard",
  pelaporan: "Pelaporan Kasus",
  kasus: "Manajemen Kasus",
  dokumen: "Dokumen & Akreditasi",
  monitoring: "Monitoring & Evaluasi",
  program: "Program & Kegiatan",
  database: "Database Kasus",
  pengaturan: "Pengaturan"
};

const UNIT_OPTIONS = [
  "POLI BEDAH",
  "CSSD",
  "POLI GIGI & MULUT",
  "IGD",
  "POLI OBGYN",
  "OK 1",
  "PERINA",
  "RANAP",
  "RUANG PEMULIHAN",
  "HCU",
  "LABORATORIUM",
  "RADIOLOGI",
  "FARMASI",
  "ICU",
  "OK 2",
  "LAB PCR",
  "POLI TB/PARU",
  "AMBULANCE APV",
  "AMBULANCE HIACE",
  "LAB PK",
  "LAB SAMPLE",
  "POLI ANAK",
  "POLI PENYAKIT DALAM",
  "NICU",
  "IGD PONEK",
  "VK",
  "RUANG RAPAT",
  "POLI UMUM",
  "GUDANG",
  "AULA RAPAT",
  "DINAS KESEHATAN KOTA BEKASI",
  "RUANG MANAGEMENT",
  "POLI JANTUNG",
  "POLI REHAB MEDIK",
  "POLI ANYELIR",
  "POLI THT",
  "POLI SARAF",
  "RUANG DIREKTUR",
  "BANK DARAH",
  "POLI JIWA"
];

export async function renderPage(page, profile) {
  $("#pageTitle").textContent = pageTitles[page] || "Dashboard";

  const host = $("#pageContent");

  if (!db) {
    host.innerHTML = `
      <div class="notice warning">
        <b>Firebase belum dikonfigurasi.</b>
        <p>Periksa konfigurasi assets/js/firebase.js.</p>
      </div>`;
    return;
  }

  try {
    if (page === "dashboard") return await dashboard(host, profile);
    if (page === "pelaporan") return reportPage(host, profile);

    if (page === "kasus" || page === "database") {
      return caseList(host, page === "database");
    }

    if (page === "dokumen") return documents(host);
    if (page === "monitoring") return monitoring(host);
    if (page === "program") return programs(host);
    if (page === "pengaturan") return settings(host, profile);

  } catch (e) {
    console.error(e);

    host.innerHTML = `
      <div class="notice warning">
        Tidak dapat memuat data. ${escapeHtml(e.message)}
      </div>`;
  }
}

async function count(col) {
  const s = await getDocs(
    query(collection(db, col), limit(500))
  );

  return s.size;
}

// =====================================================
// DASHBOARD
// =====================================================

async function dashboard(host, profile) {
  const [cases, docs, programs] = await Promise.all([
    count("cases"),
    count("documents"),
    count("programs")
  ]);

  let reports = "-";

  const committeeRoles = [
    "Admin",
    "Ketua Komite",
    "Sekretaris",
    "Anggota Komite"
  ];

  if (committeeRoles.includes(profile?.role)) {
    try {
      reports = await count("reports");
    } catch (error) {
      console.warn("Jumlah laporan tidak dapat dibaca:", error);
    }
  }

  host.innerHTML = `
    <div class="welcome">
      <div>
        <p class="eyebrow">RINGKASAN KOMITE</p>
        <h1>Selamat datang, ${escapeHtml(
          profile.nama || profile.displayName || "Pengguna"
        )}</h1>
        <p class="muted">
          Pantau pelaporan, penanganan kasus, dan kelengkapan dokumen komite.
        </p>
      </div>
      <span class="welcome-icon">✚</span>
    </div>

    <div class="stats-grid">
      <article class="stat-card">
        <span>Total kasus</span>
        <b>${cases}</b>
        <small>Data yang dapat diakses</small>
      </article>

      <article class="stat-card">
        <span>Laporan masuk</span>
        <b>${reports}</b>
        <small>Data sesuai hak akses</small>
      </article>

      <article class="stat-card">
        <span>Dokumen</span>
        <b>${docs}</b>
        <small>Dokumen komite</small>
      </article>

      <article class="stat-card">
        <span>Program kerja</span>
        <b>${programs}</b>
        <small>Program terdaftar</small>
      </article>
    </div>

    <div class="content-grid">
      <section class="panel">
        <div class="panel-head">
          <h3>Aktivitas terbaru</h3>
          <span class="pill">Terbatas</span>
        </div>

        <p class="muted">
          Buka Manajemen Kasus untuk meninjau kasus yang menjadi kewenangan Anda.
        </p>

        <button class="btn primary" data-goto="kasus">
          Lihat manajemen kasus
        </button>
      </section>

      <section class="panel">
        <h3>Pengingat tata kelola</h3>
        <ul class="clean-list">
          <li>Gunakan data minimum yang diperlukan.</li>
          <li>Hindari mengunggah identitas pasien jika tidak relevan.</li>
          <li>Catat setiap keputusan dan tindak lanjut secara objektif.</li>
        </ul>
      </section>
    </div>`;
}

// =====================================================
// KOMPRESI FOTO
// =====================================================

async function compressPhoto(file) {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (!allowedTypes.includes(file.type)) {
    throw new Error(
      `Format ${file.name} tidak didukung. Gunakan JPG, PNG, atau WebP.`
    );
  }

  if (!file.size) {
    throw new Error(`File ${file.name} kosong.`);
  }

  let bitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      `Foto ${file.name} tidak dapat dibaca. Silakan pilih foto JPG, PNG, atau WebP.`
    );
  }

  try {
    let width = bitmap.width;
    let height = bitmap.height;

    const maxDimension = 1600;

    if (width > maxDimension || height > maxDimension) {
      const ratio = Math.min(
        maxDimension / width,
        maxDimension / height
      );

      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Browser tidak mendukung pemrosesan foto.");
    }

    let resultBlob = null;

    for (let attempt = 0; attempt < 12; attempt++) {
      canvas.width = width;
      canvas.height = height;

      context.clearRect(0, 0, width, height);

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);

      context.drawImage(bitmap, 0, 0, width, height);

      const quality = Math.max(
        0.42,
        0.82 - (attempt % 5) * 0.09
      );

      resultBlob = await new Promise(resolve => {
        canvas.toBlob(resolve, "image/jpeg", quality);
      });

      if (
        resultBlob &&
        resultBlob.size <= MAX_PHOTO_BYTES
      ) {
        break;
      }

      if (attempt % 5 === 4) {
        width = Math.round(width * 0.8);
        height = Math.round(height * 0.8);
      }
    }

    if (!resultBlob || resultBlob.size > MAX_PHOTO_BYTES) {
      throw new Error(
        `Foto ${file.name} masih terlalu besar setelah dikompres.`
      );
    }

    const safeName = file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    return new File(
      [resultBlob],
      `${safeName || "bukti"}.jpg`,
      {
        type: "image/jpeg",
        lastModified: Date.now()
      }
    );

  } finally {
    bitmap.close();
  }
}

// =====================================================
// PELAPORAN INTERNAL + FOTO BUKTI
// =====================================================

function reportPage(host, profile) {
  const unitOptions = UNIT_OPTIONS.map(unit => `
    <option value="${escapeHtml(unit)}">
      ${escapeHtml(unit)}
    </option>
  `).join("");

  host.innerHTML = `
    <div class="page-intro">
      <div>
        <h1>Pelaporan Kasus</h1>
        <p class="muted">
          Buat laporan internal yang akan ditinjau petugas komite.
        </p>
      </div>
    </div>

    <section class="panel">
      <form id="internalReport" class="form-grid">

        <label>
          Jenis laporan
          <select name="jenis" required>
            <option value="Etik">Etik</option>
            <option value="Disiplin">Disiplin</option>
            <option value="Etik dan Disiplin">
              Etik dan Disiplin
            </option>
          </select>
        </label>

        <label>
          Unit/lokasi
          <select name="unit" required>
            <option value="">Pilih unit/lokasi</option>
            ${unitOptions}
          </select>
        </label>

        <label>
          Tanggal kejadian
          <input
            name="tanggalKejadian"
            type="date"
            required
          >
        </label>

        <label>
          Nama pelapor
          <input
            name="namaPelapor"
            value="${escapeHtml(profile?.nama || "")}"
            maxlength="120"
            required
          >
        </label>

        <label>
          Kontak pelapor
          <input
            name="kontakPelapor"
            maxlength="160"
            placeholder="Nomor telepon atau email (opsional)"
          >
        </label>

        <label class="full">
          Uraian kejadian
          <textarea
            name="uraian"
            required
            minlength="20"
            maxlength="6000"
            rows="5"
            placeholder="Jelaskan kronologi kejadian secara objektif dan lengkap..."
          ></textarea>
        </label>

        <div class="full evidence-input-area">
          <label for="evidenceFiles">
            Foto bukti kejadian
          </label>

          <p class="muted tiny">
            Pilih maksimal 3 foto. Foto akan dikompres otomatis
            sebelum dikirim. Format JPG, PNG, atau WebP.
          </p>

          <input
            id="evidenceFiles"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
          >

          <div
            id="evidencePreview"
            class="evidence-preview"
          ></div>

          <p class="tiny muted" id="evidenceInfo">
            Belum ada foto dipilih.
          </p>
        </div>

        <button
          class="btn primary"
          id="submitInternalReport"
          type="submit"
        >
          Kirim laporan
        </button>

        <p
          id="formMessage"
          class="muted full"
          role="status"
          aria-live="polite"
        ></p>

      </form>
    </section>`;

  const form = $("#internalReport");
  const button = $("#submitInternalReport");
  const message = $("#formMessage");
  const fileInput = $("#evidenceFiles");
  const preview = $("#evidencePreview");
  const evidenceInfo = $("#evidenceInfo");

  let selectedPhotos = [];

  // Jika laporan sudah tersimpan tetapi unggah foto gagal,
  // proses berikutnya melanjutkan unggah tanpa membuat laporan baru.
  let pendingReportId = null;
  let pendingReportNumber = null;

  function revokePhotoUrls() {
    selectedPhotos.forEach(photo => {
      URL.revokeObjectURL(photo.previewUrl);
    });
  }

  function renderPhotoPreview() {
    preview.innerHTML = selectedPhotos.map((photo, index) => `
      <div class="evidence-preview-item">
        <img
          src="${photo.previewUrl}"
          alt="Pratinjau foto bukti ${index + 1}"
          loading="lazy"
        >

        <button
          type="button"
          class="evidence-remove"
          data-remove-photo="${index}"
          aria-label="Hapus foto ${index + 1}"
          ${pendingReportId ? "disabled" : ""}
        >
          ×
        </button>

        <small>
          Foto ${index + 1}
        </small>
      </div>
    `).join("");

    const totalSize = selectedPhotos.reduce(
      (sum, photo) => sum + photo.file.size,
      0
    );

    evidenceInfo.textContent = selectedPhotos.length
      ? `${selectedPhotos.length} foto dipilih • ${formatBytes(totalSize)}`
      : "Belum ada foto dipilih.";
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(0)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  fileInput.addEventListener("change", async () => {
    if (pendingReportId) {
      toast(
        "Selesaikan unggah bukti laporan sebelumnya terlebih dahulu.",
        "warning"
      );

      fileInput.value = "";
      return;
    }

    const files = Array.from(fileInput.files || []);

    if (!files.length) return;

    if (selectedPhotos.length + files.length > MAX_PHOTOS) {
      toast("Maksimal 3 foto untuk satu laporan.", "error");
      fileInput.value = "";
      return;
    }

    fileInput.disabled = true;
    evidenceInfo.textContent = "Sedang memproses dan mengompres foto...";

    try {
      for (const file of files) {
        const compressed = await compressPhoto(file);

        const previewUrl = URL.createObjectURL(compressed);

        selectedPhotos.push({
          file: compressed,
          previewUrl
        });
      }

      renderPhotoPreview();

    } catch (error) {
      toast(error.message, "error");

    } finally {
      fileInput.disabled = false;
      fileInput.value = "";
    }
  });

  preview.addEventListener("click", event => {
    const button = event.target.closest("[data-remove-photo]");

    if (!button || pendingReportId) return;

    const index = Number(button.dataset.removePhoto);

    if (!Number.isInteger(index) || !selectedPhotos[index]) {
      return;
    }

    URL.revokeObjectURL(selectedPhotos[index].previewUrl);
    selectedPhotos.splice(index, 1);

    renderPhotoPreview();
  });

  async function uploadPendingPhotos(token) {
    if (!pendingReportId) return;

    const total = selectedPhotos.length;

    for (let index = 0; index < total; index++) {
      const photo = selectedPhotos[0];

      message.textContent =
        `Mengunggah foto ${index + 1} dari ${total}...`;

      const uploadForm = new FormData();

      uploadForm.append("reportId", pendingReportId);
      uploadForm.append("file", photo.file, photo.file.name);

      const response = await fetch(`${API_URL}/upload-evidence`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: uploadForm
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
          `Foto ${index + 1} gagal diunggah.`
        );
      }

      URL.revokeObjectURL(photo.previewUrl);
      selectedPhotos.shift();

      renderPhotoPreview();
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (!auth?.currentUser) {
      message.textContent =
        "Sesi login berakhir. Silakan login kembali.";

      toast("Silakan login kembali.", "error");
      return;
    }

    if (!pendingReportId && !form.reportValidity()) {
      return;
    }

    button.disabled = true;
    fileInput.disabled = true;

    try {
      const token = await auth.currentUser.getIdToken(true);

      // Buat laporan hanya jika belum pernah berhasil dibuat.
      if (!pendingReportId) {
        const data = Object.fromEntries(new FormData(form));

        button.textContent = "Menyimpan laporan...";
        message.textContent =
          "Sedang menyimpan laporan. Mohon tunggu.";

        const response = await fetch(`${API_URL}/internal-report`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(data)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success) {
          throw new Error(
            result.error || "Laporan gagal dikirim."
          );
        }

        pendingReportId = result.reportId;
        pendingReportNumber = result.nomor;
      }

      // Lanjutkan unggah foto jika ada.
      if (selectedPhotos.length > 0) {
        button.textContent = "Mengunggah foto...";
        await uploadPendingPhotos(token);
      }

      const nomor = pendingReportNumber;

      message.textContent =
        `Laporan ${nomor} berhasil dikirim` +
        (selectedPhotos.length ? "." : " beserta bukti foto.");

      toast("Laporan dan bukti berhasil disimpan.", "success");

      revokePhotoUrls();
      selectedPhotos = [];

      pendingReportId = null;
      pendingReportNumber = null;

      form.reset();

      form.querySelector('[name="namaPelapor"]').value =
        profile?.nama || "";

      renderPhotoPreview();

      button.textContent = "Kirim laporan";

    } catch (error) {
      console.error("Internal report:", error);

      if (pendingReportId) {
        message.textContent =
          `Laporan ${pendingReportNumber} sudah tersimpan, ` +
          `tetapi unggah foto belum selesai. ` +
          `Tekan tombol di bawah untuk melanjutkan unggah foto.`;

        button.textContent = "Lanjutkan unggah bukti";

        toast(
          error.message || "Unggah foto belum selesai.",
          "warning"
        );

      } else {
        message.textContent =
          error.message || "Terjadi kesalahan saat mengirim laporan.";

        button.textContent = "Kirim laporan";

        toast(message.textContent, "error");
      }

    } finally {
      button.disabled = false;
      fileInput.disabled = false;
    }
  });

  renderPhotoPreview();
}

// =====================================================
// MANAJEMEN KASUS
// =====================================================

async function caseList(host, database = false) {
  const snap = await getDocs(
    query(
      collection(db, "cases"),
      orderBy("createdAt", "desc"),
      limit(100)
    )
  );

  const rows = snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));

  host.innerHTML = `
    <div class="page-intro">
      <div>
        <h1>${database ? "Database Kasus" : "Manajemen Kasus"}</h1>
        <p class="muted">
          Daftar kasus sesuai hak akses akun Anda. Maksimal 100 data terbaru.
        </p>
      </div>

      <button class="btn subtle" id="refreshBtn">
        Muat ulang
      </button>
    </div>

    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nomor</th>
              <th>Jenis</th>
              <th>Unit</th>
              <th>Tanggal</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            ${rows.map(r => `
              <tr>
                <td><b>${escapeHtml(r.nomor || "-")}</b></td>
                <td>${escapeHtml(r.jenis || "-")}</td>
                <td>${escapeHtml(r.unit || "-")}</td>
                <td>${dateLabel(r.tanggalKejadian)}</td>
                <td>
                  <span class="status">
                    ${escapeHtml(r.status || "Baru")}
                  </span>
                </td>
                <td>
                  <button
                    class="text-btn"
                    data-case="${escapeHtml(r.id)}"
                  >
                    Detail
                  </button>
                </td>
              </tr>
            `).join("") || `
              <tr>
                <td colspan="6" class="empty">
                  Belum ada kasus yang dapat ditampilkan.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </section>`;

  $("#refreshBtn").onclick = () =>
    renderPage(
      database ? "database" : "kasus",
      window.currentProfile
    );

  host.querySelectorAll("[data-case]").forEach(button => {
    button.onclick = () => showCase(button.dataset.case);
  });
}

async function showCase(id) {
  const s = await getDoc(doc(db, "cases", id));

  if (!s.exists()) return;

  const d = s.data();

  const html = `
    <div class="modal-backdrop" id="caseModal">
      <section class="modal">
        <button class="modal-close" id="closeModal">×</button>

        <p class="eyebrow">DETAIL KASUS</p>
        <h2>${escapeHtml(d.nomor || "Kasus")}</h2>

        <dl class="detail-list">
          <dt>Jenis</dt>
          <dd>${escapeHtml(d.jenis || "-")}</dd>

          <dt>Unit</dt>
          <dd>${escapeHtml(d.unit || "-")}</dd>

          <dt>Tanggal kejadian</dt>
          <dd>${dateLabel(d.tanggalKejadian)}</dd>

          <dt>Status</dt>
          <dd>${escapeHtml(d.status || "-")}</dd>

          <dt>Uraian</dt>
          <dd>${escapeHtml(d.uraian || "-")}</dd>
        </dl>

        <p class="tiny muted">
          Perubahan status, penugasan, dan catatan pemeriksaan dilakukan
          melalui fungsi backend yang memiliki audit trail.
        </p>
      </section>
    </div>`;

  document.body.insertAdjacentHTML("beforeend", html);

  $("#closeModal").onclick = () => $("#caseModal").remove();

  $("#caseModal").onclick = event => {
    if (event.target.id === "caseModal") {
      event.currentTarget.remove();
    }
  };
}

// =====================================================
// DOKUMEN
// =====================================================

async function documents(host) {
  const snap = await getDocs(
    query(
      collection(db, "documents"),
      orderBy("updatedAt", "desc"),
      limit(100)
    )
  );

  host.innerHTML = `
    <div class="page-intro">
      <div>
        <h1>Dokumen & Akreditasi</h1>
        <p class="muted">
          Repositori dokumen komite yang dapat diakses berdasarkan peran.
        </p>
      </div>
    </div>

    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nama dokumen</th>
              <th>Kategori</th>
              <th>Nomor/versi</th>
              <th>Pembaruan</th>
            </tr>
          </thead>

          <tbody>
            ${snap.docs.map(x => {
              const d = x.data();

              return `
                <tr>
                  <td>${escapeHtml(d.nama || "-")}</td>
                  <td>${escapeHtml(d.kategori || "-")}</td>
                  <td>${escapeHtml(d.nomor || d.versi || "-")}</td>
                  <td>${dateLabel(d.updatedAt)}</td>
                </tr>`;
            }).join("") || `
              <tr>
                <td colspan="4" class="empty">
                  Belum ada dokumen.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>

      <p class="tiny muted">
        Pengunggahan dokumen versi produksi perlu dilakukan melalui
        alur backend terotorisasi.
      </p>
    </section>`;
}

// =====================================================
// MONITORING
// =====================================================

async function monitoring(host) {
  const [cases, evals] = await Promise.all([
    count("cases"),
    count("evaluations")
  ]);

  host.innerHTML = `
    <div class="page-intro">
      <div>
        <h1>Monitoring & Evaluasi</h1>
        <p class="muted">
          Ringkasan indikator berdasarkan data yang dapat diakses.
        </p>
      </div>
    </div>

    <div class="stats-grid">
      <article class="stat-card">
        <span>Kasus tercatat</span>
        <b>${cases}</b>
      </article>

      <article class="stat-card">
        <span>Evaluasi</span>
        <b>${evals}</b>
      </article>
    </div>

    <section class="panel">
      <h3>Indikator evaluasi</h3>
      <p class="muted">
        Definisikan indikator, target, periode, sumber data,
        dan penanggung jawab bersama Komite Keperawatan.
      </p>
    </section>`;
}

// =====================================================
// PROGRAM & KEGIATAN
// =====================================================

async function programs(host) {
  const snap = await getDocs(
    query(
      collection(db, "programs"),
      orderBy("createdAt", "desc"),
      limit(100)
    )
  );

  host.innerHTML = `
    <div class="page-intro">
      <div>
        <h1>Program & Kegiatan</h1>
        <p class="muted">
          Program kerja, rapat, sosialisasi, dan kegiatan komite.
        </p>
      </div>

      <button class="btn primary" id="addProgram">
        Tambah program
      </button>
    </div>

    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Program/kegiatan</th>
              <th>Periode</th>
              <th>Penanggung jawab</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            ${snap.docs.map(x => {
              const d = x.data();

              return `
                <tr>
                  <td>${escapeHtml(d.nama || "-")}</td>
                  <td>${escapeHtml(d.periode || "-")}</td>
                  <td>${escapeHtml(d.pic || "-")}</td>
                  <td>${escapeHtml(d.status || "-")}</td>
                </tr>`;
            }).join("") || `
              <tr>
                <td colspan="4" class="empty">
                  Belum ada program kerja.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </section>`;

  $("#addProgram").onclick = () =>
    toast(
      "Pembuatan program melalui form backend akan diaktifkan setelah workflow disahkan.",
      "info"
    );
}

// =====================================================
// PENGATURAN
// =====================================================

async function settings(host, profile) {
  host.innerHTML = `
    <div class="page-intro">
      <div>
        <h1>Pengaturan</h1>
        <p class="muted">
          Informasi akun dan tata kelola sistem.
        </p>
      </div>
    </div>

    <section class="panel">
      <h3>Profil akun</h3>

      <dl class="detail-list">
        <dt>Nama</dt>
        <dd>${escapeHtml(profile.nama || "-")}</dd>

        <dt>Email</dt>
        <dd>${escapeHtml(profile.email || "-")}</dd>

        <dt>Role</dt>
        <dd>${escapeHtml(profile.role || "-")}</dd>

        <dt>Status</dt>
        <dd>${profile.aktif === true ? "Aktif" : "Nonaktif"}</dd>
      </dl>
    </section>

    <section class="panel">
      <h3>Catatan administrator</h3>
      <p class="muted">
        Pembuatan akun, penetapan role, dan aktivasi akun wajib dilakukan
        administrator melalui prosedur backend yang aman.
      </p>
    </section>`;
}

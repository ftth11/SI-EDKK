import { auth, db } from "./firebase.js";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  doc,
  getDoc,
  where
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { $, escapeHtml, dateLabel, toast } from "./ui.js";

const API_URL = "https://si-etik-api.baits-ap97.workers.dev";

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 1500000;

const pageTitles = {
  dashboard: "Dashboard",
  pelaporan: "Pelaporan Kasus",
  laporan: "Daftar Laporan",
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
    if (page === "laporan") return reportListPage(host, profile);

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

  if (normalizeRole(profile?.role) === "Admin") {
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

                <div class="full">
          <h3>Identitas pihak yang dilaporkan</h3>
          <p class="muted tiny">
            Isi identitas pihak yang dilaporkan jika diketahui.
            Kedua kolom berikut bersifat opsional.
          </p>
        </div>

        <label>
          Nama terlapor
          <input
            name="namaTerlapor"
            maxlength="120"
            placeholder="Masukkan nama pihak yang dilaporkan (opsional)"
          >
        </label>

        <label>
          Jabatan/unit terlapor
          <input
            name="jabatanTerlapor"
            maxlength="160"
            placeholder="Masukkan jabatan atau unit kerja (opsional)"
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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// =====================================================
// DAFTAR LAPORAN ADMIN / KOMITE
// =====================================================

const ROLE_MAP = {
  "Admin": "Admin",
  "Ketua Komite": "Admin",
  "Sekretaris": "Admin",
  "Anggota Komite": "User",
  "Perawat": "User",
  "Auditor": "User"
};

function normalizeRole(role) {
  return ROLE_MAP[role] || null;
}

async function getActiveRole() {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    return null;
  }

  try {
    const userSnap = await getDoc(
      doc(db, "users", currentUser.uid)
    );

    if (!userSnap.exists()) {
      return null;
    }

    const userData = userSnap.data();

    if (userData.aktif !== true) {
      return null;
    }

    return normalizeRole(userData.role);
  } catch (error) {
    console.error("Gagal memeriksa role akun:", error);
    return null;
  }
}

const COMMITTEE_ROLES = ["Admin", "User"];
const CASE_CONVERT_ROLES = ["Admin"];

async function reportApi(path, options = {}) {
  if (!auth?.currentUser) {
    throw new Error("Sesi login berakhir. Silakan login kembali.");
  }

  const token = await auth.currentUser.getIdToken();

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${token}`,
      ...options.headers
    }
  });

  if (!response.ok && options.method === "GET" &&
      path.startsWith("/evidence?")) {
    throw new Error("Bukti foto tidak dapat dibuka atau akses ditolak.");
  }

  const contentType = response.headers.get("Content-Type") || "";

  if (contentType.startsWith("image/")) {
    if (!response.ok) {
      throw new Error("Gagal mengambil foto bukti.");
    }

    return await response.blob();
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.success === false) {
    throw new Error(result.error || "Permintaan ke server gagal.");
  }

  return result;
}

function reportListPage(host, profile) {
  const currentRole = normalizeRole(profile?.role);
  
  if (!["Admin", "User"].includes(currentRole)) {
    host.innerHTML = `
      <div class="notice warning">
        Anda tidak memiliki hak akses untuk melihat daftar laporan.
      </div>`;
    return;
  }

  host.innerHTML = `
    <div class="page-intro">
      <div>
        <h1>Daftar Laporan</h1>
        <p class="muted">
          Tinjau laporan masuk sebelum diproses menjadi kasus.
        </p>
      </div>

      <button class="btn subtle" id="refreshReports">
        ↻ Muat ulang
      </button>
    </div>

    <div class="stats-grid">
      <article class="stat-card">
        <span>Total ditampilkan</span>
        <b id="reportTotal">0</b>
        <small>Maksimal 50 laporan terbaru</small>
      </article>

      <article class="stat-card">
        <span>Belum ditinjau</span>
        <b id="reportNew">0</b>
        <small>Status Baru</small>
      </article>

      <article class="stat-card">
        <span>Sudah dikonversi</span>
        <b id="reportConverted">0</b>
        <small>Menjadi kasus</small>
      </article>
    </div>

    <section class="panel">
      <div class="panel-head">
        <h3>Filter laporan</h3>
      </div>

      <div class="form-grid report-filter-grid">
        <label>
          Cari laporan
          <input
            type="search"
            id="reportSearch"
            placeholder="Nomor atau nama pelapor..."
          >
        </label>

        <label>
          Unit/lokasi
          <select id="reportUnitFilter">
            <option value="">Semua unit</option>
            ${UNIT_OPTIONS.map(unit => `
              <option value="${escapeHtml(unit)}">
                ${escapeHtml(unit)}
              </option>
            `).join("")}
          </select>
        </label>

        <label>
          Status
          <select id="reportStatusFilter">
            <option value="">Semua status</option>
            <option value="Baru">Baru</option>
            <option value="Dikonversi">Dikonversi</option>
          </select>
        </label>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h3>Laporan masuk</h3>
        <span class="pill" id="reportResultCount">0 laporan</span>
      </div>

      <div id="reportTableContainer">
        <div class="empty">Memuat daftar laporan...</div>
      </div>
    </section>

    <div id="reportDetailContainer"></div>
  `;

  const searchInput = $("#reportSearch");
  const unitFilter = $("#reportUnitFilter");
  const statusFilter = $("#reportStatusFilter");
  const tableContainer = $("#reportTableContainer");
  const detailContainer = $("#reportDetailContainer");

  let reports = [];
  let activePhotoUrls = [];

  function cleanupPhotoUrls() {
    activePhotoUrls.forEach(url => URL.revokeObjectURL(url));
    activePhotoUrls = [];
  }

  function renderRows() {
    const keyword = searchInput.value.trim().toLowerCase();
    const unit = unitFilter.value;
    const status = statusFilter.value;

    const filtered = reports.filter(report => {
      const matchesKeyword =
        !keyword ||
        String(report.nomor || "").toLowerCase().includes(keyword) ||
        String(report.namaPelapor || "").toLowerCase().includes(keyword);

      const matchesUnit = !unit || report.unit === unit;
      const matchesStatus = !status || report.status === status;

      return matchesKeyword && matchesUnit && matchesStatus;
    });

    $("#reportResultCount").textContent =
      `${filtered.length} laporan`;

    tableContainer.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nomor laporan</th>
              <th>Tanggal kejadian</th>
              <th>Jenis</th>
              <th>Unit</th>
              <th>Pelapor</th>
              <th>Bukti</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>

          <tbody>
            ${filtered.map(report => `
              <tr>
                <td>
                  <b>${escapeHtml(report.nomor || "-")}</b>
                </td>

                <td>${dateLabel(report.tanggalKejadian)}</td>

                <td>${escapeHtml(report.jenis || "-")}</td>

                <td>${escapeHtml(report.unit || "-")}</td>

                <td>${escapeHtml(report.namaPelapor || "-")}</td>

                <td>
                  ${Number(report.evidenceCount) > 0
                    ? `<span class="status">${Number(report.evidenceCount)} foto</span>`
                    : `<span class="muted">Tidak ada</span>`
                  }
                </td>

                <td>
                  <span class="status">
                    ${escapeHtml(report.status || "Baru")}
                  </span>
                </td>

                <td>
                  <button
                    class="text-btn"
                    data-report-detail="${escapeHtml(report.reportId)}"
                  >
                    Detail
                  </button>
                </td>
              </tr>
            `).join("") || `
              <tr>
                <td colspan="8" class="empty">
                  Tidak ada laporan yang sesuai dengan filter.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    `;

    tableContainer.querySelectorAll("[data-report-detail]").forEach(button => {
      button.addEventListener("click", () => {
        openReportDetail(button.dataset.reportDetail);
      });
    });
  }

  async function loadReports() {
    tableContainer.innerHTML = `
      <div class="empty">Mengambil data laporan dari server...</div>
    `;

    detailContainer.innerHTML = "";
    cleanupPhotoUrls();

    try {
      const result = await reportApi("/reports?pageSize=50");

      reports = Array.isArray(result.reports)
        ? result.reports
        : [];

      $("#reportTotal").textContent = reports.length;

      $("#reportNew").textContent = reports.filter(
        report => report.status === "Baru"
      ).length;

      $("#reportConverted").textContent = reports.filter(
        report => report.status === "Dikonversi"
      ).length;

      renderRows();

      if (result.nextPageToken) {
        tableContainer.insertAdjacentHTML(
          "beforeend",
          `<p class="tiny muted">
            Masih terdapat laporan sebelumnya. Tampilan saat ini
            menunjukkan 50 laporan terbaru.
          </p>`
        );
      }

    } catch (error) {
      console.error("Daftar laporan:", error);

      tableContainer.innerHTML = `
        <div class="notice warning">
          <b>Daftar laporan tidak dapat dimuat.</b>
          <p>${escapeHtml(error.message)}</p>
          <button class="btn subtle" id="retryReports">
            Coba lagi
          </button>
        </div>
      `;

      $("#retryReports").onclick = loadReports;
    }
  }

  async function openReportDetail(reportId) {
    detailContainer.innerHTML = `
      <section class="panel">
        <p class="muted">Memuat detail laporan...</p>
      </section>
    `;

    cleanupPhotoUrls();

    try {
      const result = await reportApi(
        `/report?reportId=${encodeURIComponent(reportId)}`
      );

      const report = result.report;

      if (!report) {
        throw new Error("Data laporan tidak ditemukan.");
      }

      const canConvert =
        normalizeRole(profile?.role) === "Admin" &&
        report.status === "Baru";
      
      const photos = Array.isArray(report.evidence)
        ? report.evidence
        : [];

      detailContainer.innerHTML = `
        <section class="panel report-detail-panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">DETAIL LAPORAN</p>
              <h2>${escapeHtml(report.nomor || "-")}</h2>
            </div>

            <button class="btn subtle" id="closeReportDetail">
              Tutup
            </button>
          </div>

          <dl class="detail-list">
            <dt>Jenis laporan</dt>
            <dd>${escapeHtml(report.jenis || "-")}</dd>

            <dt>Unit/lokasi</dt>
            <dd>${escapeHtml(report.unit || "-")}</dd>

            <dt>Tanggal kejadian</dt>
            <dd>${dateLabel(report.tanggalKejadian)}</dd>

            <dt>Nama pelapor</dt>
            <dd>${escapeHtml(report.namaPelapor || "-")}</dd>

            <dt>Kontak pelapor</dt>
            <dd>${escapeHtml(report.kontakPelapor || "-")}</dd>

            <dt>Status</dt>
            <dd>${escapeHtml(report.status || "-")}</dd>

            <dt>Tanggal laporan</dt>
            <dd>${dateLabel(report.createdAt)}</dd>

            <dt>Uraian kejadian</dt>
            <dd class="report-description">
              ${escapeHtml(report.uraian || "-")}
            </dd>
          </dl>

          <div class="report-evidence-section">
            <h3>Bukti foto (${photos.length})</h3>
            <div id="reportPhotoGallery" class="evidence-preview">
              ${photos.length
                ? `<p class="muted">Mengambil foto bukti secara aman...</p>`
                : `<p class="muted">Tidak ada foto bukti.</p>`
              }
            </div>
          </div>

          ${report.caseId ? `
            <p class="notice">
              Laporan ini sudah dikonversi menjadi kasus.
              ID kasus: ${escapeHtml(report.caseId)}
            </p>
          ` : ""}

          ${canConvert ? `
            <div class="report-action-area">
              <button class="btn primary" id="convertReportButton">
                Konversi menjadi kasus
              </button>
              <p class="tiny muted">
                Konversi akan membuat nomor kasus baru dan mencatat
                tindakan pada audit log.
              </p>
            </div>
          ` : ""}
        </section>
      `;

      $("#closeReportDetail").onclick = () => {
        cleanupPhotoUrls();
        detailContainer.innerHTML = "";
      };

      if (photos.length) {
        const gallery = $("#reportPhotoGallery");

        gallery.innerHTML = "";

        for (const photo of photos) {
          const card = document.createElement("div");
          card.className = "evidence-preview-item";
          card.innerHTML = `
            <div class="evidence-photo-loading">Memuat foto...</div>
            <small>${escapeHtml(formatBytes(photo.size || 0))}</small>
          `;
          gallery.appendChild(card);

          try {
            const blob = await reportApi(
              `/evidence?reportId=${encodeURIComponent(reportId)}&evidenceId=${encodeURIComponent(photo.id)}`
            );

            const objectUrl = URL.createObjectURL(blob);
            activePhotoUrls.push(objectUrl);

            const img = document.createElement("img");
            img.src = objectUrl;
            img.alt = "Bukti foto laporan";
            img.loading = "lazy";

            const loading = card.querySelector(".evidence-photo-loading");
            loading.replaceWith(img);

          } catch (photoError) {
            const loading = card.querySelector(".evidence-photo-loading");

            if (loading) {
              loading.textContent = "Foto tidak dapat dibuka.";
            }

            console.warn("Bukti foto:", photoError);
          }
        }
      }

      const convertButton = $("#convertReportButton");

      if (convertButton) {
        convertButton.onclick = async () => {
          const confirmed = window.confirm(
            `Konversi ${report.nomor} menjadi kasus? Tindakan ini akan membuat nomor kasus baru.`
          );

          if (!confirmed) return;

          convertButton.disabled = true;
          convertButton.textContent = "Memproses konversi...";

          try {
            const conversion = await reportApi("/convert-report", {
              method: "POST",
              body: JSON.stringify({ reportId })
            });

            toast(
              `Laporan berhasil dikonversi menjadi ${conversion.nomor}.`,
              "success"
            );

            cleanupPhotoUrls();
            detailContainer.innerHTML = "";

            await loadReports();

          } catch (error) {
            convertButton.disabled = false;
            convertButton.textContent = "Konversi menjadi kasus";

            toast(error.message, "error");
          }
        };
      }

    } catch (error) {
      console.error("Detail laporan:", error);

      detailContainer.innerHTML = `
        <div class="notice warning">
          <b>Detail laporan gagal dibuka.</b>
          <p>${escapeHtml(error.message)}</p>
        </div>
      `;
    }
  }

  searchInput.addEventListener("input", renderRows);
  unitFilter.addEventListener("change", renderRows);
  statusFilter.addEventListener("change", renderRows);

  $("#refreshReports").onclick = loadReports;

  loadReports();
}

// =====================================================
// MANAJEMEN KASUS
// =====================================================

async function caseList(host, database = false) {
  const currentRole = await getActiveRole();

  if (currentRole !== "Admin") {
    host.innerHTML = `
      <div class="notice warning">
        Anda tidak memiliki hak akses untuk melihat daftar kasus.
      </div>`;
    return;
  }
  
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
  const currentRole = await getActiveRole();

  if (currentRole !== "Admin") {
    toast("Anda tidak memiliki hak akses untuk melihat detail kasus.");
    return;
  }

  const s = await getDoc(doc(db, "cases", id));

  if (!s.exists()) {
    toast("Data kasus tidak ditemukan.", "error");
    return;
  }

  let d = s.data();

  const canViewReport = true;

  let reportId = d.reportId || "";
  let report = null;
  let evidence = Array.isArray(d.evidence) ? d.evidence : [];
  let photoUrls = [];

  const allowedStatuses = [
    "Dalam Telaah",
    "Pemeriksaan",
    "Menunggu Klarifikasi",
    "Rekomendasi",
    "Selesai",
    "Ditutup"
  ];

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

          <dt>Status terkini</dt>
          <dd>
            <strong id="caseCurrentStatus">
              ${escapeHtml(d.status || "-")}
            </strong>
          </dd>

          <dt>Nomor laporan asal</dt>
          <dd id="caseReportNumber">
            ${escapeHtml(d.nomorLaporan || "-")}
          </dd>

          <dt>Nama pelapor</dt>
          <dd id="caseReporter">
            ${escapeHtml(d.namaPelapor || "-")}
          </dd>

          <dt>Kontak pelapor</dt>
          <dd id="caseReporterContact">
            ${escapeHtml(d.kontakPelapor || "-")}
          </dd>

          <dt>Nama terlapor</dt>
          <dd id="caseReportedPerson">
            ${escapeHtml(d.namaTerlapor || "-")}
          </dd>
          
          <dt>Jabatan/unit terlapor</dt>
          <dd id="caseReportedPosition">
            ${escapeHtml(d.jabatanTerlapor || "-")}
          </dd>

          <dt>Uraian</dt>
          <dd class="report-description">
            ${escapeHtml(d.uraian || "-")}
          </dd>
        </dl>

        <section class="case-status-section">
          <h3>Perubahan Status Kasus</h3>

          <div class="form-group">
            <label for="caseNewStatus">Status baru</label>
            <select id="caseNewStatus" class="form-control">
              ${allowedStatuses.map(status => `
                <option value="${escapeHtml(status)}"
                  ${status === d.status ? "selected" : ""}>
                  ${escapeHtml(status)}
                </option>
              `).join("")}
            </select>
          </div>

          <div class="form-group">
            <label for="caseFollowUpNote">
              Catatan tindak lanjut
            </label>

            <textarea
              id="caseFollowUpNote"
              class="form-control"
              rows="4"
              maxlength="1000"
              placeholder="Tuliskan hasil pemeriksaan atau tindak lanjut..."
              required
            ></textarea>

            <small class="muted">
              Wajib diisi, maksimal 1.000 karakter.
            </small>
          </div>

          <button
            type="button"
            class="btn btn-primary"
            id="saveCaseStatus"
          >
            Simpan Perubahan
          </button>
        </section>

        <section class="case-history-section">
          <h3>Riwayat Penanganan Kasus</h3>

          <div id="caseStatusHistory">
            <p class="muted">Memuat riwayat...</p>
          </div>
        </section>

        <section class="report-evidence-section">
          <h3>Bukti Foto</h3>

          <div id="caseEvidenceGallery" class="evidence-preview">
            <p class="muted">Memeriksa bukti foto...</p>
          </div>
        </section>

        <p class="tiny muted">
          Setiap perubahan status dan catatan tindak lanjut
          dicatat dalam audit trail SI-ETIK.
        </p>
      </section>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);

  const modal = $("#caseModal");

  function closeCaseModal() {
    photoUrls.forEach(url => URL.revokeObjectURL(url));
    photoUrls = [];
    modal?.remove();
  }

  $("#closeModal").onclick = closeCaseModal;

  modal.onclick = event => {
    if (event.target === modal) {
      closeCaseModal();
    }
  };

  const gallery = $("#caseEvidenceGallery");
  const historyContainer = $("#caseStatusHistory");
  const statusSelect = $("#caseNewStatus");
  const noteInput = $("#caseFollowUpNote");
  const saveButton = $("#saveCaseStatus");

  function renderHistory() {
    const history = Array.isArray(d.riwayatStatus)
      ? [...d.riwayatStatus].reverse()
      : [];

    if (!history.length) {
      historyContainer.innerHTML = `
        <p class="muted">
          Belum ada riwayat perubahan status.
        </p>
        <p class="tiny muted">
          Status awal: ${escapeHtml(d.status || "Dalam Telaah")}
        </p>
      `;
      return;
    }

    historyContainer.innerHTML = history.map(item => `
      <article class="case-history-item">
        <div class="case-history-header">
          <strong>${escapeHtml(item.status || "-")}</strong>
          <span class="tiny muted">
            ${dateLabel(item.waktu)}
          </span>
        </div>

        <p>
          ${escapeHtml(item.catatan || "-")}
        </p>

        <small class="muted">
          Status sebelumnya:
          ${escapeHtml(item.statusSebelumnya || "-")}
        </small>

        <br>

        <small class="muted">
          Diperbarui oleh UID:
          ${escapeHtml(item.oleh || "-")}
        </small>
      </article>
    `).join("");
  }

  renderHistory();

  // Simpan perubahan status dan catatan tindak lanjut.
  saveButton.addEventListener("click", async () => {
    const newStatus = statusSelect.value;
    const catatan = noteInput.value.trim();

    if (!allowedStatuses.includes(newStatus)) {
      toast("Status kasus tidak valid.", "error");
      return;
    }

    if (!catatan) {
      toast("Catatan tindak lanjut wajib diisi.", "error");
      noteInput.focus();
      return;
    }

    if (catatan.length > 1000) {
      toast("Catatan maksimal 1.000 karakter.", "error");
      return;
    }

    if (newStatus === d.status) {
      toast("Silakan pilih status yang berbeda.", "error");
      return;
    }

    const confirmed = confirm(
      `Ubah status kasus menjadi "${newStatus}"?`
    );

    if (!confirmed) return;

    saveButton.disabled = true;
    saveButton.textContent = "Menyimpan...";

    try {
      await reportApi("/case-status", {
        method: "POST",
        body: JSON.stringify({
          caseId: id,
          status: newStatus,
          catatan
        })
      });

      // Ambil kembali data terbaru dari Firestore.
      const updatedSnap = await getDoc(doc(db, "cases", id));

      if (!updatedSnap.exists()) {
        throw new Error("Data kasus tidak ditemukan setelah diperbarui.");
      }

      d = updatedSnap.data();

      $("#caseCurrentStatus").textContent =
        d.status || "-";

      statusSelect.value = d.status;

      noteInput.value = "";

      renderHistory();

      toast("Status kasus berhasil diperbarui.", "success");

    } catch (error) {
      console.error("Perubahan status kasus:", error);

      toast(
        error.message || "Gagal memperbarui status kasus.",
        "error"
      );

    } finally {
      if (modal.isConnected) {
        saveButton.disabled = false;
        saveButton.textContent = "Simpan Perubahan";
      }
    }
  });

  try {
    // Cari laporan asal untuk kasus lama.
    if (!reportId && canViewReport) {
      const reportSnap = await getDocs(
        query(
          collection(db, "reports"),
          where("caseId", "==", id),
          limit(1)
        )
      );

      if (!reportSnap.empty) {
        reportId = reportSnap.docs[0].id;
      }
    }

    // Ambil data laporan asal melalui backend.
    if (reportId && canViewReport) {
      const result = await reportApi(
        `/report?reportId=${encodeURIComponent(reportId)}`
      );

      report = result.report || null;

      if (report) {
        evidence = Array.isArray(report.evidence)
          ? report.evidence
          : evidence;

        $("#caseReportNumber").textContent =
          report.nomor || d.nomorLaporan || "-";

        $("#caseReporter").textContent =
          report.namaPelapor || d.namaPelapor || "-";

        $("#caseReporterContact").textContent =
          report.kontakPelapor || d.kontakPelapor || "-";

        $("#caseReportedPerson").textContent =
          d.namaTerlapor || report.namaTerlapor || "-";
        
        $("#caseReportedPosition").textContent =
          d.jabatanTerlapor || report.jabatanTerlapor || "-";
      }
    }

    if (!evidence.length) {
      gallery.innerHTML = `
        <p class="muted">
          Tidak ada foto bukti pada laporan ini.
        </p>
      `;
      return;
    }

    if (!reportId) {
      gallery.innerHTML = `
        <p class="muted">
          Referensi laporan asal belum ditemukan.
          Foto bukti belum dapat ditampilkan.
        </p>
      `;
      return;
    }

    gallery.innerHTML = "";

    for (const photo of evidence) {
      const card = document.createElement("div");
      card.className = "evidence-preview-item";

      card.innerHTML = `
        <div class="evidence-photo-loading">
          Memuat foto...
        </div>
        <small>${escapeHtml(formatBytes(photo.size || 0))}</small>
      `;

      gallery.appendChild(card);

      try {
        const blob = await reportApi(
          `/evidence?reportId=${encodeURIComponent(reportId)}&evidenceId=${encodeURIComponent(photo.id)}`
        );

        if (!modal.isConnected) return;

        const objectUrl = URL.createObjectURL(blob);
        photoUrls.push(objectUrl);

        const img = document.createElement("img");
        img.src = objectUrl;
        img.alt = "Bukti foto kasus";
        img.loading = "lazy";
        img.style.cursor = "zoom-in";
        img.title = "Klik untuk memperbesar foto";

        img.addEventListener("click", () => {
          const preview = document.createElement("div");

          preview.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 99999;
            background: rgba(0,0,0,0.92);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            cursor: zoom-out;
          `;

          const fullImage = document.createElement("img");
          fullImage.src = objectUrl;
          fullImage.alt = "Bukti foto kasus ukuran penuh";

          fullImage.style.cssText = `
            max-width: 100%;
            max-height: 95vh;
            object-fit: contain;
            border-radius: 8px;
          `;

          preview.appendChild(fullImage);
          document.body.appendChild(preview);

          preview.addEventListener("click", () => {
            preview.remove();
          });
        });

        const loading = card.querySelector(
          ".evidence-photo-loading"
        );

        if (loading) {
          loading.replaceWith(img);
        }

      } catch (photoError) {
        const loading = card.querySelector(
          ".evidence-photo-loading"
        );

        if (loading) {
          loading.textContent = "Foto tidak dapat dibuka.";
        }

        console.warn("Bukti foto kasus:", photoError);
      }
    }

  } catch (error) {
    console.error("Detail kasus:", error);

    if (modal.isConnected) {
      gallery.innerHTML = `
        <p class="muted">
          Informasi laporan atau bukti foto belum dapat dimuat.
          ${escapeHtml(error.message)}
        </p>
      `;
    }
  }
}

// =====================================================
// DOKUMEN
// =====================================================


async function documents(host) {
  // Pemeriksaan hak akses
  const currentRole = await getActiveRole();

  if (currentRole !== "Admin") {
    host.innerHTML = `
      <div class="notice warning">
        Anda tidak memiliki hak akses untuk melihat dokumen internal.
      </div>`;
    return;
  }

  try {
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
            Repositori dokumen komite yang dapat diakses Admin.
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

  } catch (error) {
    console.error("Gagal memuat dokumen:", error);

    host.innerHTML = `
      <div class="notice warning">
        Dokumen gagal dimuat. Silakan coba kembali.
      </div>`;
  }
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

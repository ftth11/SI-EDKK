import { auth, db, functions } from "./firebase.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
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

async function callAdminFunction(name, data = {}) {
  if (!functions) throw new Error("Firebase Functions belum dikonfigurasi.");
  const callable = httpsCallable(functions, name);
  const result = await callable(data);
  return result.data || {};
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("File tidak dapat dibaca."));
    reader.readAsDataURL(file);
  });
}


function showConfirmDialog({ title, message, confirmText = "Ya, Hapus" }) {
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <section class="modal" role="dialog" aria-modal="true"
        aria-labelledby="appConfirmTitle" style="max-width:420px;text-align:center">
        <div style="font-size:36px;margin-bottom:12px" aria-hidden="true">🗑️</div>
        <h2 id="appConfirmTitle">${escapeHtml(title)}</h2>
        <p class="muted" style="line-height:1.7;margin:12px 0 22px">
          ${escapeHtml(message)}
        </p>
        <div style="display:flex;gap:10px;justify-content:center">
          <button type="button" class="btn subtle" data-dialog-cancel style="flex:1">Batal</button>
          <button type="button" class="btn primary" data-dialog-confirm
            style="flex:1;background:#dc2626">${escapeHtml(confirmText)}</button>
        </div>
      </section>
    `;

    document.body.appendChild(backdrop);
    const cancelButton = backdrop.querySelector("[data-dialog-cancel]");
    const confirmButton = backdrop.querySelector("[data-dialog-confirm]");
    let settled = false;

    const close = value => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeyDown);
      backdrop.remove();
      resolve(value);
    };

    const onKeyDown = event => {
      if (event.key === "Escape") close(false);
    };

    cancelButton.addEventListener("click", () => close(false));
    confirmButton.addEventListener("click", () => close(true));
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop) close(false);
    });
    document.addEventListener("keydown", onKeyDown);
    cancelButton.focus();
  });
}

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
  const isAdmin = normalizeRole(profile?.role) === "Admin";
  let cases = "—";
  let docs = "—";
  let programs = "—";
  let reports = "—";

  if (isAdmin) {
    const values = await Promise.allSettled([
      count("cases"),
      count("documents"),
      count("programs"),
      reportApi("/reports?pageSize=50")
    ]);
    cases = values[0].status === "fulfilled" ? values[0].value : "—";
    docs = values[1].status === "fulfilled" ? values[1].value : "—";
    programs = values[2].status === "fulfilled" ? values[2].value : "—";
    reports = values[3].status === "fulfilled"
      ? (values[3].value.reports || []).length
      : "—";
  } else {
    // User hanya mengambil daftar laporan miliknya melalui Worker.
    const result = await reportApi("/reports?pageSize=50");
    reports = Array.isArray(result.reports) ? result.reports.length : 0;
  }

  host.innerHTML = `
    <div class="welcome">
      <div>
        <p class="eyebrow">RINGKASAN SI-ETIK</p>
        <h1>Selamat datang, ${escapeHtml(profile.nama || profile.displayName || "Pengguna")}</h1>
        <p class="muted">${isAdmin
          ? "Pantau pelaporan, penanganan kasus, dan kelengkapan administrasi komite."
          : "Pantau laporan yang Anda kirimkan melalui SI-ETIK."}</p>
      </div>
      <span class="welcome-icon">✚</span>
    </div>

    <div class="stats-grid">
      ${isAdmin ? `
        <article class="stat-card"><span>Total kasus</span><b>${cases}</b><small>Data kasus internal</small></article>
        <article class="stat-card"><span>Laporan masuk</span><b>${reports}</b><small>Maksimal 50 laporan terbaru</small></article>
        <article class="stat-card"><span>Dokumen</span><b>${docs}</b><small>Dokumen komite</small></article>
        <article class="stat-card"><span>Program kerja</span><b>${programs}</b><small>Program terdaftar</small></article>
      ` : `
        <article class="stat-card"><span>Laporan saya</span><b>${reports}</b><small>Maksimal 50 laporan terbaru</small></article>
      `}
    </div>

    <div class="content-grid">
      <section class="panel">
        <div class="panel-head"><h3>${isAdmin ? "Administrasi komite" : "Pelaporan saya"}</h3></div>
        <p class="muted">${isAdmin
          ? "Tinjau laporan masuk, proses kasus, dan kelola administrasi melalui menu di samping."
          : "Anda hanya dapat melihat laporan teridentifikasi yang dikirim menggunakan akun ini."}</p>
        <button class="btn primary" data-goto="${isAdmin ? "laporan" : "pelaporan"}">${isAdmin ? "Buka daftar laporan" : "Buat laporan baru"}</button>
      </section>
      <section class="panel">
        <h3>Perlindungan data</h3>
        <ul class="clean-list">
          <li>Gunakan data minimum yang diperlukan.</li>
          <li>Hindari mengunggah identitas pasien jika tidak relevan.</li>
          <li>Catat informasi secara faktual dan objektif.</li>
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
            Semua kolom berikut bersifat opsional.
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
          Kontak terlapor
          <input
            name="kontakTerlapor"
            maxlength="160"
            placeholder="Nomor telepon atau email (opsional)"
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

function normalizeRole(role) {
  return ["Admin", "User"].includes(role) ? role : null;
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
                
                  ${report.status === "Baru" ? `
                    <button
                      class="text-btn"
                      data-report-delete="${escapeHtml(report.reportId)}"
                      style="color:#dc2626;"
                    >
                      Hapus
                    </button>
                  ` : ""}
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

    tableContainer.querySelectorAll("[data-report-delete]").forEach(button => {
      button.addEventListener("click", async () => {
        const reportId = button.dataset.reportDelete;

        const confirmed = await showConfirmDialog({
          title: "Hapus Laporan?",
          message: "Laporan tidak akan tampil lagi dalam daftar aktif. Riwayat audit tetap tersimpan.",
          confirmText: "Ya, Hapus"
        });

        if (!confirmed) return;

        button.disabled = true;
        button.textContent = "Menghapus...";

        try {
          await reportApi("/delete-report", {
            method: "POST",
            body: JSON.stringify({ reportId })
          });

          toast("Laporan berhasil dihapus.", "success");
          await loadReports();

        } catch (error) {
          toast(error.message || "Laporan gagal dihapus.", "error");
          button.disabled = false;
          button.textContent = "Hapus";
        }
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

            <dt>Nama terlapor</dt>
            <dd>${escapeHtml(report.namaTerlapor || "-")}</dd>

            <dt>Kontak terlapor</dt>
            <dd>${escapeHtml(report.kontakTerlapor || "-")}</dd>

            <dt>Jabatan/unit terlapor</dt>
            <dd>${escapeHtml(report.jabatanTerlapor || "-")}</dd>

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

          <dt>Kontak terlapor</dt>
          <dd id="caseReportedContact">
            ${escapeHtml(d.kontakTerlapor || "-")}
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

        $("#caseReportedContact").textContent =
          d.kontakTerlapor || report.kontakTerlapor || "-";
        
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
  if (await getActiveRole() !== "Admin") {
    host.innerHTML = `<div class="notice warning">Anda tidak memiliki hak akses untuk mengelola dokumen internal.</div>`;
    return;
  }
  const snap = await getDocs(query(collection(db, "documents"), orderBy("updatedAt", "desc"), limit(100)));
  const items = snap.docs.map(x => ({ id: x.id, ...x.data() }));
  host.innerHTML = `
    <div class="page-intro"><div><h1>Dokumen & Akreditasi</h1><p class="muted">Unggah dan kelola dokumen komite. File disimpan privat; maksimal 4 MB.</p></div></div>
    <section class="panel" style="margin-bottom:18px">
      <h3>Unggah dokumen</h3>
      <form id="documentForm" class="form-grid">
        <label>Nama dokumen<input name="nama" maxlength="160" required></label>
        <label>Kategori<select name="kategori" required><option value="">Pilih kategori</option><option>Pedoman</option><option>Kebijakan</option><option>SPO</option><option>Formulir</option><option>Program Kerja</option><option>Laporan</option><option>Akreditasi</option><option>Lainnya</option></select></label>
        <label>Nomor dokumen<input name="nomor" maxlength="100"></label>
        <label>Versi<input name="versi" maxlength="40"></label>
        <label class="full">File (PDF, Word, Excel, PowerPoint, JPG, PNG)<input name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png" required></label>
        <div class="full"><button class="btn primary" type="submit">Unggah dokumen</button></div>
      </form>
    </section>
    <section class="panel"><div class="panel-head"><h3>Repositori dokumen</h3><span class="pill">${items.length} dokumen</span></div>
      <div class="table-wrap"><table><thead><tr><th>Nama</th><th>Kategori</th><th>Nomor/versi</th><th>Ukuran</th><th>Pembaruan</th><th>Aksi</th></tr></thead><tbody>
      ${items.map(d=>`<tr><td><b>${escapeHtml(d.nama||"-")}</b><br><small class="muted">${escapeHtml(d.fileName||"")}</small></td><td>${escapeHtml(d.kategori||"-")}</td><td>${escapeHtml(d.nomor||d.versi||"-")}</td><td>${(Number(d.size||0)/1024).toFixed(0)} KB</td><td>${dateLabel(d.updatedAt)}</td><td><button class="text-btn" data-doc-download="${escapeHtml(d.id)}">Unduh</button> <button class="text-btn" data-doc-delete="${escapeHtml(d.id)}">Hapus</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty">Belum ada dokumen.</td></tr>`}
      </tbody></table></div>
    </section>`;

  $("#documentForm", host).addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const file = form.elements.file.files[0];
    if (!file) return toast("Pilih file dokumen terlebih dahulu.", "error");
    if (file.size > 4 * 1024 * 1024) return toast("Ukuran file maksimal 4 MB.", "error");
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true; submit.textContent = "Mengunggah...";
    try {
      await callAdminFunction("uploadManagedDocument", {
        nama: form.elements.nama.value,
        kategori: form.elements.kategori.value,
        nomor: form.elements.nomor.value,
        versi: form.elements.versi.value,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        base64: await fileToBase64(file)
      });
      toast("Dokumen berhasil diunggah.", "success");
      await documents(host);
    } catch (error) {
      console.error(error); toast(error.message || "Dokumen gagal diunggah.", "error");
      submit.disabled = false; submit.textContent = "Unggah dokumen";
    }
  });
  host.querySelectorAll("[data-doc-download]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true; button.textContent = "Menyiapkan...";
    try {
      const data = await callAdminFunction("downloadManagedDocument", { id: button.dataset.docDownload });
      const binary = atob(data.base64); const bytes = new Uint8Array(binary.length);
      for (let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: data.contentType }));
      const a = document.createElement("a"); a.href = url; a.download = data.fileName || "dokumen"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { toast(error.message || "Dokumen gagal diunduh.", "error"); }
    finally { button.disabled = false; button.textContent = "Unduh"; }
  }));
  host.querySelectorAll("[data-doc-delete]").forEach(button => button.addEventListener("click", async () => {
    if (!await showConfirmDialog({ title: "Hapus dokumen?", message: "File dan data dokumen ini akan dihapus." })) return;
    button.disabled = true;
    try { await callAdminFunction("deleteManagedDocument", { id: button.dataset.docDelete }); toast("Dokumen dihapus.", "success"); await documents(host); }
    catch (error) { toast(error.message || "Dokumen gagal dihapus.", "error"); button.disabled = false; }
  }));
}

// =====================================================
// MONITORING
// =====================================================

async function monitoring(host) {
  if (await getActiveRole() !== "Admin") { host.innerHTML = `<div class="notice warning">Akses hanya untuk Admin.</div>`; return; }
  const [caseSnap, evalSnap] = await Promise.all([
    getDocs(query(collection(db, "cases"), orderBy("createdAt", "desc"), limit(500))),
    getDocs(query(collection(db, "evaluations"), orderBy("createdAt", "desc"), limit(100)))
  ]);
  const cases = caseSnap.docs.map(x=>({id:x.id,...x.data()}));
  const evaluations = evalSnap.docs.map(x=>({id:x.id,...x.data()}));
  const statuses = ["Dalam Telaah","Pemeriksaan","Menunggu Klarifikasi","Rekomendasi","Selesai","Ditutup"];
  host.innerHTML = `
    <div class="page-intro"><div><h1>Monitoring & Evaluasi</h1><p class="muted">Ringkasan status dari maksimal 500 kasus terbaru dan pencatatan evaluasi berkala.</p></div><button class="btn subtle" id="monitorRefresh">Muat ulang</button></div>
    <div class="stats-grid">${statuses.map(st=>`<article class="stat-card"><span>${escapeHtml(st)}</span><b>${cases.filter(c=>c.status===st).length}</b></article>`).join("")}</div>
    <section class="panel" style="margin-bottom:18px"><h3>Catat evaluasi</h3>
      <form id="evaluationForm" class="form-grid">
        <label>Judul evaluasi<input name="judul" maxlength="160" required></label>
        <label>Periode<input name="periode" maxlength="80" placeholder="Contoh: Triwulan I 2027" required></label>
        <label class="full">Indikator<input name="indikator" maxlength="240" required></label>
        <label>Target<input name="target" maxlength="160" required></label>
        <label>Capaian<input name="capaian" maxlength="160" required></label>
        <label class="full">Catatan<textarea name="catatan" rows="3" maxlength="3000"></textarea></label>
        <div class="full"><button class="btn primary" type="submit">Simpan evaluasi</button></div>
      </form>
    </section>
    <section class="panel"><div class="panel-head"><h3>Hasil evaluasi</h3><span class="pill">${evaluations.length} catatan</span></div>
      <div class="table-wrap"><table><thead><tr><th>Evaluasi</th><th>Periode</th><th>Indikator</th><th>Target</th><th>Capaian</th><th>Aksi</th></tr></thead><tbody>
      ${evaluations.map(v=>`<tr><td><b>${escapeHtml(v.judul||"-")}</b><br><small class="muted">${escapeHtml(v.catatan||"")}</small></td><td>${escapeHtml(v.periode||"-")}</td><td>${escapeHtml(v.indikator||"-")}</td><td>${escapeHtml(v.target||"-")}</td><td>${escapeHtml(v.capaian||"-")}</td><td><button class="text-btn" data-eval-edit="${escapeHtml(v.id)}">Edit</button> <button class="text-btn" data-eval-delete="${escapeHtml(v.id)}">Hapus</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty">Belum ada evaluasi.</td></tr>`}
      </tbody></table></div>
    </section>`;
  $("#monitorRefresh",host).onclick=()=>monitoring(host);
  $("#evaluationForm",host).addEventListener("submit",async e=>{
    e.preventDefault(); const f=e.currentTarget; const b=f.querySelector("button[type=submit]"); b.disabled=true;
    try { await callAdminFunction("saveManagedEvaluation", {id:f.dataset.editId || "",judul:f.elements.judul.value,periode:f.elements.periode.value,indikator:f.elements.indikator.value,target:f.elements.target.value,capaian:f.elements.capaian.value,catatan:f.elements.catatan.value}); toast(f.dataset.editId ? "Evaluasi diperbarui." : "Evaluasi berhasil disimpan.","success"); await monitoring(host); }
    catch(error){toast(error.message||"Evaluasi gagal disimpan.","error");b.disabled=false;}
  });
  host.querySelectorAll("[data-eval-edit]").forEach(b=>b.onclick=()=>{
    const item=evaluations.find(x=>x.id===b.dataset.evalEdit); if(!item)return;
    const form=$("#evaluationForm",host);
    form.dataset.editId=item.id;
    form.elements.judul.value=item.judul||"";
    form.elements.periode.value=item.periode||"";
    form.elements.indikator.value=item.indikator||"";
    form.elements.target.value=item.target||"";
    form.elements.capaian.value=item.capaian||"";
    form.elements.catatan.value=item.catatan||"";
    form.querySelector("button[type=submit]").textContent="Simpan perubahan";
    form.scrollIntoView({behavior:"smooth",block:"start"});
  });
  host.querySelectorAll("[data-eval-delete]").forEach(b=>b.onclick=async()=>{
    if(!await showConfirmDialog({title:"Hapus evaluasi?",message:"Catatan evaluasi ini akan dihapus."}))return;
    b.disabled=true; try{await callAdminFunction("deleteManagedEvaluation",{id:b.dataset.evalDelete});toast("Evaluasi dihapus.","success");await monitoring(host);}catch(error){toast(error.message||"Gagal menghapus evaluasi.","error");b.disabled=false;}
  });
}

// =====================================================
// PROGRAM & KEGIATAN
// =====================================================

async function programs(host) {
  if (await getActiveRole() !== "Admin") { host.innerHTML = `<div class="notice warning">Akses hanya untuk Admin.</div>`; return; }
  const snap = await getDocs(query(collection(db,"programs"),orderBy("createdAt","desc"),limit(100)));
  const items = snap.docs.map(x=>({id:x.id,...x.data()}));
  host.innerHTML = `
    <div class="page-intro"><div><h1>Program & Kegiatan</h1><p class="muted">Kelola program kerja, rapat, sosialisasi, dan kegiatan komite.</p></div></div>
    <section class="panel" style="margin-bottom:18px"><h3>Tambah program/kegiatan</h3>
      <form id="programForm" class="form-grid">
        <label>Nama program/kegiatan<input name="nama" maxlength="160" required></label>
        <label>Periode<input name="periode" maxlength="80" placeholder="Contoh: Tahun 2027" required></label>
        <label>Penanggung jawab<input name="pic" maxlength="120" required></label>
        <label>Status<select name="status"><option>Direncanakan</option><option>Berjalan</option><option>Selesai</option><option>Ditunda</option></select></label>
        <label>Tanggal mulai<input type="date" name="tanggalMulai"></label>
        <label>Tanggal selesai<input type="date" name="tanggalSelesai"></label>
        <label class="full">Deskripsi<textarea name="deskripsi" rows="3" maxlength="2000"></textarea></label>
        <div class="full"><button class="btn primary" type="submit">Simpan program</button></div>
      </form>
    </section>
    <section class="panel"><div class="panel-head"><h3>Daftar program</h3><span class="pill">${items.length} program</span></div>
      <div class="table-wrap"><table><thead><tr><th>Program/kegiatan</th><th>Periode</th><th>Penanggung jawab</th><th>Status</th><th>Tanggal</th><th>Aksi</th></tr></thead><tbody>
      ${items.map(x=>`<tr><td><b>${escapeHtml(x.nama||"-")}</b><br><small class="muted">${escapeHtml(x.deskripsi||"")}</small></td><td>${escapeHtml(x.periode||"-")}</td><td>${escapeHtml(x.pic||"-")}</td><td><span class="status">${escapeHtml(x.status||"-")}</span></td><td>${escapeHtml(x.tanggalMulai||"-")} – ${escapeHtml(x.tanggalSelesai||"-")}</td><td><button class="text-btn" data-program-edit="${escapeHtml(x.id)}">Edit</button> <button class="text-btn" data-program-delete="${escapeHtml(x.id)}">Hapus</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty">Belum ada program kerja.</td></tr>`}
      </tbody></table></div>
    </section>`;
  const form=$("#programForm",host);
  form.addEventListener("submit",async e=>{
    e.preventDefault();const f=e.currentTarget;const b=f.querySelector("button[type=submit]");b.disabled=true;
    try{await callAdminFunction("saveManagedProgram",{nama:f.elements.nama.value,periode:f.elements.periode.value,pic:f.elements.pic.value,status:f.elements.status.value,tanggalMulai:f.elements.tanggalMulai.value,tanggalSelesai:f.elements.tanggalSelesai.value,deskripsi:f.elements.deskripsi.value});toast("Program berhasil disimpan.","success");await programs(host);}
    catch(error){toast(error.message||"Program gagal disimpan.","error");b.disabled=false;}
  });
  host.querySelectorAll("[data-program-edit]").forEach(b=>b.onclick=async()=>{
    const item=items.find(x=>x.id===b.dataset.programEdit);if(!item)return;
    form.elements.nama.value=item.nama||"";form.elements.periode.value=item.periode||"";form.elements.pic.value=item.pic||"";form.elements.status.value=item.status||"Direncanakan";form.elements.tanggalMulai.value=item.tanggalMulai||"";form.elements.tanggalSelesai.value=item.tanggalSelesai||"";form.elements.deskripsi.value=item.deskripsi||"";
    form.dataset.editId=item.id;form.querySelector("button[type=submit]").textContent="Simpan perubahan";form.scrollIntoView({behavior:"smooth",block:"start"});
  });
  // Ubah submit handler agar mendukung update saat mode edit.
  form.addEventListener("submit",async e=>{
    if(!form.dataset.editId)return;
    e.preventDefault();e.stopImmediatePropagation();const b=form.querySelector("button[type=submit]");b.disabled=true;
    try{await callAdminFunction("saveManagedProgram",{id:form.dataset.editId,nama:form.elements.nama.value,periode:form.elements.periode.value,pic:form.elements.pic.value,status:form.elements.status.value,tanggalMulai:form.elements.tanggalMulai.value,tanggalSelesai:form.elements.tanggalSelesai.value,deskripsi:form.elements.deskripsi.value});toast("Program diperbarui.","success");await programs(host);}
    catch(error){toast(error.message||"Program gagal diperbarui.","error");b.disabled=false;}
  },true);
  host.querySelectorAll("[data-program-delete]").forEach(b=>b.onclick=async()=>{
    if(!await showConfirmDialog({title:"Hapus program?",message:"Data program/kegiatan ini akan dihapus."}))return;
    b.disabled=true;try{await callAdminFunction("deleteManagedProgram",{id:b.dataset.programDelete});toast("Program dihapus.","success");await programs(host);}catch(error){toast(error.message||"Program gagal dihapus.","error");b.disabled=false;}
  });
}

// =====================================================
// PENGATURAN
// =====================================================

async function settings(host, profile) {
  if (await getActiveRole() !== "Admin") { host.innerHTML = `<div class="notice warning">Akses hanya untuk Admin.</div>`; return; }
  let result;
  try { result = await callAdminFunction("listManagedUsers"); }
  catch(error) { host.innerHTML = `<div class="notice warning">Daftar akun gagal dimuat: ${escapeHtml(error.message)}</div>`; return; }
  const users = result.users || [];
  host.innerHTML = `
    <div class="page-intro"><div><h1>Pengaturan</h1><p class="muted">Profil administrator dan pengelolaan akun SI-ETIK.</p></div></div>
    <section class="panel" style="margin-bottom:18px"><h3>Profil akun aktif</h3><dl class="detail-list"><dt>Nama</dt><dd>${escapeHtml(profile.nama||"-")}</dd><dt>Email</dt><dd>${escapeHtml(profile.email||auth.currentUser?.email||"-")}</dd><dt>Role</dt><dd>${escapeHtml(profile.role||"-")}</dd><dt>Status</dt><dd>${profile.aktif===true?"Aktif":"Nonaktif"}</dd></dl></section>
    <section class="panel" style="margin-bottom:18px"><h3>Buat akun baru</h3><form id="createUserForm" class="form-grid"><label>Nama lengkap<input name="nama" maxlength="120" required></label><label>Email<input name="email" type="email" maxlength="160" required></label><label>Password sementara<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><label>Role<select name="role"><option>User</option><option>Admin</option></select></label><div class="full"><button class="btn primary" type="submit">Buat akun</button></div></form><p class="tiny muted">Password sementara diberikan kepada pemilik akun melalui jalur yang aman. Jangan membagikannya melalui grup umum.</p></section>
    <section class="panel"><div class="panel-head"><h3>Manajemen akun</h3><span class="pill">${result.total||users.length} akun · ${result.totalAktif||0} aktif</span></div><div class="table-wrap"><table><thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
    ${users.map(u=>`<tr><td><b>${escapeHtml(u.nama||"-")}</b></td><td>${escapeHtml(u.email||"-")}</td><td>${escapeHtml(u.role||"-")}</td><td><span class="status">${u.aktif?"Aktif":"Nonaktif"}</span></td><td>${u.uid===auth.currentUser?.uid?"Akun Anda":`<button class="text-btn" data-user-role="${escapeHtml(u.uid)}" data-role="${u.role}">Ubah role</button> <button class="text-btn" data-user-active="${escapeHtml(u.uid)}" data-active="${u.aktif?"1":"0"}">${u.aktif?"Nonaktifkan":"Aktifkan"}</button>`}</td></tr>`).join("")||`<tr><td colspan="5" class="empty">Belum ada akun.</td></tr>`}
    </tbody></table></div></section>`;
  $("#createUserForm",host).addEventListener("submit",async e=>{
    e.preventDefault();const f=e.currentTarget;const b=f.querySelector("button[type=submit]");b.disabled=true;b.textContent="Membuat akun...";
    try{await callAdminFunction("createManagedUser",{nama:f.elements.nama.value,email:f.elements.email.value,password:f.elements.password.value,role:f.elements.role.value});toast("Akun berhasil dibuat.","success");await settings(host,profile);}
    catch(error){toast(error.message||"Akun gagal dibuat.","error");b.disabled=false;b.textContent="Buat akun";}
  });
  host.querySelectorAll("[data-user-role]").forEach(b=>b.onclick=async()=>{
    const next=b.dataset.role==="Admin"?"User":"Admin";
    if(!await showConfirmDialog({title:"Ubah role akun?",message:`Role akun akan diubah menjadi ${next}.`,confirmText:"Ya, Ubah"}))return;
    b.disabled=true;try{await callAdminFunction("setUserRole",{uid:b.dataset.userRole,role:next});toast("Role akun diperbarui.","success");await settings(host,profile);}catch(error){toast(error.message||"Role gagal diubah.","error");b.disabled=false;}
  });
  host.querySelectorAll("[data-user-active]").forEach(b=>b.onclick=async()=>{
    const next=b.dataset.active!=="1";
    if(!await showConfirmDialog({title:next?"Aktifkan akun?":"Nonaktifkan akun?",message:next?"Pengguna dapat login kembali.":"Pengguna tidak dapat login selama akun nonaktif.",confirmText:next?"Ya, Aktifkan":"Ya, Nonaktifkan"}))return;
    b.disabled=true;try{await callAdminFunction("setUserActive",{uid:b.dataset.userActive,aktif:next});toast("Status akun diperbarui.","success");await settings(host,profile);}catch(error){toast(error.message||"Status akun gagal diubah.","error");b.disabled=false;}
  });
}


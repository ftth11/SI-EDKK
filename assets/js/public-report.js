// SI-ETIK - Pelaporan publik
// Letakkan file ini di: assets/js/public-report.js
// Endpoint Worker: https://si-etik-api.baits-ap97.workers.dev/public-report

const API_BASE = "https://si-etik-api.baits-ap97.workers.dev";
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 1_500_000;
const MAX_IMAGE_EDGE = 1600;

const form =
  document.querySelector("#publicReportForm") ||
  document.querySelector("#public-report-form") ||
  document.querySelector("form[data-public-report]") ||
  document.querySelector("form");

if (!form) {
  console.error("SI-ETIK: Form pelaporan publik tidak ditemukan.");
} else {
  const getField = (...names) => {
    for (const name of names) {
      const field =
        form.elements.namedItem(name) ||
        form.querySelector(`#${CSS.escape(name)}`) ||
        document.querySelector(`#${CSS.escape(name)}`);
      if (field) return field;
    }
    return null;
  };

  const getValue = (...names) => String(getField(...names)?.value || "").trim();

  const submitButton =
    form.querySelector('[type="submit"]') ||
    document.querySelector("#btnKirim, #submitReport, [data-submit-report]");

  const statusElement =
    document.querySelector("#formMessage, #statusMessage, #submitMessage, [data-form-message]");

  function showMessage(message, type = "info") {
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.dataset.type = type;
      statusElement.setAttribute("role", "status");
    } else {
      alert(message);
    }
  }

  function setBusy(busy) {
    if (submitButton) {
      submitButton.disabled = busy;
      if (!submitButton.dataset.originalText) {
        submitButton.dataset.originalText = submitButton.textContent;
      }
      submitButton.textContent = busy
        ? "Mengirim laporan..."
        : submitButton.dataset.originalText;
    }
  }

  function readSelectedFiles() {
    const input =
      getField("publicEvidenceFiles", "evidence", "fotoBukti", "foto", "photos", "bukti");
    if (!input) return [];
    return Array.from(input.files || []);
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error("Foto gagal diproses.")),
        type,
        quality
      );
    });
  }

  async function compressImage(file) {
    if (!file.type.startsWith("image/")) {
      throw new Error(`File "${file.name}" bukan gambar.`);
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = objectUrl;
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error(`Foto "${file.name}" tidak dapat dibaca.`));
      });

      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

      const context = canvas.getContext("2d");
      if (!context) throw new Error("Browser tidak mendukung pemrosesan foto.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      let quality = 0.82;
      let blob = await canvasBlob(canvas, "image/jpeg", quality);
      while (blob.size > MAX_PHOTO_BYTES && quality > 0.42) {
        quality -= 0.1;
        blob = await canvasBlob(canvas, "image/jpeg", quality);
      }
      if (blob.size > MAX_PHOTO_BYTES) {
        throw new Error(`Foto "${file.name}" masih lebih dari 1,5 MB setelah dikompres.`);
      }

      const safeName = (file.name || "foto").replace(/\.[^.]+$/, "");
      return new File([blob], `${safeName}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now()
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const jenis = getValue("jenis");
    const unit = getValue("unit");
    const tanggalKejadian = getValue("tanggalKejadian", "tanggal");
    const namaPelapor = getValue("namaPelapor", "nama_pelapor");
    const namaTerlapor = getValue("namaTerlapor", "nama_terlapor");
    const jabatanTerlapor = getValue("jabatanTerlapor", "jabatan_terlapor");
    const uraian = getValue("uraian");

    if (!jenis || !unit || !tanggalKejadian || !namaPelapor || !uraian) {
      showMessage("Mohon lengkapi seluruh kolom wajib, termasuk nama pelapor.", "error");
      return;
    }

    const selectedFiles = readSelectedFiles();
    if (selectedFiles.length > MAX_PHOTOS) {
      showMessage("Foto bukti maksimal 3 file.", "error");
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.append("jenis", jenis);
      body.append("unit", unit);
      body.append("tanggalKejadian", tanggalKejadian);
      body.append("namaPelapor", namaPelapor);
      body.append("namaTerlapor", namaTerlapor);
      body.append("jabatanTerlapor", jabatanTerlapor);
      body.append("uraian", uraian);

      for (const file of selectedFiles) {
        const compressed = await compressImage(file);
        body.append("evidence", compressed, compressed.name);
      }

      const response = await fetch(`${API_BASE}/public-report`, {
        method: "POST",
        body
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true) {
        throw new Error(result.message || result.error || "Laporan gagal dikirim. Silakan coba kembali.");
      }

      const number = result.nomor || result.nomorLaporan || "";
      form.reset();
      showMessage(
        number
          ? `Laporan berhasil dikirim. Nomor laporan: ${number}`
          : "Laporan berhasil dikirim.",
        "success"
      );
    } catch (error) {
      console.error("SI-ETIK public report:", error);
      showMessage(error.message || "Terjadi kesalahan saat mengirim laporan.", "error");
    } finally {
      setBusy(false);
    }
  });
}

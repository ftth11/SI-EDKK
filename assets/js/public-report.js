
// SI-ETIK - Pelaporan Publik
const API_BASE = "https://si-etik-api.baits-ap97.workers.dev";
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 1_500_000;
const MAX_IMAGE_EDGE = 1600;

function initPublicReport() {
  const form =
    document.querySelector("#publicReportForm") ||
    document.querySelector("#public-report-form") ||
    document.querySelector("form[data-public-report]");

  if (!form) {
    console.error("SI-ETIK: Form pelaporan publik tidak ditemukan.");
    return;
  }

  const getField = (...names) => {
    for (const name of names) {
      const field =
        form.elements.namedItem(name) ||
        form.querySelector(`#${CSS.escape(name)}`) ||
        document.getElementById(name);

      if (field) return field;
    }
    return null;
  };

  const getValue = (...names) =>
    String(getField(...names)?.value || "").trim();

  const submitButton = form.querySelector('[type="submit"]');

  const statusElement = document.querySelector(
    "#reportMessage, #formMessage, #statusMessage, #submitMessage, [data-form-message]"
  );

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
    if (!submitButton) return;

    if (!submitButton.dataset.originalText) {
      submitButton.dataset.originalText = submitButton.textContent;
    }

    submitButton.disabled = busy;
    submitButton.textContent = busy
      ? "Mengirim laporan..."
      : submitButton.dataset.originalText;
  }

  function readSelectedFiles() {
    const input = document.getElementById("publicEvidenceFiles");
    return input ? Array.from(input.files || []) : [];
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => blob
          ? resolve(blob)
          : reject(new Error("Foto gagal diproses.")),
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
        image.onerror = () =>
          reject(new Error(`Foto "${file.name}" tidak dapat dibaca.`));
      });

      const scale = Math.min(
        1,
        MAX_IMAGE_EDGE / Math.max(
          image.naturalWidth,
          image.naturalHeight
        )
      );

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Browser tidak mendukung pemrosesan foto.");
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      let quality = 0.82;
      let blob = await canvasBlob(canvas, "image/jpeg", quality);

      while (blob.size > MAX_PHOTO_BYTES && quality > 0.42) {
        quality -= 0.1;
        blob = await canvasBlob(canvas, "image/jpeg", quality);
      }

      if (blob.size > MAX_PHOTO_BYTES) {
        throw new Error(
          `Foto "${file.name}" masih lebih dari 1,5 MB setelah dikompres.`
        );
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

    if (form.dataset.submitting === "true") return;

    const jenis = getValue("jenis");
    const unit = getValue("unit");
    const tanggalKejadian = getValue("tanggalKejadian", "tanggal");
    const namaPelapor = getValue("namaPelapor", "nama_pelapor");
    const namaTerlapor = getValue("namaTerlapor", "nama_terlapor");
    const jabatanTerlapor = getValue("jabatanTerlapor", "jabatan_terlapor");
    const uraian = getValue("uraian");

    const pernyataan = getField("pernyataan");

    if (!jenis || !unit || !tanggalKejadian || !namaPelapor || !uraian) {
      showMessage(
        "Mohon lengkapi jenis laporan, nama pelapor, unit, tanggal, dan uraian kejadian.",
        "error"
      );
      return;
    }

    if (uraian.length < 20) {
      showMessage("Uraian kejadian minimal 20 karakter.", "error");
      return;
    }

    if (!pernyataan || !pernyataan.checked) {
      showMessage("Mohon centang pernyataan sebelum mengirim laporan.", "error");
      return;
    }

    const selectedFiles = readSelectedFiles();

    if (selectedFiles.length > MAX_PHOTOS) {
      showMessage("Foto bukti maksimal 3 file.", "error");
      return;
    }

    form.dataset.submitting = "true";
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

      const responseText = await response.text();
      let result = {};

      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error(
          `Respons server tidak valid (HTTP ${response.status}).`
        );
      }

      if (!response.ok || result.success !== true) {
        throw new Error(
          result.message ||
          result.error ||
          `Laporan gagal dikirim (HTTP ${response.status}).`
        );
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

      showMessage(
        error.message || "Terjadi kesalahan saat mengirim laporan.",
        "error"
      );

    } finally {
      form.dataset.submitting = "false";
      setBusy(false);
    }
  });

  console.log("SI-ETIK: Form pelaporan publik berhasil diinisialisasi.");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPublicReport, { once: true });
} else {
  initPublicReport();
}

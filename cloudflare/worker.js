
const PROJECT_ID = "si-edkk";
const ALLOWED_ORIGIN = "https://ftth11.github.io";
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const ROLES = ["Admin", "User"];

const INTERNAL_REPORT_ROLES = ["Admin", "User"];

const CASE_MANAGER_ROLES = ["Admin"];

const MAX_PHOTO_BYTES = 1500000;
const MAX_PHOTOS_PER_REPORT = 3;

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function base64url(input) {
  return base64urlBytes(new TextEncoder().encode(input));
}

function base64urlBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

async function getGoogleAccessToken(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new ApiError("Konfigurasi Service Account belum tersedia.", 500);
  }

  const account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({
    alg: "RS256",
    typ: "JWT"
  }));

  const claim = base64url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform",
    aud: account.token_uri,
    iat: now,
    exp: now + 3600
  }));

  const unsignedToken = `${header}.${claim}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken)
  );

  const jwt =
    `${unsignedToken}.${base64urlBytes(new Uint8Array(signature))}`;

  const response = await fetch(account.token_uri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.access_token) {
    throw new ApiError("Google OAuth gagal.", 502);
  }

  return result.access_token;
}

// -----------------------------------------------------
// FIRESTORE ENCODING
// -----------------------------------------------------

function encodeValue(value) {
  if (value === null) return { nullValue: "NULL" };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };

  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(encodeValue)
      }
    };
  }

  if (typeof value === "object") {
    return {
      mapValue: {
        fields: encodeFields(value)
      }
    };
  }

  throw new Error("Tipe data tidak didukung.");
}

function encodeFields(data) {
  const fields = {};

  for (const [key, value] of Object.entries(data)) {
    fields[key] = encodeValue(value);
  }

  return fields;
}

function decodeValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;

  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(decodeValue);
  }

  if ("mapValue" in value) {
    return decodeFields(value.mapValue.fields || {});
  }

  return null;
}

function decodeFields(fields = {}) {
  const result = {};

  for (const [key, value] of Object.entries(fields)) {
    result[key] = decodeValue(value);
  }

  return result;
}

function documentName(path) {
  return `projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
}

async function fsRequest(path, token, options = {}) {
  const response = await fetch(`${FS_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.error?.message || "Firestore request gagal."
    );
    error.status = response.status;
    error.code = data.error?.status;
    throw error;
  }

  return data;
}

async function getDocument(path, token) {
  try {
    const data = await fsRequest(`/${path}`, token);

    return {
      name: data.name,
      updateTime: data.updateTime,
      data: decodeFields(data.fields || {})
    };
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

// Firestore batchGet mengembalikan respons JSON per baris.


async function batchGetDocuments(paths, token, transaction) {
  const response = await fetch(`${FS_BASE}:batchGet`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      documents: paths.map(documentName),
      transaction
    })
  });

  const text = await response.text();

  if (!response.ok) {
    let detail = {};

    try {
      detail = JSON.parse(text);
    } catch {}

    const error = new Error(
      detail.error?.message ||
      "Gagal membaca dokumen transaksi Firestore."
    );

    error.status = response.status;
    error.code = detail.error?.status;
    throw error;
  }

  const cleaned = text
    .replace(/^\uFEFF/, "")
    .replace(/^\)\]\}',?\s*/, "")
    .trim();

  if (!cleaned) {
    throw new Error(
      "Firestore mengembalikan respons batch kosong."
    );
  }

  // Coba membaca sebagai JSON biasa terlebih dahulu.
  try {
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (parsed && typeof parsed === "object") {
      return [parsed];
    }
  } catch {
    // Jika bukan JSON biasa, lanjutkan sebagai NDJSON.
  }

  // Membaca respons NDJSON.
  const results = [];
  const lines = cleaned.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) continue;

    try {
      results.push(JSON.parse(line));
    } catch {
      const error = new Error(
        `Format batchGet Firestore tidak valid pada baris ${i + 1}.`
      );

      error.code = "INVALID_BATCH_RESPONSE";
      error.contentType = response.headers.get("content-type") || "unknown";
      error.responseLength = cleaned.length;

      throw error;
    }
  }

  if (!results.length) {
    throw new Error(
      "Firestore tidak mengembalikan dokumen batch yang dapat dibaca."
    );
  }

  return results;
}

async function beginTransaction(token) {
  const result = await fsRequest(":beginTransaction", token, {
    method: "POST",
    body: {
      options: {
        readWrite: {}
      }
    }
  });

  return result.transaction;
}

async function commitTransaction(writes, token, transaction) {
  return fsRequest(":commit", token, {
    method: "POST",
    body: {
      writes,
      transaction
    }
  });
}

function createWrite(path, data) {
  return {
    update: {
      name: documentName(path),
      fields: encodeFields(data)
    },
    currentDocument: {
      exists: false
    }
  };
}

function updateWrite(path, data) {
  return {
    update: {
      name: documentName(path),
      fields: encodeFields(data)
    }
  };
}

function randomId() {
  return crypto.randomUUID();
}

function clean(value, max, field) {
  if (typeof value !== "string") {
    throw new ApiError(`${field} tidak valid.`);
  }

  const result = value.trim();

  if (!result || result.length > max) {
    throw new ApiError(`${field} kosong atau melebihi batas.`);
  }

  return result;
}

function optionalText(value, max) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}

function auditWrite(actorUid, action, target, details = {}) {
  return createWrite(`auditLogs/${randomId()}`, {
    actorUid,
    action,
    target,
    details,
    createdAt: new Date().toISOString()
  });
}

async function createAuditLog(token, actorUid, action, target, details = {}) {
  const id = randomId();
  await fsRequest(`/auditLogs?documentId=${encodeURIComponent(id)}`, token, {
    method: "POST",
    body: { fields: encodeFields({ actorUid, action, target, details, createdAt: new Date().toISOString() }) }
  });
}

function parseFound(result, path) {
  const item = result.find(x =>
    x.found?.name === documentName(path)
  );

  if (!item?.found) return null;

  return {
    name: item.found.name,
    updateTime: item.found.updateTime,
    data: decodeFields(item.found.fields || {})
  };
}

// -----------------------------------------------------
// FIREBASE AUTHENTICATION
// -----------------------------------------------------


async function verifyFirebaseUser(idToken, env, googleToken) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ idToken })
    }
  );

  const result = await response.json().catch(() => ({}));
  const firebaseUser = result.users?.[0];

  if (!response.ok || !firebaseUser || firebaseUser.disabled) {
    throw new ApiError(
      "Sesi login tidak valid atau akun dinonaktifkan.",
      401
    );
  }

  const uid = firebaseUser.localId;
  const profile = await getDocument(`users/${uid}`, googleToken);

  if (!profile || profile.data.aktif !== true) {
    throw new ApiError(
      "Akun tidak terdaftar atau sudah dinonaktifkan.",
      403
    );
  }

  const role = profile.data.role;

  if (!ROLES.includes(role)) {
    throw new ApiError(
      "Role akun harus Admin atau User. Hubungi Admin untuk memperbaikinya.",
      403
    );
  }

  return {
    uid,
    profile: {
      ...profile.data,
      role
    }
  };
}


function isCommittee(user) {
  return user.profile.role === "Admin";
}

function canReadReport(report, user) {
  if (isCommittee(user)) {
    return true;
  }

  return (
    user.profile.role === "User" &&
    report.createdBy === user.uid &&
    report.reporterMode === "teridentifikasi"
  );
}

// -----------------------------------------------------
// INTERNAL REPORT
// -----------------------------------------------------


async function submitInternalReport(data, user, token) {
  if (!INTERNAL_REPORT_ROLES.includes(user.profile.role)) {
    throw new ApiError("Anda tidak memiliki hak pelaporan.", 403);
  }

  const jenis = clean(data.jenis, 40, "Jenis laporan");

  if (![
    "Etik",
    "Disiplin",
    "Etik dan Disiplin"
  ].includes(jenis)) {
    throw new ApiError("Jenis laporan tidak valid.");
  }

  const unit = clean(data.unit, 120, "Unit");
  const uraian = clean(data.uraian, 6000, "Uraian");

  const tanggalKejadian = clean(
    data.tanggalKejadian,
    20,
    "Tanggal kejadian"
  );

  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalKejadian)) {
    throw new ApiError("Format tanggal kejadian tidak valid.");
  }

  // Identitas pihak yang dilaporkan bersifat opsional.
  const namaTerlapor = optionalText(
    data.namaTerlapor,
    120
  );

  const jabatanTerlapor = optionalText(
    data.jabatanTerlapor,
    160
  );

  const kontakTerlapor = optionalText(
    data.kontakTerlapor,
    160
  );

  const year = new Date().toLocaleString("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric"
  });

  const counterPath = `counters/LAP-${year}`;
  const reportId = randomId();

  for (let attempt = 0; attempt < 5; attempt++) {
    const transaction = await beginTransaction(token);

    const results = await batchGetDocuments(
      [counterPath],
      token,
      transaction
    );

    const current = parseFound(results, counterPath);
    const next = (current?.data.value || 0) + 1;
    const now = new Date().toISOString();

    const nomor = `LAP/${year}/${String(next).padStart(4, "0")}`;

    const report = {
      nomor,
      jenis,
      unit,
      uraian,
      tanggalKejadian,

      // Identitas pelapor
      namaPelapor:
        optionalText(data.namaPelapor, 120) ||
        user.profile.nama ||
        "",
      reporterMode: "teridentifikasi",
      kontakPelapor: optionalText(data.kontakPelapor, 160),

      // Identitas pihak yang dilaporkan
      namaTerlapor,
      kontakTerlapor,
      jabatanTerlapor,

      status: "Baru",
      source: "internal",
      createdBy: user.uid,
      assignedUids: [],
      auditVisible: false,
      evidence: [],
      createdAt: now
    };

    const counter = {
      value: next,
      updatedAt: now
    };

    const writes = [
      current
        ? updateWrite(counterPath, counter)
        : createWrite(counterPath, counter),

      createWrite(`reports/${reportId}`, report),

      auditWrite(
        user.uid,
        "INTERNAL_REPORT_SUBMITTED",
        reportId,
        { nomor }
      )
    ];

    try {
      await commitTransaction(writes, token, transaction);

      return {
        nomor,
        reportId
      };

    } catch (error) {
      if (
        error.code === "ABORTED" ||
        error.code === "FAILED_PRECONDITION"
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new ApiError(
    "Nomor laporan gagal dibuat. Silakan coba kembali.",
    503
  );
}

// -----------------------------------------------------
// CONVERT REPORT TO CASE
// -----------------------------------------------------


async function convertReport(data, user, token) {
  if (!CASE_MANAGER_ROLES.includes(user.profile.role)) {
    throw new ApiError("Tidak memiliki hak mengonversi laporan.", 403);
  }

  const reportId = clean(data.reportId, 150, "ID laporan");
  const caseId = randomId();

  for (let attempt = 0; attempt < 5; attempt++) {
    const transaction = await beginTransaction(token);

    const year = new Date().toLocaleString("en-US", {
      timeZone: "Asia/Jakarta",
      year: "numeric"
    });

    const counterPath = `counters/KAS-${year}`;

    const results = await batchGetDocuments(
      [`reports/${reportId}`, counterPath],
      token,
      transaction
    );

    const report = parseFound(results, `reports/${reportId}`);
    const currentCounter = parseFound(results, counterPath);

    if (!report || !canReadReport(report.data, user)) {
      throw new ApiError(
        "Laporan tidak ditemukan atau akses ditolak.",
        404
      );
    }

    if (report.data.deletedAt) {
      throw new ApiError(
        "Laporan yang sudah dihapus tidak dapat dikonversi.",
        400
      );
    }

    if (report.data.status !== "Baru") {
      throw new ApiError("Laporan sudah diproses.");
    }

    const currentValue = currentCounter?.data.value ?? 0;

    if (
      !Number.isSafeInteger(currentValue) ||
      currentValue < 0
    ) {
      throw new ApiError(
        "Data nomor urut kasus tidak valid.",
        500
      );
    }

    const next = currentValue + 1;
    const nomor = `KAS/${year}/${String(next).padStart(4, "0")}`;
    const now = new Date().toISOString();

    const caseData = {
      nomor,
      reportId,
      nomorLaporan: report.data.nomor || "",
      jenis: report.data.jenis || "",
      unit: report.data.unit || "",
      uraian: report.data.uraian || "",
      tanggalKejadian: report.data.tanggalKejadian || "",

      // Identitas pelapor
      namaPelapor: report.data.namaPelapor || "",
      kontakPelapor: report.data.kontakPelapor || "",

      // Identitas pihak yang dilaporkan
      namaTerlapor: report.data.namaTerlapor || "",
      kontakTerlapor: report.data.kontakTerlapor || "",
      jabatanTerlapor: report.data.jabatanTerlapor || "",

      evidence: Array.isArray(report.data.evidence)
        ? report.data.evidence
        : [],

      status: "Dalam Telaah",
      assignedUids: [],
      auditVisible: false,
      createdAt: now,
      createdBy: user.uid
    };

    const updatedReport = {
      ...report.data,
      status: "Dikonversi",
      caseId,
      updatedAt: now
    };

    const writes = [
      currentCounter
        ? updateWrite(counterPath, {
            value: next,
            updatedAt: now
          })
        : createWrite(counterPath, {
            value: next,
            updatedAt: now
          }),

      createWrite(`cases/${caseId}`, caseData),

      updateWrite(`reports/${reportId}`, updatedReport),

      auditWrite(
        user.uid,
        "REPORT_CONVERTED_TO_CASE",
        caseId,
        { nomor, reportId }
      )
    ];

    try {
      await commitTransaction(writes, token, transaction);

      return {
        caseId,
        nomor
      };

    } catch (error) {
      if (
        error.code === "ABORTED" ||
        error.code === "FAILED_PRECONDITION"
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new ApiError("Konversi gagal. Silakan coba kembali.", 503);
}


async function deleteReport(data, user, token) {
  const reportId = clean(data.reportId, 150, "ID laporan");

  for (let attempt = 0; attempt < 5; attempt++) {
    const transaction = await beginTransaction(token);

    const report = parseFound(
      await batchGetDocuments(
        [`reports/${reportId}`],
        token,
        transaction
      ),
      `reports/${reportId}`
    );

    if (!report || !canReadReport(report.data, user)) {
      throw new ApiError(
        "Laporan tidak ditemukan atau akses ditolak.",
        404
      );
    }

    if (report.data.deletedAt) {
      throw new ApiError("Laporan sudah dihapus.");
    }

    if (
      report.data.status !== "Baru" ||
      report.data.caseId
    ) {
      throw new ApiError(
        "Hanya laporan berstatus Baru yang belum dikonversi menjadi kasus yang dapat dihapus.",
        400
      );
    }

    const now = new Date().toISOString();

    const updatedReport = {
      ...report.data,
      deletedAt: now,
      deletedBy: user.uid,
      updatedAt: now
    };

    const writes = [
      updateWrite(
        `reports/${reportId}`,
        updatedReport
      ),

      auditWrite(
        user.uid,
        "REPORT_SOFT_DELETED",
        reportId,
        {
          nomor: report.data.nomor || "",
          status: report.data.status || "",
          deletedAt: now
        }
      )
    ];

    try {
      await commitTransaction(writes, token, transaction);

      return {
        reportId,
        message: "Laporan berhasil dihapus."
      };

    } catch (error) {
      if (
        error.code === "ABORTED" ||
        error.code === "FAILED_PRECONDITION"
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new ApiError(
    "Penghapusan gagal. Silakan coba kembali.",
    503
  );
}

// -----------------------------------------------------
// CASE STATUS
// -----------------------------------------------------

async function updateCaseStatus(data, user, token) {
  if (!CASE_MANAGER_ROLES.includes(user.profile.role)) {
    throw new ApiError("Tidak memiliki hak mengubah status kasus.", 403);
  }

  const caseId = clean(data.caseId, 150, "ID kasus");
  const status = clean(data.status, 60, "Status");
  const catatan = clean(data.catatan, 1000, "Catatan tindak lanjut");
  const allowed = [
    "Dalam Telaah", "Pemeriksaan", "Menunggu Klarifikasi",
    "Rekomendasi", "Selesai", "Ditutup"
  ];

  if (!allowed.includes(status)) throw new ApiError("Status tidak valid.");

  for (let attempt = 0; attempt < 5; attempt++) {
    const transaction = await beginTransaction(token);
    const current = parseFound(
      await batchGetDocuments([`cases/${caseId}`], token, transaction),
      `cases/${caseId}`
    );

    if (!current) throw new ApiError("Kasus tidak ditemukan.", 404);

    const previousStatus = current.data.status || "Dalam Telaah";
    if (previousStatus === status) {
      throw new ApiError("Status baru sama dengan status saat ini.");
    }

    const now = new Date().toISOString();
    const history = Array.isArray(current.data.riwayatStatus)
      ? current.data.riwayatStatus
      : [];

    const updated = {
      ...current.data,
      status,
      updatedAt: now,
      updatedBy: user.uid,
      riwayatStatus: [
        ...history,
        {
          status,
          statusSebelumnya: previousStatus,
          catatan,
          waktu: now,
          oleh: user.uid
        }
      ].slice(-100)
    };

    try {
      await commitTransaction([
        updateWrite(`cases/${caseId}`, updated),
        auditWrite(user.uid, "CASE_STATUS_UPDATED", caseId, {
          status,
          statusSebelumnya: previousStatus,
          catatan
        })
      ], token, transaction);

      return { ok: true };
    } catch (error) {
      if (error.code === "ABORTED" || error.code === "FAILED_PRECONDITION") {
        continue;
      }
      throw error;
    }
  }

  throw new ApiError("Perubahan status gagal karena ada perubahan bersamaan. Coba kembali.", 503);
}

async function countActiveAdmins(token, transaction) {
  const result = await fsRequest(":runQuery", token, {
    method: "POST",
    body: {
      structuredQuery: {
        from: [{ collectionId: "users" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              { fieldFilter: { field: { fieldPath: "role" }, op: "EQUAL", value: { stringValue: "Admin" } } },
              { fieldFilter: { field: { fieldPath: "aktif" }, op: "EQUAL", value: { booleanValue: true } } }
            ]
          }
        }
      },
      transaction
    }
  });

  return Array.isArray(result)
    ? result.filter(item => item.document).length
    : 0;
}

// -----------------------------------------------------
// USER ROLE
// -----------------------------------------------------

async function setUserRole(data, user, token) {
  if (user.profile.role !== "Admin") {
    throw new ApiError("Hanya Admin yang dapat mengubah role.", 403);
  }

  const uid = clean(data.uid, 150, "UID");
  const role = clean(data.role, 50, "Role");

  if (!ROLES.includes(role)) throw new ApiError("Role tidak dikenal.");
  if (uid === user.uid) {
    throw new ApiError("Admin tidak dapat mengubah role akunnya sendiri.");
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const transaction = await beginTransaction(token);
    const results = await batchGetDocuments([`users/${uid}`], token, transaction);
    const current = parseFound(results, `users/${uid}`);

    if (!current) throw new ApiError("Pengguna tidak ditemukan.", 404);

    if (
      current.data.role === "Admin" &&
      current.data.aktif === true &&
      role !== "Admin"
    ) {
      // Query jumlah Admin dibaca dalam transaksi yang sama.
      // Perubahan bersamaan pada dokumen Admin akan memicu konflik transaksi.
      const totalAdmin = await countActiveAdmins(token, transaction);
      if (totalAdmin <= 1) {
        throw new ApiError(
          "Admin aktif terakhir tidak dapat diubah menjadi User.",
          400
        );
      }
    }

    const updated = {
      ...current.data,
      role,
      updatedAt: new Date().toISOString()
    };

    try {
      await commitTransaction([
        updateWrite(`users/${uid}`, updated),
        auditWrite(user.uid, "USER_ROLE_SET", uid, { role })
      ], token, transaction);

      return { ok: true };
    } catch (error) {
      if (error.code === "ABORTED" || error.code === "FAILED_PRECONDITION") {
        continue;
      }
      throw error;
    }
  }

  throw new ApiError("Perubahan role gagal karena ada perubahan bersamaan. Coba kembali.", 503);
}

async function validateImageFile(file) {
  const bytes = new Uint8Array(
    await file.slice(0, 12).arrayBuffer()
  );

  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xFF &&
    bytes[1] === 0xD8 &&
    bytes[2] === 0xFF;

  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4E &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0D &&
    bytes[5] === 0x0A &&
    bytes[6] === 0x1A &&
    bytes[7] === 0x0A;

  const isWebp =
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";

  if (
    (file.type === "image/jpeg" && isJpeg) ||
    (file.type === "image/png" && isPng) ||
    (file.type === "image/webp" && isWebp)
  ) {
    return true;
  }

  throw new ApiError(
    "Isi file tidak sesuai dengan format foto yang diizinkan."
  );
}


// -----------------------------------------------------
// REPORT LIST & DETAIL - ADMIN / KOMITE
// -----------------------------------------------------


async function getReportList(url, user, token) {
  const isAdmin = user.profile.role === "Admin";
  const isUser = user.profile.role === "User";
  if (!isAdmin && !isUser) {
    throw new ApiError("Tidak memiliki hak melihat laporan.", 403);
  }

  const requestedSize = Number(url.searchParams.get("pageSize") || 30);
  const pageSize = Number.isInteger(requestedSize)
    ? Math.min(Math.max(requestedSize, 1), 50)
    : 30;

  let rawDocuments = [];
  let nextPageToken = null;

  if (isUser) {
    // Filter dilakukan Firestore sebelum limit, bukan setelah mengambil laporan global.
    const result = await fsRequest(":runQuery", token, {
      method: "POST",
      body: {
        structuredQuery: {
          from: [{ collectionId: "reports" }],
          where: {
            compositeFilter: {
              op: "AND",
              filters: [
                { fieldFilter: { field: { fieldPath: "createdBy" }, op: "EQUAL", value: { stringValue: user.uid } } },
                { fieldFilter: { field: { fieldPath: "reporterMode" }, op: "EQUAL", value: { stringValue: "teridentifikasi" } } }
              ]
            }
          },
          orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
          limit: pageSize + 1
        }
      }
    });

    rawDocuments = (Array.isArray(result) ? result : [])
      .filter(item => item.document)
      .map(item => item.document);

    if (rawDocuments.length > pageSize) {
      rawDocuments = rawDocuments.slice(0, pageSize);
      nextPageToken = "more";
    }
  } else {
    const params = new URLSearchParams({
      pageSize: String(pageSize),
      orderBy: "createdAt desc"
    });
    const pageToken = url.searchParams.get("pageToken");
    if (pageToken) params.set("pageToken", pageToken);

    const result = await fsRequest(`/reports?${params.toString()}`, token);
    rawDocuments = result.documents || [];
    nextPageToken = result.nextPageToken || null;
  }

  const reports = rawDocuments.map(document => {
    const data = decodeFields(document.fields || {});
    const parts = document.name.split("/");
    return {
      reportId: parts[parts.length - 1],
      createdBy: data.createdBy || "",
      nomor: data.nomor || "-",
      jenis: data.jenis || "-",
      unit: data.unit || "-",
      tanggalKejadian: data.tanggalKejadian || "-",
      namaPelapor: data.namaPelapor || "Tidak dicantumkan",
      kontakPelapor: data.kontakPelapor || "",
      namaTerlapor: data.namaTerlapor || "",
      kontakTerlapor: data.kontakTerlapor || "",
      jabatanTerlapor: data.jabatanTerlapor || "",
      reporterMode: data.reporterMode || "",
      status: data.status || "Baru",
      source: data.source || "",
      createdAt: data.createdAt || "",
      evidenceCount: Array.isArray(data.evidence) ? data.evidence.length : 0,
      deletedAt: data.deletedAt || null
    };
  }).filter(report => !report.deletedAt);

  const safeReports = isAdmin
    ? reports.map(({ createdBy, ...report }) => report)
    : reports.map(report => ({
        reportId: report.reportId,
        nomor: report.nomor,
        jenis: report.jenis,
        unit: report.unit,
        tanggalKejadian: report.tanggalKejadian,
        namaPelapor: report.namaPelapor,
        status: report.status,
        createdAt: report.createdAt
      }));

  return { reports: safeReports, nextPageToken };
}

async function getReportDetail(url, user, token) {
  const reportId = clean(
    url.searchParams.get("reportId"),
    150,
    "ID laporan"
  );

  const report = await getDocument(
    `reports/${reportId}`,
    token
  );

  if (!report || !canReadReport(report.data, user) || report.data.deletedAt) {
    throw new ApiError(
      "Laporan tidak ditemukan atau akses ditolak.",
      404
    );
  }

  const data = report.data;

  return {
    report: {
      reportId,
      nomor: data.nomor || "-",
      jenis: data.jenis || "-",
      unit: data.unit || "-",
      uraian: data.uraian || "",
      tanggalKejadian: data.tanggalKejadian || "",
      namaPelapor: data.namaPelapor || "",
      reporterMode: data.reporterMode || "",
      kontakPelapor: data.kontakPelapor || "",
      namaTerlapor: data.namaTerlapor || "",
      kontakTerlapor: data.kontakTerlapor || "",
      jabatanTerlapor: data.jabatanTerlapor || "",
      status: data.status || "Baru",
      source: data.source || "",
      createdAt: data.createdAt || "",
      updatedAt: data.updatedAt || "",
      caseId: data.caseId || null,
      evidence: Array.isArray(data.evidence)
        ? data.evidence.map(item => ({
            id: item.id,
            contentType: item.contentType,
            size: item.size,
            createdAt: item.createdAt
          }))
        : []
    }
  };
}

// -----------------------------------------------------
// PRIVATE PHOTO EVIDENCE - KV
// -----------------------------------------------------


async function uploadEvidence(request, user, token, env) {
  if (!env.BUKTI_KV) {
    throw new ApiError("Penyimpanan bukti belum dikonfigurasi.", 500);
  }

  if (!INTERNAL_REPORT_ROLES.includes(user.profile.role)) {
    throw new ApiError("Tidak memiliki hak mengunggah bukti.", 403);
  }

  const form = await request.formData();
  const reportId = clean(form.get("reportId"), 150, "ID laporan");
  const file = form.get("file");

  if (!(file instanceof File)) {
    throw new ApiError("File foto tidak ditemukan.");
  }

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (!allowedTypes.includes(file.type)) {
    throw new ApiError("Format foto harus JPG, PNG, atau WebP.");
  }

  if (file.size < 1 || file.size > MAX_PHOTO_BYTES) {
    throw new ApiError("Ukuran foto maksimal 1,5 MB.");
  }

  await validateImageFile(file);

  const evidenceId = randomId();
  const key = `evidence/${reportId}/${evidenceId}`;
  const bytes = await file.arrayBuffer();

  const metadata = {
    id: evidenceId,
    contentType: file.type,
    size: file.size,
    createdAt: new Date().toISOString(),
    uploadedBy: user.uid
  };

  await env.BUKTI_KV.put(key, bytes, {
    metadata: {
      reportId,
      evidenceId,
      contentType: file.type
    }
  });

  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const transaction = await beginTransaction(token);

      const results = await batchGetDocuments(
        [`reports/${reportId}`],
        token,
        transaction
      );

      const report = parseFound(results, `reports/${reportId}`);

      if (!report) {
        throw new ApiError("Laporan tidak ditemukan.", 404);
      }

      if (!canReadReport(report.data, user)) {
        throw new ApiError("Tidak memiliki akses ke laporan ini.", 403);
      }

      if (report.data.deletedAt) {
        throw new ApiError(
          "Bukti tidak dapat ditambahkan ke laporan yang sudah dihapus.",
          400
        );
      }

      if (report.data.status !== "Baru") {
        throw new ApiError(
          "Bukti hanya dapat ditambahkan saat laporan berstatus Baru."
        );
      }

      const evidence = Array.isArray(report.data.evidence)
        ? report.data.evidence
        : [];

      if (evidence.length >= MAX_PHOTOS_PER_REPORT) {
        throw new ApiError("Maksimal 3 foto untuk setiap laporan.");
      }

      const updatedReport = {
        ...report.data,
        evidence: [...evidence, metadata],
        updatedAt: new Date().toISOString()
      };

      try {
        await commitTransaction([
          updateWrite(`reports/${reportId}`, updatedReport),
          auditWrite(
            user.uid,
            "EVIDENCE_UPLOADED",
            reportId,
            { evidenceId }
          )
        ], token, transaction);

        return {
          evidenceId,
          contentType: file.type,
          size: file.size
        };

      } catch (error) {
        if (
          error.code === "ABORTED" ||
          error.code === "FAILED_PRECONDITION"
        ) {
          continue;
        }

        throw error;
      }
    }

    throw new ApiError(
      "Penyimpanan bukti gagal karena terjadi perubahan bersamaan. Silakan coba kembali.",
      503
    );

  } catch (error) {
    await env.BUKTI_KV.delete(key);
    throw error;
  }
}

async function getEvidence(request, user, token, env) {
  if (!env.BUKTI_KV) {
    throw new ApiError("Penyimpanan bukti belum dikonfigurasi.", 500);
  }

  const url = new URL(request.url);
  const reportId = clean(
    url.searchParams.get("reportId"),
    150,
    "ID laporan"
  );
  const evidenceId = clean(
    url.searchParams.get("evidenceId"),
    80,
    "ID bukti"
  );

  const report = await getDocument(`reports/${reportId}`, token);

  if (!report || !canReadReport(report.data, user) || report.data.deletedAt) {
    throw new ApiError("Bukti tidak ditemukan atau akses ditolak.", 404);
  }

  const evidence = Array.isArray(report.data.evidence)
    ? report.data.evidence
    : [];

  const item = evidence.find(x => x.id === evidenceId);

  if (!item) {
    throw new ApiError("Bukti tidak ditemukan.", 404);
  }

  const key = `evidence/${reportId}/${evidenceId}`;
  const object = await env.BUKTI_KV.get(key, {
    type: "arrayBuffer"
  });

  if (!object) {
    throw new ApiError("File bukti tidak tersedia.", 404);
  }

  const contentType = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ].includes(item.contentType)
    ? item.contentType
    : "application/octet-stream";

  return new Response(object, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(object.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline"
    }
  });
}


async function enforcePublicRateLimit(request, env) {
  if (!env.BUKTI_KV) throw new ApiError("Layanan pelaporan publik belum dikonfigurasi.", 503);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `public-rate:${ip}`;
  const current = Number(await env.BUKTI_KV.get(key)) || 0;
  if (current >= 5) throw new ApiError("Batas pengiriman tercapai. Coba kembali beberapa menit lagi.", 429);
  await env.BUKTI_KV.put(key, String(current + 1), { expirationTtl: 600 });
}

async function submitPublicReport(data, token) {
  const jenis = clean(data.jenis, 40, "Jenis laporan");
  if (!["Etik", "Disiplin", "Etik dan Disiplin"].includes(jenis)) throw new ApiError("Jenis laporan tidak valid.");
  const unit = clean(data.unit, 120, "Unit");
  const uraian = clean(data.uraian, 6000, "Uraian");
  const tanggalKejadian = clean(data.tanggalKejadian, 20, "Tanggal kejadian");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalKejadian)) throw new ApiError("Tanggal kejadian tidak valid.");
  const reporterMode = data.modePelapor === "teridentifikasi" ? "teridentifikasi" : "anonim";
  const namaPelapor = reporterMode === "teridentifikasi" ? clean(data.namaPelapor, 120, "Nama pelapor") : "Anonim";
  const year = new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta", year: "numeric" });
  const counterPath = `counters/LAP-${year}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const transaction = await beginTransaction(token);
    try {
      const found = parseFound(await batchGetDocuments([counterPath], token, transaction), counterPath);
      const next = (Number(found?.data?.value) || 0) + 1;
      const nomor = `LAP/${year}/${String(next).padStart(4, "0")}`;
      const reportId = randomId();
      const report = { nomor, jenis, unit, uraian, tanggalKejadian, reporterMode, namaPelapor, kontakPelapor: reporterMode === "teridentifikasi" ? optionalText(data.kontakPelapor, 160) : "", pihakTerkait: optionalText(data.pihakTerkait, 500), status: "Baru", source: "public", createdAt: new Date().toISOString(), createdBy: null, assignedUids: [], auditVisible: false };
      const writes = [found ? updateWrite(counterPath, { value: next, updatedAt: new Date().toISOString() }) : createWrite(counterPath, { value: next, updatedAt: new Date().toISOString() }), createWrite(`reports/${reportId}`, report), auditWrite("public", "PUBLIC_REPORT_SUBMITTED", reportId, { nomor })];
      await commitTransaction(writes, token, transaction);
      return { nomor };
    } catch (error) {
      if (error.code === "ABORTED" || error.code === "FAILED_PRECONDITION") continue;
      throw error;
    }
  }
  throw new ApiError("Nomor laporan belum dapat dibuat karena ada pengiriman bersamaan. Silakan coba kembali.", 503);
}

// -----------------------------------------------------
// ADMIN WORKFLOWS (Firestore REST + KV, tanpa Firebase Functions)
// -----------------------------------------------------
async function requireAdmin(user) {
  if (user?.profile?.role !== "Admin" || user.profile.aktif !== true) {
    throw new ApiError("Hanya Admin yang dapat melakukan tindakan ini.", 403);
  }
}

async function listCollection(collectionName, token, max = 100) {
  const allowed = ["cases", "documents", "programs", "evaluations", "users", "reports"];
  if (!allowed.includes(collectionName)) throw new ApiError("Koleksi tidak diizinkan.", 400);
  const response = await fsRequest(`/${collectionName}?pageSize=${max}`, token);
  const docs = response.documents || [];
  return docs.slice(0, max).map(d => ({
    id: d.name.split("/").pop(),
    ...decodeFields(d.fields || {})
  })).sort((a, b) => Date.parse(b.createdAt || b.updatedAt || 0) - Date.parse(a.createdAt || a.updatedAt || 0));
}

async function saveAdminRecord(collectionName, data, user, token) {
  await requireAdmin(user);
  const allowed = {
    programs: { required: ["nama", "periode", "pic", "status"], statuses: ["Direncanakan", "Berjalan", "Selesai", "Ditunda"] },
    evaluations: { required: ["judul", "periode", "indikator", "target", "capaian"] }
  };
  const spec = allowed[collectionName];
  if (!spec) throw new ApiError("Jenis data tidak diizinkan.");
  const d = data || {};
  for (const field of spec.required) clean(String(d[field] ?? ""), field === "judul" || field === "nama" ? 160 : 3000, field);
  if (spec.statuses && !spec.statuses.includes(d.status)) throw new ApiError("Status program tidak valid.");
  const id = optionalText(d.id, 150) || randomId();
  const old = await getDocument(`${collectionName}/${id}`, token);
  if (d.id && !old) throw new ApiError("Data tidak ditemukan.", 404);
  const payload = { ...d, id: undefined, createdAt: old?.data.createdAt || new Date().toISOString(), createdBy: old?.data.createdBy || user.uid, updatedAt: new Date().toISOString(), updatedBy: user.uid };
  delete payload.id;
  if (old) await fsRequest(`/${collectionName}/${id}`, token, { method: "PATCH", body: { fields: encodeFields(payload) } });
  else await commitTransaction([createWrite(`${collectionName}/${id}`, payload)], token);
  await createAuditLog(token, user.uid, `${collectionName.toUpperCase()}_${old ? "UPDATED" : "CREATED"}`, id);
  return { ok: true, id };
}

async function deleteAdminRecord(collectionName, id, user, token) {
  await requireAdmin(user);
  if (!["programs", "evaluations"].includes(collectionName)) throw new ApiError("Jenis data tidak diizinkan.");
  clean(id, 150, "ID");
  const old = await getDocument(`${collectionName}/${id}`, token);
  if (!old) throw new ApiError("Data tidak ditemukan.", 404);
  await fsRequest(`/${collectionName}/${id}`, token, { method: "DELETE" });
  await createAuditLog(token, user.uid, `${collectionName.toUpperCase()}_DELETED`, id);
  return { ok: true };
}

async function manageDocument(action, data, user, token, env) {
  await requireAdmin(user);
  if (!env.BUKTI_KV) throw new ApiError("Penyimpanan dokumen belum dikonfigurasi.", 500);
  if (action === "list") return { documents: await listCollection("documents", token, 100) };
  if (action === "upload") {
    const nama = clean(data.nama, 160, "Nama dokumen");
    const kategori = clean(data.kategori, 80, "Kategori");
    const fileName = clean(data.fileName, 200, "Nama file");
    const contentType = clean(data.contentType || "application/octet-stream", 120, "Tipe file");
    const base64 = clean(data.base64, 6000000, "File");
    const size = Math.floor(base64.length * 3 / 4);
    if (size > 4 * 1024 * 1024) throw new ApiError("Ukuran file maksimal 4 MB.");
    if (!/^[A-Za-z0-9._ -]+$/.test(fileName)) throw new ApiError("Nama file tidak valid.");
    const id = randomId();
    const storageKey = `document:${id}`;
    await env.BUKTI_KV.put(storageKey, base64, { metadata: { contentType, fileName } });
    const payload = { nama, kategori, nomor: optionalText(data.nomor, 100), versi: optionalText(data.versi, 40), fileName, contentType, size, storageKey, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: user.uid, updatedBy: user.uid };
    try { await commitTransaction([createWrite(`documents/${id}`, payload)], token); }
    catch (e) { await env.BUKTI_KV.delete(storageKey); throw e; }
    return { ok: true, id };
  }
  const id = clean(data.id, 150, "ID dokumen");
  const doc = await getDocument(`documents/${id}`, token);
  if (!doc) throw new ApiError("Dokumen tidak ditemukan.", 404);
  if (action === "download") {
    const base64 = await env.BUKTI_KV.get(doc.data.storageKey);
    if (!base64) throw new ApiError("File dokumen tidak ditemukan di penyimpanan.", 404);
    return { base64, fileName: doc.data.fileName, contentType: doc.data.contentType || "application/octet-stream" };
  }
  if (action === "delete") {
    await env.BUKTI_KV.delete(doc.data.storageKey);
    await fsRequest(`/documents/${id}`, token, { method: "DELETE" });
    return { ok: true };
  }
  throw new ApiError("Aksi dokumen tidak dikenal.");
}

async function createManagedUser(data, user, token, env) {
  await requireAdmin(user);
  const email = clean(data.email, 160, "Email").toLowerCase();
  const nama = clean(data.nama, 120, "Nama");
  const password = data.password;
  const role = clean(data.role, 20, "Role");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError("Format email tidak valid.");
  if (typeof password !== "string" || password.length < 8 || password.length > 128) throw new ApiError("Password minimal 8 karakter.");
  if (!ROLES.includes(role)) throw new ApiError("Role hanya boleh Admin atau User.");
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ email, password, displayName: nama }) });
  const created = await response.json().catch(() => ({}));
  if (!response.ok || !created.localId) throw new ApiError(created.error?.message === "EMAIL_EXISTS" ? "Email sudah terdaftar." : "Gagal membuat akun Firebase Auth.", 400);
  const uid = created.localId;
  try {
    await commitTransaction([createWrite(`users/${uid}`, { uid, email, nama, role, aktif: true, createdAt: new Date().toISOString(), createdBy: user.uid, updatedAt: new Date().toISOString() })], token);
  } catch (e) {
    await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:delete?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ localId: uid }) }).catch(() => {});
    throw new ApiError("Pembuatan profil akun gagal. Sistem telah mencoba membatalkan akun Auth yang baru dibuat; verifikasi Firebase Authentication sebelum mengulang.", 500);
  }
  return { ok: true, uid, email };
}

async function setManagedUserActive(data, user, token, env) {
  await requireAdmin(user);
  const uid = clean(data.uid, 150, "UID");
  const aktif = data.aktif;
  if (typeof aktif !== "boolean") throw new ApiError("Status akun tidak valid.");
  if (uid === user.uid && !aktif) throw new ApiError("Admin tidak dapat menonaktifkan akunnya sendiri.");
  const snap = await getDocument(`users/${uid}`, token);
  if (!snap) throw new ApiError("Akun tidak ditemukan.", 404);
  if (!aktif && snap.data.role === "Admin") {
    const all = await listCollection("users", token, 1000);
    if (all.filter(x => x.role === "Admin" && x.aktif === true).length <= 1) throw new ApiError("Admin aktif terakhir tidak dapat dinonaktifkan.");
  }
  await fsRequest(`/users/${uid}`, token, { method: "PATCH", body: { fields: encodeFields({ ...snap.data, aktif, updatedAt: new Date().toISOString() }) } });
  // Disable Auth user via Identity Toolkit Admin REST OAuth.
  const oauth = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ localId: uid, disableUser: !aktif }) });
  if (!oauth.ok) {
    await fsRequest(`/users/${uid}`, token, { method: "PATCH", body: { fields: encodeFields({ ...snap.data, updatedAt: new Date().toISOString() }) } }).catch(() => {});
    throw new ApiError("Gagal memperbarui status Firebase Authentication. Status profil dipulihkan.", 502);
  }
  await createAuditLog(token, user.uid, aktif ? "USER_ACTIVATED" : "USER_DEACTIVATED", uid, { email: snap.data.email || "" }).catch(() => {});
  return { ok: true, aktif };
}

async function listManagedUsers(user, token) {
  await requireAdmin(user);
  const users = await listCollection("users", token, 1000);
  users.forEach(x => { if (!ROLES.includes(x.role)) throw new ApiError(`Role akun ${x.email || x.id} tidak valid.`); });
  users.sort((a,b) => String(a.nama||"").localeCompare(String(b.nama||""), "id"));
  return { users: users.map(x => ({ uid: x.id, nama: x.nama || "", email: x.email || "", role: x.role, aktif: x.aktif === true, createdAt: x.createdAt || null, updatedAt: x.updatedAt || null })), total: users.length, totalAktif: users.filter(x=>x.aktif===true).length, totalNonaktif: users.filter(x=>x.aktif!==true).length };
}

// -----------------------------------------------------
// HTTP HELPERS
// -----------------------------------------------------

function jsonResponse(data, status = 200, origin = "") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };

  if (origin === ALLOWED_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }

  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);

  if (origin === ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set(
      "Access-Control-Expose-Headers",
      "Content-Type, Content-Length"
    );
  }

  return new Response(response.body, {
    status: response.status,
    headers
  });
}

async function readBody(request, maxLength = 20000) {
  const text = await request.text();

  if (text.length > maxLength) {
    throw new ApiError("Ukuran data terlalu besar.", 413);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("Format JSON tidak valid.");
  }
}

function errorResponse(error, origin) {
  console.error("SI-ETIK API:", error);

  const status = error.status ||
    (error.message?.includes("ABORTED") ? 409 : 400);

  return jsonResponse({
    success: false,
    error: error.message || "Terjadi kesalahan pada server."
  }, status, origin);
}

// -----------------------------------------------------
// MAIN ROUTER
// -----------------------------------------------------

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (origin && origin !== ALLOWED_ORIGIN) {
      return jsonResponse({
        success: false,
        error: "Origin tidak diizinkan."
      }, 403);
    }

    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) {
        return new Response(null, { status: 403 });
      }

      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      if (request.method !== "GET") {
        return jsonResponse({
          error: "Metode tidak diizinkan."
        }, 405, origin);
      }

      try {
        const token = await getGoogleAccessToken(env);

        const response = await fetch(
          `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        );

        const database = await response.json();

        if (!response.ok) {
          throw new Error(
            database.error?.message || "Firestore tidak dapat diakses."
          );
        }

        return jsonResponse({
          service: "SI-ETIK API",
          status: "ok",
          authentication: "configured",
          firestore: "connected",
          photoStorage: env.BUKTI_KV ? "configured" : "not_configured",
          project: PROJECT_ID,
          database: database.name
        }, 200, origin);
      } catch (error) {
        return errorResponse(error, origin);
      }
    }

    if (!["GET", "POST"].includes(request.method)) {
      return jsonResponse({
        error: "Metode tidak diizinkan."
      }, 405, origin);
    }

    try {
      if (url.pathname === "/public-report" && request.method === "POST") {
        await enforcePublicRateLimit(request, env);
        const token = await getGoogleAccessToken(env);
        const data = await readBody(request);
        const result = await submitPublicReport(data, token);
        return jsonResponse({ success: true, ...result }, 200, origin);
      }
      const authorization =
        request.headers.get("Authorization") || "";

      const idToken = authorization.startsWith("Bearer ")
        ? authorization.slice(7).trim()
        : "";

      if (!idToken) {
        throw new ApiError("Sesi login diperlukan.", 401);
      }

      const googleToken = await getGoogleAccessToken(env);
      const user = await verifyFirebaseUser(
        idToken,
        env,
        googleToken
      );

      if (url.pathname === "/auth-check" && request.method === "POST") {
        return jsonResponse({
          success: true,
          authenticated: true,
          uid: user.uid,
          role: user.profile.role,
          active: true
        }, 200, origin);
      }

      
      if (url.pathname === "/cases" && request.method === "GET") {
        await requireAdmin(user);
        return jsonResponse({ success: true, cases: await listCollection("cases", googleToken, 500) }, 200, origin);
      }
      if (url.pathname === "/case" && request.method === "GET") {
        await requireAdmin(user);
        const id = clean(url.searchParams.get("id") || "", 150, "ID kasus");
        const item = await getDocument(`cases/${id}`, googleToken);
        if (!item) throw new ApiError("Kasus tidak ditemukan.", 404);
        return jsonResponse({ success: true, case: { id, ...item.data } }, 200, origin);
      }
      if (url.pathname === "/report-by-case" && request.method === "GET") {
        await requireAdmin(user);
        const caseId = clean(url.searchParams.get("caseId") || "", 150, "ID kasus");
        const cases = await listCollection("cases", googleToken, 500);
        const item = cases.find(x => x.id === caseId);
        if (item?.reportId) return jsonResponse({ success: true, reportId: item.reportId }, 200, origin);
        const reports = await listCollection("reports", googleToken, 1000).catch(() => []);
        const found = reports.find(x => x.caseId === caseId);
        return jsonResponse({ success: true, reportId: found?.id || "" }, 200, origin);
      }
      if (url.pathname === "/admin-counts" && request.method === "GET") {
        await requireAdmin(user);
        const [cases, documents, programs] = await Promise.all(["cases", "documents", "programs"].map(c => listCollection(c, googleToken, 500)));
        return jsonResponse({ success: true, cases: cases.length, documents: documents.length, programs: programs.length }, 200, origin);
      }
      if (url.pathname === "/documents" && request.method === "GET") {
        const result = await manageDocument("list", {}, user, googleToken, env);
        return jsonResponse({ success: true, ...result }, 200, origin);
      }
      if (url.pathname === "/programs" && request.method === "GET") {
        await requireAdmin(user);
        return jsonResponse({ success: true, programs: await listCollection("programs", googleToken, 100) }, 200, origin);
      }
      if (url.pathname === "/evaluations" && request.method === "GET") {
        await requireAdmin(user);
        return jsonResponse({ success: true, evaluations: await listCollection("evaluations", googleToken, 100) }, 200, origin);
      }
      if (url.pathname === "/managed-users" && request.method === "GET") {
        return jsonResponse({ success: true, ...(await listManagedUsers(user, googleToken)) }, 200, origin);
      }

      if (url.pathname === "/reports" && request.method === "GET") {
        const result = await getReportList(
          url,
          user,
          googleToken
        );

        return jsonResponse({
          success: true,
          ...result
        }, 200, origin);
      }

      if (url.pathname === "/report" && request.method === "GET") {
        const result = await getReportDetail(
          url,
          user,
          googleToken
        );

        return jsonResponse({
          success: true,
          ...result
        }, 200, origin);
      }

      if (url.pathname === "/evidence" && request.method === "GET") {
        const response = await getEvidence(
          request,
          user,
          googleToken,
          env
        );

        return withCors(response, origin);
      }

      if (request.method !== "POST") {
        throw new ApiError("Metode tidak diizinkan.", 405);
      }

      let result;

      if (url.pathname === "/documents") {
        const data = await readBody(request, 6000000);
        result = await manageDocument(data.action, data, user, googleToken, env);
      } else if (url.pathname === "/programs") {
        const data = await readBody(request);
        result = data.action === "delete" ? await deleteAdminRecord("programs", data.id, user, googleToken) : await saveAdminRecord("programs", data, user, googleToken);
      } else if (url.pathname === "/evaluations") {
        const data = await readBody(request);
        result = data.action === "delete" ? await deleteAdminRecord("evaluations", data.id, user, googleToken) : await saveAdminRecord("evaluations", data, user, googleToken);
      } else if (url.pathname === "/create-user") {
        const data = await readBody(request);
        result = await createManagedUser(data, user, googleToken, env);
      } else if (url.pathname === "/set-user-active") {
        const data = await readBody(request);
        result = await setManagedUserActive(data, user, googleToken, env);
      } else if (url.pathname === "/internal-report") {
        const data = await readBody(request);
        result = await submitInternalReport(data, user, googleToken);

      } else if (url.pathname === "/convert-report") {
        const data = await readBody(request);
        result = await convertReport(data, user, googleToken);

      } else if (url.pathname === "/delete-report") {
        const data = await readBody(request);
        result = await deleteReport(data, user, googleToken);

      } else if (url.pathname === "/case-status") {
        const data = await readBody(request);
        result = await updateCaseStatus(data, user, googleToken);

      } else if (url.pathname === "/set-user-role") {
        const data = await readBody(request);
        result = await setUserRole(data, user, googleToken);

      } else if (url.pathname === "/upload-evidence") {
        const length = Number(
          request.headers.get("Content-Length") || 0
        );

        if (length && length > 5500000) {
          throw new ApiError("Ukuran permintaan terlalu besar.", 413);
        }

        result = await uploadEvidence(
          request,
          user,
          googleToken,
          env
        );

      } else {
        throw new ApiError("Endpoint tidak ditemukan.", 404);
      }

      return jsonResponse({
        success: true,
        ...result
      }, 200, origin);

    } catch (error) {
      return errorResponse(error, origin);
    }
  }
};
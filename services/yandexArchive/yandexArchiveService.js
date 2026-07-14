/**
 * Archive of TTN photos + monthly Excel reports on Yandex Disk.
 *
 * Structure:
 *   /ReestrPro/Водители/Водитель - {Name}/{dd.mm.yy}/ТТН_*.jpg
 *   /ReestrPro/Реестры/{YYYY-MM}_реестр_перевозок.xlsx
 *   /ReestrPro/Финансы/{YYYY-MM}_финансовый_отчёт.xlsx
 *   /ReestrPro/Зарплата/{YYYY-MM}_вахта1|2_зарплатный_табель.xlsx
 */
const path = require('path');
const db = require('../../database');
const { readUploadBuffer } = require('../../utils/uploadsStorage');
const {
  fetchCompletedTrips,
  fetchExpenses,
  buildRegistryWorkbook,
  buildFinancialWorkbook,
  workbookToBuffer,
} = require('../../utils/transportExports');
const { buildSalaryTimesheetWorkbook } = require('../../utils/salaryExport');
const {
  shiftsDueOnCalendarDay,
  listSalaryShiftsForArchiveSync,
} = require('../../utils/salaryShiftPeriods');
const {
  uploadBufferToYandexDisk,
} = require('../backup/yandexDisk');

function getYandexArchiveConfig() {
  const token =
    process.env.YANDEX_DISK_TOKEN || process.env.BACKUP_YANDEX_DISK_TOKEN || '';
  const root = (
    process.env.YANDEX_DISK_ROOT ||
    process.env.YANDEX_ARCHIVE_ROOT ||
    '/ReestrPro'
  ).replace(/\/$/, '');

  return {
    enabled: Boolean(token) && process.env.YANDEX_ARCHIVE_ENABLED !== 'false',
    token,
    root,
    driversFolder: process.env.YANDEX_ARCHIVE_DRIVERS || 'Водители',
    registryFolder: process.env.YANDEX_ARCHIVE_REGISTRY || 'Реестры',
    financeFolder: process.env.YANDEX_ARCHIVE_FINANCE || 'Финансы',
    salaryFolder: process.env.YANDEX_ARCHIVE_SALARY || 'Зарплата',
  };
}

function sanitizePathSegment(value, fallback = 'unknown') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function formatDateFolder(dateValue) {
  const raw = String(dateValue || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${day}.${month}.${year.slice(-2)}`;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    return `${dd}.${mm}.${yy}`;
  }

  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(date.getUTCFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

function monthBounds(year, month) {
  const y = Number(year);
  const m = Number(month);
  const dateFrom = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dateTo = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const label = `${y}-${String(m).padStart(2, '0')}`;
  return { dateFrom, dateTo, label };
}

function listRecentMonths(count = 2) {
  const now = new Date();
  const months = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(monthBounds(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }
  return months;
}

function guessImageContentType(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function buildPhotoFilename(trip) {
  const ext = path.extname(String(trip.photo_path || '')) || '.jpg';
  const ttn = sanitizePathSegment(trip.ttn_number, '');
  if (ttn) {
    return `ТТН_${ttn}_рейс${trip.id}${ext}`;
  }
  return `рейс_${trip.id}${ext}`;
}

function fetchTripForArchive(tripId) {
  return db
    .prepare(
      `SELECT
         t.id,
         t.ttn_number,
         t.photo_path,
         t.driver_id,
         COALESCE(u.full_name, 'Без имени') AS driver_name,
         date(COALESCE(t.completed_at, t.created_at)) AS trip_date
       FROM trips t
       JOIN drivers d ON d.id = t.driver_id
       LEFT JOIN users u ON u.id = d.user_id
       WHERE t.id = ?`
    )
    .get(tripId);
}

function fetchTripsWithPhotos() {
  return db
    .prepare(
      `SELECT
         t.id,
         t.ttn_number,
         t.photo_path,
         t.driver_id,
         COALESCE(u.full_name, 'Без имени') AS driver_name,
         date(COALESCE(t.completed_at, t.created_at)) AS trip_date
       FROM trips t
       JOIN drivers d ON d.id = t.driver_id
       LEFT JOIN users u ON u.id = d.user_id
       WHERE t.photo_path IS NOT NULL AND trim(t.photo_path) <> ''
       ORDER BY COALESCE(t.completed_at, t.created_at) ASC, t.id ASC`
    )
    .all();
}

async function uploadTripPhotoToYandex(tripId, options = {}) {
  const config = getYandexArchiveConfig();
  if (!config.enabled) {
    return { uploaded: false, reason: 'yandex_archive_disabled' };
  }

  // Sync DB до любых await.
  const trip = options.trip || fetchTripForArchive(tripId);
  if (!trip?.photo_path) {
    return { uploaded: false, reason: 'no_photo' };
  }

  const driverFolder = `Водитель - ${sanitizePathSegment(trip.driver_name, 'Без имени')}`;
  const dateFolder = formatDateFolder(trip.trip_date);
  const remoteFolder = `${config.root}/${config.driversFolder}/${driverFolder}/${dateFolder}`;
  const filename = buildPhotoFilename(trip);
  const contentType = options.contentType || guessImageContentType(trip.photo_path);
  const photoPath = String(trip.photo_path).trim();

  const buffer = options.buffer || (await readUploadBuffer(photoPath));
  if (!buffer?.length) {
    return { uploaded: false, reason: 'photo_bytes_unavailable' };
  }

  const result = await uploadBufferToYandexDisk({
    token: config.token,
    buffer,
    remoteFolder,
    filename,
    contentType,
  });

  return {
    ...result,
    tripId: trip.id,
    driver: trip.driver_name,
    dateFolder,
  };
}

function queueTripPhotoArchive(tripId, options = {}) {
  const config = getYandexArchiveConfig();
  if (!config.enabled || !tripId) return;

  setImmediate(() => {
    uploadTripPhotoToYandex(tripId, options).catch((error) => {
      console.warn(
        `[yandex-archive] trip ${tripId} photo upload failed:`,
        error.message
      );
    });
  });
}

async function syncAllTripPhotosToYandex({ limit = 500 } = {}) {
  const config = getYandexArchiveConfig();
  if (!config.enabled) {
    return { uploaded: 0, failed: 0, skipped: true, reason: 'disabled' };
  }

  // Весь список из БД — до await.
  const trips = fetchTripsWithPhotos().slice(0, Math.max(1, limit));
  let uploaded = 0;
  let failed = 0;
  const errors = [];

  for (const trip of trips) {
    try {
      const result = await uploadTripPhotoToYandex(trip.id, { trip });
      if (result.uploaded) uploaded += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      errors.push({ tripId: trip.id, error: error.message });
      console.warn(
        `[yandex-archive] trip ${trip.id} sync failed:`,
        error.message
      );
    }
  }

  return { uploaded, failed, total: trips.length, errors: errors.slice(0, 20) };
}

async function syncMonthlyReportsToYandex({ months = 2 } = {}) {
  const config = getYandexArchiveConfig();
  if (!config.enabled) {
    return { uploaded: [], skipped: true, reason: 'disabled' };
  }

  // Важно: сначала все sync-запросы к БД, затем await (deasync + await = hang/timeout).
  const monthPayloads = listRecentMonths(months).map((month) => {
    const tripRows = fetchCompletedTrips({
      dateFrom: month.dateFrom,
      dateTo: month.dateTo,
      driverId: null,
      vehiclePlate: null,
    });
    const expenseRows = fetchExpenses({
      dateFrom: month.dateFrom,
      dateTo: month.dateTo,
      driverId: null,
    });
    return { month, tripRows, expenseRows };
  });

  const uploaded = [];

  for (const payload of monthPayloads) {
    const { month, tripRows, expenseRows } = payload;
    const registryWorkbook = buildRegistryWorkbook(tripRows);
    const financeWorkbook = buildFinancialWorkbook(tripRows, expenseRows);

    const registryBuffer = await workbookToBuffer(registryWorkbook);
    const financeBuffer = await workbookToBuffer(financeWorkbook);

    const registryResult = await uploadBufferToYandexDisk({
      token: config.token,
      buffer: registryBuffer,
      remoteFolder: `${config.root}/${config.registryFolder}`,
      filename: `${month.label}_реестр_перевозок.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const financeResult = await uploadBufferToYandexDisk({
      token: config.token,
      buffer: financeBuffer,
      remoteFolder: `${config.root}/${config.financeFolder}`,
      filename: `${month.label}_финансовый_отчёт.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    uploaded.push({
      month: month.label,
      registry: registryResult.path,
      finance: financeResult.path,
      trips: tripRows.length,
      expenses: expenseRows.length,
    });
  }

  return { uploaded };
}

function prepareSalaryShiftWorkbooks(shifts) {
  return shifts.map((shift) => ({
    shift,
    workbook: buildSalaryTimesheetWorkbook(db, {
      dateFrom: shift.dateFrom,
      dateTo: shift.dateTo,
      driverId: null,
    }),
  }));
}

async function uploadSalaryShiftWorkbooks(config, preparedSalary) {
  const uploaded = [];
  for (const item of preparedSalary) {
    const buffer = await workbookToBuffer(item.workbook);
    const result = await uploadBufferToYandexDisk({
      token: config.token,
      buffer,
      remoteFolder: `${config.root}/${config.salaryFolder}`,
      filename: item.shift.filename,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    uploaded.push({
      shift: item.shift.shift,
      period: `${item.shift.dateFrom} — ${item.shift.dateTo}`,
      title: item.shift.title,
      path: result.path,
      sizeBytes: result.sizeBytes,
    });
  }
  return { uploaded };
}

async function syncSalaryShiftsToYandex({ shifts = null, fullRecent = false } = {}) {
  const config = getYandexArchiveConfig();
  if (!config.enabled) {
    return { uploaded: [], skipped: true, reason: 'disabled' };
  }

  const shiftList =
    shifts ??
    (fullRecent
      ? listSalaryShiftsForArchiveSync()
      : shiftsDueOnCalendarDay());

  if (!shiftList.length) {
    return { uploaded: [], skipped: true, reason: 'no_shifts_due' };
  }

  const preparedSalary = prepareSalaryShiftWorkbooks(shiftList);
  return uploadSalaryShiftWorkbooks(config, preparedSalary);
}

async function runYandexArchiveSync({
  photos = true,
  reports = true,
  salary = false,
  salaryFullRecent = true,
  photoLimit = 500,
} = {}) {
  const config = getYandexArchiveConfig();
  if (!config.enabled) {
    return { ok: false, reason: 'yandex_archive_disabled' };
  }

  // Сначала весь sync-read из БД, потом любые await (иначе deasync timeout).
  const preparedPhotos = photos
    ? fetchTripsWithPhotos().slice(0, Math.max(1, photoLimit))
    : [];
  const preparedReports = reports
    ? listRecentMonths(2).map((month) => ({
        month,
        tripRows: fetchCompletedTrips({
          dateFrom: month.dateFrom,
          dateTo: month.dateTo,
          driverId: null,
          vehiclePlate: null,
        }),
        expenseRows: fetchExpenses({
          dateFrom: month.dateFrom,
          dateTo: month.dateTo,
          driverId: null,
        }),
      }))
    : [];
  const preparedSalary =
    salary && salaryFullRecent
      ? prepareSalaryShiftWorkbooks(listSalaryShiftsForArchiveSync())
      : [];

  const result = { ok: true, photos: null, reports: null, salary: null };

  if (photos) {
    let uploaded = 0;
    let failed = 0;
    const errors = [];
    for (const trip of preparedPhotos) {
      try {
        const item = await uploadTripPhotoToYandex(trip.id, { trip });
        if (item.uploaded) uploaded += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        errors.push({ tripId: trip.id, error: error.message });
      }
    }
    result.photos = {
      uploaded,
      failed,
      total: preparedPhotos.length,
      errors: errors.slice(0, 20),
    };
  }

  if (reports) {
    const uploaded = [];
    for (const payload of preparedReports) {
      const { month, tripRows, expenseRows } = payload;
      const registryBuffer = await workbookToBuffer(buildRegistryWorkbook(tripRows));
      const financeBuffer = await workbookToBuffer(
        buildFinancialWorkbook(tripRows, expenseRows)
      );

      const registryResult = await uploadBufferToYandexDisk({
        token: config.token,
        buffer: registryBuffer,
        remoteFolder: `${config.root}/${config.registryFolder}`,
        filename: `${month.label}_реестр_перевозок.xlsx`,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const financeResult = await uploadBufferToYandexDisk({
        token: config.token,
        buffer: financeBuffer,
        remoteFolder: `${config.root}/${config.financeFolder}`,
        filename: `${month.label}_финансовый_отчёт.xlsx`,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      uploaded.push({
        month: month.label,
        registry: registryResult.path,
        finance: financeResult.path,
        trips: tripRows.length,
        expenses: expenseRows.length,
      });
    }
    result.reports = { uploaded };
  }

  if (salary && preparedSalary.length) {
    result.salary = await uploadSalaryShiftWorkbooks(config, preparedSalary);
  }

  return result;
}

module.exports = {
  getYandexArchiveConfig,
  uploadTripPhotoToYandex,
  queueTripPhotoArchive,
  syncAllTripPhotosToYandex,
  syncMonthlyReportsToYandex,
  syncSalaryShiftsToYandex,
  runYandexArchiveSync,
  formatDateFolder,
  sanitizePathSegment,
};

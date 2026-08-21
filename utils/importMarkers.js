/**
 * Import idempotency markers in comments/notes, e.g. [bank-2026-08-18-6600.0-doc453].
 * Prevents double-posting the same bank/cash/salary import line.
 */

const IMPORT_MARKER_RE = /\[[^\]]+\]/g;

/** Markers that identify a single import line (must be unique). */
const STRICT_MARKER_RE =
  /^\[(?:bank|cpay|ppr-topup|ppr-fuel|opti-fuel|fuel-topup|cash-aug|payroll-jul2|cash-aug-\d)[^\]]*\]$/i;

function extractMarkers(text) {
  if (!text) return [];
  const matches = String(text).match(IMPORT_MARKER_RE);
  return matches ? [...new Set(matches)] : [];
}

function extractStrictMarkers(text) {
  return extractMarkers(text).filter((marker) => {
    if (STRICT_MARKER_RE.test(marker)) return true;
    // Full unique cash allocation lines like [cash-aug-15-40300-misc]
    if (/^\[cash-aug-[^\]]+\]$/i.test(marker)) return true;
    // Opti / fuel / bank / cpay already covered; also [bank-op-...]
    if (/^\[bank-op-[^\]]+\]$/i.test(marker)) return true;
    if (/^\[fuel-topup-[^\]]+\]$/i.test(marker)) return true;
    // Batch markers like [cash-#10] are shared across many lines — not unique alone
    return false;
  });
}

/**
 * @param {import('../database')} db
 * @param {'expenses'|'driver_payments'|'contractor_payments'} table
 * @param {string|null|undefined} text
 * @param {{ amount?: number, driverId?: number }} [opts]
 * @returns {{ marker: string, id: number } | null}
 */
function findDuplicateImportMarker(db, table, text, opts = {}) {
  const markers = extractStrictMarkers(text);
  if (markers.length === 0) return null;

  let column = 'comment';
  if (table === 'driver_payments' || table === 'contractor_payments') column = 'note';

  for (const marker of markers) {
    const like = `%${marker.replace(/%/g, '\\%')}%`;
    let sql = `SELECT id, ${column} AS text_value, amount FROM ${table} WHERE ${column} LIKE ?`;
    const params = [like];

    if (opts.amount != null && Number.isFinite(Number(opts.amount))) {
      sql += ' AND ABS(amount - ?) < 0.02';
      params.push(Number(opts.amount));
    }
    if (table === 'driver_payments' && opts.driverId) {
      sql += ' AND driver_id = ?';
      params.push(Number(opts.driverId));
    }

    sql += ' ORDER BY id ASC LIMIT 5';
    const rows = db.prepare(sql).all(...params);
    const hit = rows.find((row) => extractMarkers(row.text_value).includes(marker));
    if (hit) {
      return { marker, id: Number(hit.id) };
    }
  }
  return null;
}

module.exports = {
  extractMarkers,
  extractStrictMarkers,
  findDuplicateImportMarker,
};

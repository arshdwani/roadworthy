// Paste-in fleet import: CSV with a header row (any order) or plain rows "unit, VIN, plate, depot, driver, verified to".
import { validateVin } from './vin.js';

const COLUMNS = {
  name: /^(unit|name|unit ?(no|number|#)|fleet ?(no|number|#)|asset)$/i,
  vin: /^vin$/i,
  plate: /^(plate|license|licen[cs]e ?plate|registration|reg)$/i,
  depot: /^(depot|location|site|yard|branch)$/i,
  driver: /^(driver|assigned ?to)$/i,
  verifiedTo: /^(recalls? ?verified ?(to|through)?|verified ?(to|through)?|last ?dealer ?check)$/i,
};
const ORDER = ['name', 'vin', 'plate', 'depot', 'driver', 'verifiedTo'];

export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t' || ch === ';') { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Returns { rows: [{ name, vin, plate, depot, driver, verifiedTo }], errors: [{ line, error }] }. */
export function parseFleetCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], errors: [] };
  let cols = ORDER;
  let start = 0;
  const head = splitCsvLine(lines[0]);
  if (head.some((h) => /^vin$/i.test(h))) {
    cols = head.map((h) => Object.keys(COLUMNS).find((k) => COLUMNS[k].test(h)) || null);
    start = 1;
  }
  const rows = [];
  const errors = [];
  const seen = new Set();
  for (let i = start; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row = {};
    // A single bare VIN per line is fine too.
    if (cells.length === 1) row.vin = cells[0];
    else cols.forEach((k, j) => { if (k && cells[j] !== undefined && cells[j] !== '') row[k] = cells[j]; });
    const check = validateVin(row.vin);
    if (!check.ok) {
      errors.push({ line: i + 1, error: check.error });
      continue;
    }
    if (seen.has(check.vin)) {
      errors.push({ line: i + 1, error: `${check.vin} is listed twice.` });
      continue;
    }
    seen.add(check.vin);
    if (row.verifiedTo && !/^\d{4}-\d{2}-\d{2}$/.test(row.verifiedTo)) {
      errors.push({ line: i + 1, error: `"${row.verifiedTo}" isn't a date; use YYYY-MM-DD.` });
      continue;
    }
    rows.push({ ...row, vin: check.vin, name: row.name || check.vin.slice(-6) });
  }
  return { rows, errors };
}

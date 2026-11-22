// VIN rules (ISO 3779 / 49 CFR Part 565): 17 characters, no I, O or Q, position 9 is a check digit.
// Pure functions, no Forge imports, so they run under `node --test`.

const TRANSLIT = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

// Model-year code at position 10. The cycle repeats every 30 years (A = 1980 or 2010);
// position 7 being a letter means 2010 or later for passenger cars and light trucks.
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

export const normalizeVin = (v) => String(v || '').toUpperCase().replace(/[\s-]/g, '');

const valueOf = (ch) => (ch >= '0' && ch <= '9' ? Number(ch) : TRANSLIT[ch]);

/** The check digit ('0'-'9' or 'X') a VIN should carry in position 9. */
export function checkDigit(vin) {
  const v = normalizeVin(vin);
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    if (i === 8) continue;
    const n = valueOf(v[i]);
    if (n === undefined) return null;
    sum += n * WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

/** Put the right check digit into position 9. */
export function withCheckDigit(vin) {
  const v = normalizeVin(vin);
  if (v.length !== 17) return v;
  const c = checkDigit(v);
  return c ? v.slice(0, 8) + c + v.slice(9) : v;
}

/**
 * Validate a VIN. Returns { ok, vin, error }. `error` is a sentence people can act on.
 */
export function validateVin(input) {
  const vin = normalizeVin(input);
  if (!vin) return { ok: false, vin, error: 'Enter a VIN.' };
  if (vin.length !== 17) return { ok: false, vin, error: `A VIN has 17 characters; this one has ${vin.length}.` };
  const bad = vin.match(/[^A-HJ-NPR-Z0-9]/);
  if (bad) {
    const hint = 'IOQ'.includes(bad[0]) ? ` VINs never use I, O or Q (did you mean ${bad[0] === 'I' ? '1' : '0'}?).` : '';
    return { ok: false, vin, error: `"${bad[0]}" can't appear in a VIN.${hint}` };
  }
  const expected = checkDigit(vin);
  if (vin[8] !== expected) {
    return { ok: false, vin, error: `The check digit (9th character) should be ${expected}, not ${vin[8]}. Check the VIN for a typo.` };
  }
  return { ok: true, vin, error: null };
}

/** Model year from position 10 (uses position 7 to pick the 30-year cycle), or null. */
export function modelYearOf(vin) {
  const v = normalizeVin(vin);
  const i = YEAR_CODES.indexOf(v[9]);
  if (i < 0) return null;
  const modern = /[A-Z]/.test(v[6]);
  return (modern ? 2010 : 1980) + i;
}

export const wmiOf = (vin) => normalizeVin(vin).slice(0, 3);

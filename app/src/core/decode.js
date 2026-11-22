// vPIC DecodeVinValuesBatch: turn a response into { vin, ok, make, model, year, ... } per VIN.
// ErrorCode "0" is a clean decode; other codes are warnings or failures (see vPIC docs). We accept a decode when
// vPIC returned a make, a model and a model year, and keep its message so people can see what vPIC said.

const titleCase = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (m, p, c) => p + c.toUpperCase());

// vPIC returns makes in capitals ("FORD"); show them the way people write them.
const MAKE_NAMES = { BMW: 'BMW', GMC: 'GMC', RAM: 'Ram', 'MERCEDES-BENZ': 'Mercedes-Benz', KIA: 'Kia' };
export const makeName = (s) => MAKE_NAMES[String(s || '').toUpperCase()] || titleCase(s);

export function parseDecodeBatch(body) {
  const rows = Array.isArray(body?.Results) ? body.Results : [];
  return rows.map((r) => {
    const codes = String(r.ErrorCode || '').split(',').map((c) => c.trim()).filter(Boolean);
    const make = String(r.Make || '').trim();
    const model = String(r.Model || '').trim();
    const year = Number(r.ModelYear) || null;
    const ok = Boolean(make && model && year);
    return {
      vin: String(r.VIN || '').toUpperCase(),
      ok,
      clean: codes.length === 1 && codes[0] === '0',
      make: makeName(make),
      model,
      year,
      trim: String(r.Trim || '').trim(),
      series: String(r.Series || '').trim(),
      body: String(r.BodyClass || '').trim(),
      cab: String(r.BodyCabType || '').trim(),
      fuel: String(r.FuelTypePrimary || '').trim(),
      fuel2: String(r.FuelTypeSecondary || '').trim(),
      electrification: String(r.ElectrificationLevel || '').trim(),
      displacement: Number(r.DisplacementL) ? Number(r.DisplacementL).toFixed(1) : '',
      engine: String(r.EngineModel || '').trim(),
      drive: String(r.DriveType || '').trim(),
      gvwr: String(r.GVWR || '').trim(),
      manufacturer: String(r.Manufacturer || '').trim(),
      plant: [r.PlantCity, r.PlantCountry].filter(Boolean).map(titleCase).join(', '),
      message: ok ? (codes[0] === '0' ? '' : String(r.ErrorText || '').trim()) : String(r.ErrorText || 'vPIC could not decode this VIN.').trim(),
    };
  });
}

/** Split VINs into vPIC batch request bodies (vPIC accepts up to 50 per call). */
export function decodeBatches(vins, size = 50) {
  const out = [];
  for (let i = 0; i < vins.length; i += size) out.push(vins.slice(i, i + size).join(';'));
  return out;
}

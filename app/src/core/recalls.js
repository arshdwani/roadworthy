// NHTSA recall data: parse the recallsByVehicle response, map vPIC model names to NHTSA recall model names,
// and decide which campaigns are new for a vehicle. Pure functions (no network), unit-tested with recorded fixtures.

/** NHTSA dates come as dd/mm/yyyy. Returns yyyy-mm-dd, or null. */
export function parseNhtsaDate(s) {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** One NHTSA recall row -> our campaign shape. */
export function toCampaign(row) {
  return {
    id: clean(row.NHTSACampaignNumber),
    manufacturer: clean(row.Manufacturer),
    make: clean(row.Make),
    model: clean(row.Model),
    modelYear: Number(row.ModelYear) || null,
    reported: parseNhtsaDate(row.ReportReceivedDate),
    component: clean(row.Component),
    summary: clean(row.Summary),
    consequence: clean(row.Consequence),
    remedy: clean(row.Remedy),
    parkIt: row.parkIt === true,
    parkOutside: row.parkOutSide === true,
    ota: row.overTheAirUpdate === true,
  };
}

/**
 * Parse a recallsByVehicle response body. NHTSA answers HTTP 400 with {"Count":0,"results":[]} when it knows no
 * recalls for that make/model/year, so an empty list is a normal answer, not an error.
 * Campaigns are de-duplicated by number (the same campaign can be listed once per model variant).
 */
export function parseRecalls(body) {
  const rows = Array.isArray(body?.results) ? body.results : [];
  const byId = new Map();
  for (const r of rows) {
    const c = toCampaign(r);
    if (c.id && !byId.has(c.id)) byId.set(c.id, c);
  }
  return [...byId.values()].sort((a, b) => String(b.reported).localeCompare(String(a.reported)));
}

export const normModel = (s) => clean(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/**
 * vPIC and the recalls API name some models differently ("Sprinter" vs "SPRINTER 2500"). Given the vPIC model and
 * the recall model names NHTSA lists for that make and year, return the recall model names to query.
 */
export function recallModelsFor(vpicModel, recallModels) {
  const want = normModel(vpicModel);
  const names = [...new Set((recallModels || []).map((m) => clean(m)).filter(Boolean))];
  const exact = names.filter((n) => normModel(n) === want);
  if (exact.length) return exact;
  const related = names.filter((n) => {
    const k = normModel(n);
    return k.startsWith(want + ' ') || want.startsWith(k + ' ');
  });
  return related;
}

/** Cache key for one make/model/year recall lookup. */
export const recallKey = (make, model, year) => `${normModel(make)}|${normModel(model)}|${Number(year) || ''}`;

/**
 * Campaigns that should open a remediation request for this vehicle.
 * `verifiedTo` (yyyy-mm-dd) is the date up to which the vehicle's recall history was already checked, e.g. at
 * purchase or at the last dealer visit; campaigns reported on or before it are treated as already handled.
 * With no `verifiedTo`, every campaign NHTSA lists for the make/model/year is opened.
 */
export function campaignsToOpen(campaigns, { verifiedTo } = {}) {
  return (campaigns || []).filter((c) => !verifiedTo || !c.reported || c.reported > verifiedTo);
}

export const campaignUrl = (id) => `https://www.nhtsa.gov/recalls?nhtsaId=${encodeURIComponent(id)}`;
export const vinLookupUrl = (vin) => `https://www.nhtsa.gov/recalls?vin=${encodeURIComponent(vin)}`;

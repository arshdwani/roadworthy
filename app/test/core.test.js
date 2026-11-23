import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkDigit, validateVin, withCheckDigit, modelYearOf, normalizeVin } from '../src/core/vin.js';
import { parseRecalls, parseNhtsaDate, recallModelsFor, recallKey, campaignsToOpen, campaignUrl } from '../src/core/recalls.js';
import { parseDecodeBatch, decodeBatches, makeName } from '../src/core/decode.js';
import { classify, dueDate, daysBetween } from '../src/core/severity.js';
import { vehicleStatus, fleetStats, STATUS, dispatchable } from '../src/core/fleet.js';
import { planCases, planStatuses } from '../src/core/scan.js';
import { requestSummary, requestDescription } from '../src/core/adf.js';
import { SAMPLE_FLEET, SAMPLE_DEPOTS } from '../src/core/sample.js';

const fx = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

// ---- VIN ------------------------------------------------------------------------------------------------
test('check digit matches known real-world VINs', () => {
  // The textbook example from 49 CFR 565 / Wikipedia, and a vPIC-verified decode.
  assert.equal(checkDigit('1M8GDM9AXKP042788'), 'X');
  assert.equal(checkDigit('11111111111111111'), '1');
  assert.equal(checkDigit('3FTTW8E31NRA10234'), '1');
});

test('validateVin explains what is wrong', () => {
  assert.equal(validateVin('1M8GDM9AXKP042788').ok, true);
  assert.match(validateVin('1M8GDM9AXKP04278').error, /17 characters; this one has 16/);
  assert.match(validateVin('1M8GDM9AXKP0427O8').error, /never use I, O or Q/);
  assert.match(validateVin('1M8GDM9A1KP042788').error, /check digit .* should be X, not 1/);
  assert.equal(validateVin(' 1m8gdm9axkp-042788 ').vin, '1M8GDM9AXKP042788');
  assert.match(validateVin('').error, /Enter a VIN/);
});

test('withCheckDigit fills position 9 and model year decodes', () => {
  assert.equal(withCheckDigit('1M8GDM9A0KP042788'), '1M8GDM9AXKP042788');
  assert.equal(modelYearOf('3FTTW8E31NRA10234'), 2022);
  assert.equal(modelYearOf('1FTFW1E50MFA10422'), 2021);
  assert.equal(modelYearOf('1M8GDM9AXKP042788'), 1989);
  assert.equal(normalizeVin(null), '');
});

test('every sample VIN is valid, unique and decodes cleanly in the recorded vPIC response', () => {
  assert.equal(SAMPLE_FLEET.length, 25);
  assert.equal(new Set(SAMPLE_FLEET.map((v) => v.vin)).size, 25);
  assert.deepEqual([...new Set(SAMPLE_FLEET.map((v) => v.depot))].sort(), [...SAMPLE_DEPOTS].sort());
  for (const v of SAMPLE_FLEET) assert.equal(validateVin(v.vin).ok, true, v.vin);
  const decoded = parseDecodeBatch(fx('vpic_batch'));
  const byVin = new Map(decoded.map((d) => [d.vin, d]));
  for (const v of SAMPLE_FLEET) {
    const d = byVin.get(v.vin);
    assert.ok(d, `vPIC fixture has ${v.vin}`);
    assert.equal(d.clean, true, `${v.vin} decodes with ErrorCode 0`);
    assert.equal(d.year, modelYearOf(v.vin));
  }
});

// ---- vPIC decode ----------------------------------------------------------------------------------------
test('parseDecodeBatch keeps make, model, year and flags failures', () => {
  const d = parseDecodeBatch(fx('vpic_batch')).find((r) => r.vin === '3FTTW8E31NRA10234');
  assert.deepEqual([d.make, d.model, d.year, d.ok, d.clean], ['Ford', 'Maverick', 2022, true, true]);
  const bad = parseDecodeBatch({ Results: [{ VIN: 'X', ErrorCode: '1,7,11', ErrorText: '1 - Check Digit (9th position) does not calculate properly', Make: '', Model: '', ModelYear: '' }] })[0];
  assert.equal(bad.ok, false);
  assert.match(bad.message, /Check Digit/);
  assert.equal(makeName('MERCEDES-BENZ'), 'Mercedes-Benz');
  assert.equal(makeName('CHEVROLET'), 'Chevrolet');
  assert.deepEqual(decodeBatches(['a', 'b', 'c'], 2), ['a;b', 'c']);
});

// ---- Recalls --------------------------------------------------------------------------------------------
test('parseRecalls reads the live NHTSA shape, including Park It flags', () => {
  const list = parseRecalls(fx('recalls_ford_maverick_2022'));
  const parkIt = list.find((c) => c.id === '26V340000');
  assert.ok(parkIt);
  assert.equal(parkIt.parkIt, true);
  assert.equal(parkIt.parkOutside, false);
  assert.equal(parkIt.reported, '2026-05-27');
  assert.match(parkIt.component, /LOWER BALL JOINT/);
  assert.match(parkIt.remedy, /not to drive/i);
  assert.equal(new Set(list.map((c) => c.id)).size, list.length);
  assert.ok(list[0].reported >= list[list.length - 1].reported, 'newest first');
  const bolt = parseRecalls(fx('recalls_chevrolet_bolt-ev_2020')).find((c) => c.id === '24V812000');
  assert.equal(bolt.parkOutside, true);
});

test('an HTTP 400 "Count 0" body is an empty list, not an error', () => {
  assert.deepEqual(parseRecalls(fx('recalls_empty_400')), []);
  assert.deepEqual(parseRecalls(null), []);
});

test('dates and links', () => {
  assert.equal(parseNhtsaDate('4/9/2020'), '2020-09-04');
  assert.equal(parseNhtsaDate('nope'), null);
  assert.equal(campaignUrl('26V340000'), 'https://www.nhtsa.gov/recalls?nhtsaId=26V340000');
});

test('recallModelsFor maps vPIC model names to NHTSA recall model names', () => {
  const ram = fx('models_ram_2020').results.map((r) => r.model);
  assert.deepEqual(recallModelsFor('ProMaster 2500', ram), ['PROMASTER']);
  assert.deepEqual(recallModelsFor('1500', ram), ['1500']);
  assert.deepEqual(recallModelsFor('Sprinter', ['SPRINTER 2500', 'SPRINTER 3500', 'METRIS']), ['SPRINTER 2500', 'SPRINTER 3500']);
  assert.deepEqual(recallModelsFor('Nothing', ram), []);
  assert.equal(recallKey('Ford', 'F-150', '2021'), 'FORD|F 150|2021');
});

test('campaignsToOpen respects the verified-to date', () => {
  const list = parseRecalls(fx('recalls_ford_maverick_2022'));
  assert.deepEqual(campaignsToOpen(list, { verifiedTo: '2026-03-01' }).map((c) => c.id), ['26V340000']);
  assert.equal(campaignsToOpen(list, {}).length, list.length);
});

// ---- Severity -------------------------------------------------------------------------------------------
test('classify: Park It and Park Outside escalate to Highest, same day', () => {
  const m = parseRecalls(fx('recalls_ford_maverick_2022')).find((c) => c.id === '26V340000');
  assert.deepEqual(({ ...classify(m) }).level, 'park-it');
  assert.equal(classify(m).priority, 'Highest');
  assert.equal(classify(m).days, 0);
  const b = parseRecalls(fx('recalls_chevrolet_bolt-ev_2020')).find((c) => c.id === '24V812000');
  assert.equal(classify(b).level, 'park-outside');
});

test('classify: safety systems are high, rear camera medium, labels low', () => {
  const f150 = parseRecalls(fx('recalls_ford_f-150_2021'));
  const rollaway = classify(f150.find((c) => c.id === '26V402000'));
  assert.equal(rollaway.level, 'high');
  assert.match(rollaway.reason, /power train/);
  assert.equal(classify(f150.find((c) => c.id === '26V489000')).level, 'medium');
  assert.equal(classify(f150.find((c) => c.id === '24V852000')).level, 'low');
  const camry = parseRecalls(fx('recalls_toyota_camry_2021'))[0];
  assert.equal(classify(camry).level, 'high');
  assert.equal(classify(camry, { high: 7 }).days, 7);
});

test('due dates and day counts', () => {
  assert.equal(dueDate('2026-11-21', 14), '2026-12-05');
  assert.equal(dueDate('2026-11-21T23:59:00Z', 0), '2026-11-21');
  assert.equal(daysBetween('2026-11-19', '2026-11-21'), 2);
  assert.equal(daysBetween('2026-11-22', '2026-11-21'), 0);
});

// ---- Status rules ---------------------------------------------------------------------------------------
test('vehicleStatus: Park It grounds, any open recall blocks rental, remedy lifts only our own restriction', () => {
  const parkIt = [{ level: 'park-it', state: 'open' }];
  const low = [{ level: 'low', state: 'scheduled' }];
  assert.deepEqual(vehicleStatus({ current: STATUS.AVAILABLE, openCases: parkIt }), { status: STATUS.PARK_IT, appGrounded: true });
  assert.deepEqual(vehicleStatus({ current: STATUS.IN_REPAIR, openCases: parkIt }).status, STATUS.PARK_IT);
  assert.deepEqual(vehicleStatus({ current: STATUS.AVAILABLE, openCases: low }), { status: STATUS.DO_NOT_RENT, appGrounded: true });
  assert.deepEqual(vehicleStatus({ current: STATUS.IN_REPAIR, openCases: low }).status, STATUS.IN_REPAIR);
  assert.deepEqual(vehicleStatus({ current: STATUS.PARK_IT, appGrounded: true, openCases: low }).status, STATUS.DO_NOT_RENT);
  assert.deepEqual(vehicleStatus({ current: STATUS.PARK_IT, appGrounded: false, openCases: low }).status, STATUS.PARK_IT);
  assert.deepEqual(vehicleStatus({ current: STATUS.DO_NOT_RENT, appGrounded: true, openCases: [] }), { status: STATUS.AVAILABLE, appGrounded: false });
  assert.deepEqual(vehicleStatus({ current: STATUS.DO_NOT_RENT, appGrounded: false, openCases: [] }).status, STATUS.DO_NOT_RENT);
  assert.deepEqual(vehicleStatus({ current: '', openCases: [] }).status, STATUS.AVAILABLE);
  const outside = [{ level: 'park-outside', state: 'open' }];
  assert.equal(vehicleStatus({ current: STATUS.AVAILABLE, openCases: outside }).status, STATUS.PARK_IT);
  assert.equal(vehicleStatus({ current: STATUS.AVAILABLE, openCases: outside, parkOutsideGrounds: false }).status, STATUS.DO_NOT_RENT);
  assert.equal(dispatchable(STATUS.AVAILABLE), true);
  assert.equal(dispatchable(STATUS.DO_NOT_RENT), false);
});

// ---- Whole scan over the sample fleet, offline ----------------------------------------------------------
const FIXTURE_MODELS = {
  'FORD|TRANSIT|2020': 'recalls_ford_transit_2020',
  'FORD|TRANSIT CONNECT|2019': 'recalls_ford_transit-connect_2019',
  'CHEVROLET|EXPRESS|2020': 'recalls_chevrolet_express_2020',
  'FORD|F 150|2021': 'recalls_ford_f-150_2021',
  'FORD|MAVERICK|2022': 'recalls_ford_maverick_2022',
  'FORD|BRONCO SPORT|2022': 'recalls_ford_bronco-sport_2022',
  'TOYOTA|CAMRY|2021': 'recalls_toyota_camry_2021',
  'NISSAN|ROGUE|2020': 'recalls_nissan_rogue_2020',
  'HYUNDAI|TUCSON|2021': 'recalls_hyundai_tucson_2021',
  'KIA|SPORTAGE|2020': 'recalls_kia_sportage_2020',
  'CHEVROLET|BOLT EV|2020': 'recalls_chevrolet_bolt-ev_2020',
};

function sampleScan() {
  const decoded = new Map(parseDecodeBatch(fx('vpic_batch')).map((d) => [d.vin, d]));
  const vehicles = SAMPLE_FLEET.map((v) => {
    const d = decoded.get(v.vin);
    return { ...v, make: d.make, model: d.model, year: d.year, decoded: d, status: STATUS.AVAILABLE };
  });
  const recallsByKey = {};
  for (const v of vehicles) {
    const k = recallKey(v.make, v.model, v.year);
    assert.ok(FIXTURE_MODELS[k], `fixture for ${k}`);
    recallsByKey[k] = parseRecalls(fx(FIXTURE_MODELS[k]));
  }
  return { vehicles, recallsByKey };
}

test('sample fleet scan: 27 NHTSA matches → 15 requests (13 likely, 2 to confirm) and 12 ruled out, Park It first', () => {
  const { vehicles, recallsByKey } = sampleScan();
  const { newCases, reviews, skipped } = planCases({ vehicles, recallsByKey, today: '2026-11-21' });
  assert.deepEqual(skipped, []);
  assert.equal(newCases.length, 15);
  assert.equal(reviews.length, 12);
  assert.equal(newCases.filter((c) => c.applicability.verdict === 'possible').length, 2);
  assert.equal(newCases.filter((c) => c.severity.level === 'park-it').length, 3);
  assert.equal(newCases.filter((c) => c.severity.level === 'park-outside').length, 2);
  assert.equal(newCases[0].severity.level, 'park-it');
  assert.equal(newCases[0].campaign.id, '26V340000');
  assert.equal(newCases[0].due, '2026-11-21');
  // Idempotent: a second plan with the first cases recorded opens nothing new.
  const existing = newCases.map((c) => ({ campaign: c.campaign.id, vin: c.vin, state: 'open' }));
  assert.equal(planCases({ vehicles, recallsByKey, existing, today: '2026-11-22' }).newCases.length, 0);
});

test('sample fleet statuses and board numbers before and after remedies', () => {
  const { vehicles, recallsByKey } = sampleScan();
  const { newCases } = planCases({ vehicles, recallsByKey, today: '2026-11-21' });
  const cases = newCases.map((c) => ({ campaign: c.campaign.id, vin: c.vin, level: c.severity.level, state: 'open', due: c.due }));
  const changes = planStatuses({ vehicles, cases });
  const byVin = new Map(changes.map((c) => [c.vin, c]));
  const unit = (name) => SAMPLE_FLEET.find((v) => v.name === name).vin;
  assert.equal(byVin.get(unit('TRK-204')).to, STATUS.PARK_IT);
  assert.equal(byVin.get(unit('RNT-309')).to, STATUS.PARK_IT);
  assert.equal(byVin.get(unit('RNT-301')).to, STATUS.DO_NOT_RENT);
  assert.equal(byVin.has(unit('VAN-101')), false);
  assert.equal(byVin.has(unit('RNT-308')), false, 'hitch recall ruled out: no tow hitch');
  const after = vehicles.map((v) => ({ ...v, status: byVin.get(v.vin)?.to || v.status, appGrounded: byVin.get(v.vin)?.appGrounded }));
  const s = fleetStats(after, cases, '2026-11-21');
  assert.equal(s.vehicles, 25);
  assert.equal(s.vehiclesAffected, 12);
  assert.equal(s.doNotDrive, 5);
  assert.equal(s.overdue, 0);
  assert.equal(s.pctRemedied, 0);
  assert.deepEqual(s.byDepot.map((d) => d.depot), ['Airport', 'North', 'South']);
  // Remedy the Park It case on TRK-204: the vehicle goes back to Available and the board moves.
  const fixed = cases.map((c) => (c.vin === unit('TRK-204') ? { ...c, state: 'remedied' } : c));
  const lift = planStatuses({ vehicles: after, cases: fixed }).find((c) => c.vin === unit('TRK-204'));
  assert.equal(lift.to, STATUS.AVAILABLE);
  const s2 = fleetStats(after, fixed, '2026-12-01');
  assert.equal(s2.pctRemedied, 7);
  assert.ok(s2.overdue > 0, 'Park It and 0-day cases are overdue ten days later');
});

// ---- Request text ---------------------------------------------------------------------------------------
test('request summary and description carry campaign, remedy, due date and the asset link', () => {
  const c = parseRecalls(fx('recalls_ford_maverick_2022')).find((x) => x.id === '26V340000');
  const v = { name: 'TRK-204', vin: '3FTTW8E31NRA10234', year: 2022, make: 'Ford', model: 'Maverick', plate: '7STH204', depot: 'South' };
  const sev = classify(c);
  assert.equal(requestSummary(c, v, sev), 'PARK IT · Recall 26V340000 · 2022 Ford Maverick · TRK-204');
  const d = requestDescription({ campaign: c, vehicle: v, severity: sev, due: '2026-11-21', assetUrl: 'https://x.atlassian.net/asset/1' });
  const flat = JSON.stringify(d);
  assert.equal(d.content[0].type, 'panel');
  assert.match(flat, /PARK IT – DO NOT DRIVE/);
  assert.match(flat, /https:\/\/x\.atlassian\.net\/asset\/1/);
  assert.match(flat, /nhtsaId=26V340000/);
  assert.match(flat, /recalls\?vin=3FTTW8E31NRA10234/);
  assert.match(flat, /2026-11-21 \(Park It\)/);
  assert.ok(!flat.includes('"content":[]'), 'no empty nodes');
});

// ---- CSV import -----------------------------------------------------------------------------------------
import { parseFleetCsv, splitCsvLine } from '../src/core/csv.js';

test('parseFleetCsv: header in any order, plain rows, bare VINs, and clear errors', () => {
  const withHeader = parseFleetCsv('Depot,VIN,Unit,Plate\nNorth,1FTBR1C8XLKA20562,VAN-101,"8NRT 101"\nSouth,1FTBR1C81LKA20562,VAN-102,X');
  assert.deepEqual(withHeader.rows, [{ depot: 'North', vin: '1FTBR1C8XLKA20562', name: 'VAN-101', plate: '8NRT 101' }]);
  assert.match(withHeader.errors[0].error, /check digit/);
  assert.equal(withHeader.errors[0].line, 3);
  const plain = parseFleetCsv('TRK-1, 3FTTW8E31NRA10234, 7ABC123, South, Jo, 2026-03-01\n3fttw8e31nra10234');
  assert.equal(plain.rows[0].verifiedTo, '2026-03-01');
  assert.match(plain.errors[0].error, /listed twice/);
  assert.equal(parseFleetCsv('1G1FY6S00L4102133').rows[0].name, '102133');
  assert.match(parseFleetCsv('A,1G1FY6S00L4102133,P,D,X,03/01/2026').errors[0].error, /YYYY-MM-DD/);
  assert.deepEqual(splitCsvLine('a,"b, c",""'), ['a', 'b, c', '']);
});

test('pasted VIN with no recall-history date: older campaigns go to "Check once", not requests', () => {
  const { vehicles, recallsByKey } = sampleScan();
  const trk = vehicles.find((v) => v.name === 'TRK-204');
  const fresh = { ...trk, verifiedTo: undefined, checkFrom: undefined, firstSeen: Date.parse('2026-11-21T00:00:00Z') };
  const { newCases, checkOnce } = planCases({ vehicles: [fresh], recallsByKey, today: '2026-11-21' });
  assert.ok(newCases.every((c) => c.campaign.reported > '2025-11-21'), 'only the last 12 months open requests');
  assert.ok(newCases.some((c) => c.campaign.id === '26V340000'));
  assert.ok(checkOnce.length > 10);
  assert.ok(checkOnce.every((c) => c.campaign.reported <= '2025-11-21'));
  // A dismissed "check once" item is not listed again.
  const again = planCases({ vehicles: [fresh], recallsByKey, today: '2026-11-22', dismissed: new Set([checkOnce[0].key]) });
  assert.equal(again.checkOnce.length, checkOnce.length - 1);
  // Explicit "Recalls verified to" means the older history was checked at a dealer: nothing to check once.
  const verified = planCases({ vehicles: [{ ...fresh, verifiedTo: '2026-03-01' }], recallsByKey, today: '2026-11-21' });
  assert.equal(verified.checkOnce.length, 0);
});

// ---- Personal data -----------------------------------------------------------------------------------------
import { collectAccounts, scrubCase, scrubBy } from '../src/core/privacy.js';

test('personal data: collect account IDs with their last update; scrub closed ones', () => {
  const cases = [
    { key: 'A', history: [{ by: 'u1', at: Date.parse('2026-11-01T00:00:00Z') }, { by: 'u2', at: Date.parse('2026-11-03T00:00:00Z') }, { by: null, at: 1 }] },
    { key: 'B', history: [{ by: 'u1', at: Date.parse('2026-11-05T00:00:00Z') }] },
  ];
  const acc = collectAccounts({ cases, dismissed: [{ key: 'C', by: 'u3', at: Date.parse('2026-11-02T00:00:00Z') }], job: { by: 'u2', startedAt: Date.parse('2026-11-04T00:00:00Z') } });
  assert.deepEqual(acc, [
    { accountId: 'u1', updatedAt: '2026-11-05T00:00:00.000Z' },
    { accountId: 'u2', updatedAt: '2026-11-04T00:00:00.000Z' },
    { accountId: 'u3', updatedAt: '2026-11-02T00:00:00.000Z' },
  ]);
  const closed = new Set(['u1']);
  const a = scrubCase(cases[0], closed);
  assert.deepEqual(a.history.map((h) => h.by), [null, 'u2', null]);
  assert.equal(a.history[0].byRemoved, true);
  assert.equal(scrubCase({ history: [{ by: 'u2' }] }, closed), null);
  assert.deepEqual(scrubBy({ key: 'C', by: 'u1' }, closed), { key: 'C', by: null, byRemoved: true });
  assert.equal(scrubBy({ key: 'C', by: 'u3' }, closed), null);
  assert.deepEqual(collectAccounts({}), []);
});

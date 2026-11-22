// End to end over the real backend code, offline: a fake Jira/JSM/Assets site and recorded NHTSA responses.
// Run with --experimental-test-module-mocks (see package.json).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createSite, fakeKvs } from './fakes/site.js';

const site = createSite();
const route = (strings, ...vals) => strings.reduce((out, s, i) => out + s + (i < vals.length ? encodeURIComponent(vals[i]) : ''), '');
mock.module('@forge/api', {
  exports: {
    asApp: () => ({ requestJira: site.requestJira('app') }),
    asUser: () => ({ requestJira: site.requestJira('user') }),
    route,
    fetch: site.fetch,
  },
});
mock.module('@forge/kvs', { exports: fakeKvs(site.kv) });

const svc = await import('../src/service.js');
const { runScanStep } = await import('../src/scan.js');
const store = await import('../src/store.js');
const { STATUS } = await import('../src/core/fleet.js');
const { SAMPLE_FLEET } = await import('../src/core/sample.js');

const unit = (name) => SAMPLE_FLEET.find((v) => v.name === name).vin;
const assetStatus = (vin) => {
  const typeAttrs = [...site.attrs.values()].flat();
  const id = (n) => typeAttrs.find((a) => a.name === n).id;
  const o = [...site.objects.values()].find((x) => x.attributes.find((a) => a.objectTypeAttributeId === id('VIN'))?.objectAttributeValues[0]?.value === vin);
  return o.attributes.find((a) => a.objectTypeAttributeId === id('Status'))?.objectAttributeValues[0]?.value;
};
async function scanToEnd(opts) {
  let job;
  for (let i = 0; i < 20; i++) {
    job = await runScanStep({ ...opts, restart: opts.restart && i === 0 });
    if (job.phase === 'done') return job;
  }
  throw new Error('scan did not finish');
}

test('load sample: Fleet schema, Vehicle type and 25 vehicles in Assets', async () => {
  // Start from an older Fleet schema without the Equipment attribute: it is upgraded before vehicles are written.
  await svc.connectAssets();
  const t = site.types[0];
  site.attrs.set(t.id, site.attrs.get(t.id).filter((x) => x.name !== 'Equipment'));
  const cfg0 = await store.getConfig();
  delete cfg0.assets.attrs.Equipment;
  cfg0.assets.version = 1;
  await store.saveConfig(cfg0);
  let r;
  let added = 0;
  do {
    r = await svc.loadSample();
    added += r.added;
  } while (r.remaining);
  assert.equal(added, 25);
  assert.equal(r.inAssets, true);
  const fleet = site.schemas.find((x) => x.name === 'Fleet');
  assert.equal(fleet.objectSchemaKey, 'FLEET');
  const type = site.types.find((t) => t.schemaId === fleet.id);
  assert.equal(type.name, 'Vehicle');
  assert.equal(type.iconId, '12', 'truck icon');
  const names = site.attrs.get(type.id).map((a) => a.name);
  for (const n of ['VIN', 'Make', 'Model', 'Model year', 'Plate', 'Depot', 'Status', 'Driver', 'Last recall check', 'Recalls verified to', 'Open recalls']) assert.ok(names.includes(n), n);
  assert.equal(site.attrs.get(type.id).find((a) => a.name === 'Status').options, 'Available,In repair,Park It – do not drive,Do not rent');
  assert.equal(site.objects.size, 25);
  const eqId = site.attrs.get(type.id).find((x) => x.name === 'Equipment').id;
  const withEq = [...site.objects.values()].filter((o) => o.attributes.some((x) => x.objectTypeAttributeId === eqId && x.objectAttributeValues.length));
  assert.equal(withEq.length, 7, 'Equipment notes written to Assets');
  const cfg = await store.getConfig();
  assert.equal(cfg.projectKey, 'FLEET');
  assert.equal(cfg.requestTypeName, 'Report a vehicle problem');
  // Loading again adds nothing.
  assert.equal((await svc.loadSample()).added, 0);
});

test('scan now: decode, live recalls, per-vehicle verdicts, 15 requests, Park It escalated and grounded in Assets', async () => {
  const job = await scanToEnd({ who: 'user', trigger: 'manual', restart: true });
  assert.equal(job.counts.vehicles, 25);
  assert.equal(job.counts.decoded, 25);
  assert.equal(job.counts.models, 11);
  assert.equal(job.counts.opened, 15);
  assert.equal(job.counts.likely, 13);
  assert.equal(job.counts.possible, 2);
  assert.equal(job.counts.ruledOut, 12);
  assert.equal(job.counts.escalated, 5);
  assert.equal((await store.listReviews()).length, 12);
  assert.deepEqual(job.warnings, []);
  const sent = new Set(site.nhtsaCalls);
  assert.deepEqual([...sent].sort(), ['https://api.nhtsa.gov/recalls/recallsByVehicle', 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesBatch/']);
  assert.equal(site.issues.size, 15);
  const parkIt = [...site.issues.values()].filter((i) => i.fields.summary.startsWith('PARK IT'));
  assert.equal(parkIt.length, 3);
  const first = parkIt[0];
  assert.equal(first.fields.priority.id, '1', 'Highest');
  assert.ok(first.fields.labels.includes('park-it'));
  assert.equal(first.props.roadworthy.campaign, '26V340000');
  assert.match(JSON.stringify(first.fields.description), /PARK IT – DO NOT DRIVE/);
  assert.match(JSON.stringify(first.fields.description), /jira\/assets\/object-schema\//);
  assert.equal(first.by, 'app', 'raised by the app');
  assert.equal(assetStatus(unit('TRK-204')), STATUS.PARK_IT);
  assert.equal(assetStatus(unit('RNT-301')), STATUS.DO_NOT_RENT);
  assert.equal(assetStatus(unit('VAN-101')), STATUS.AVAILABLE, 'clear vehicles stay Available');
});

test('a second scan is idempotent', async () => {
  const job = await scanToEnd({ who: 'user', trigger: 'manual', restart: true });
  assert.equal(job.counts.opened, 0);
  assert.equal(site.issues.size, 15);
});

test('board numbers', async () => {
  const b = await svc.getBoard();
  assert.equal(b.stats.vehicles, 25);
  assert.equal(b.stats.openCases, 15);
  assert.equal(b.stats.vehiclesAffected, 12);
  assert.equal(b.stats.doNotDrive, 5);
  assert.equal(b.stats.ruledOut, 12);
  assert.equal(b.grounded.length, 5);
  assert.equal(b.open[0].level, 'park-it');
  assert.equal(b.isAdmin, true);
  assert.deepEqual(b.stats.byDepot.map((d) => [d.depot, d.vehicles, d.open]), [['Airport', 10, 3], ['North', 9, 7], ['South', 6, 5]]);
  const hitch = b.reviews.find((r) => r.vehicle.startsWith('RNT-308'));
  assert.match(hitch.why, /tow hitch .* has none/);
});

test('Rovo actions: dispatchable vans at North, open recalls with request keys and verdicts', async () => {
  const actions = await import('../src/actions.js');
  const d = await actions.dispatchable_({ depot: 'north' });
  assert.equal(d.depot, 'north');
  assert.deepEqual(d.safeToDispatch.map((x) => x.vehicle.split(' ')[0]).sort(), ['VAN-101', 'VAN-102', 'VAN-108', 'VAN-109']);
  assert.ok(d.notSafe.every((x) => x.openRecalls.every((r) => /^FLEET-\d+$/.test(r.request))));
  assert.equal(d.safeToDispatch[0].bodyType, 'Cargo Van');
  assert.deepEqual(d.depots.sort(), ['Airport', 'North', 'South']);
  assert.ok(d.source.url.includes('nhtsa.gov'));
  const o = await actions.openRecalls({ depot: 'South' });
  assert.equal(o.count, 5);
  assert.ok(o.openRecalls.every((r) => r.request && r.appliesToThisVehicle));
});

test('schedule then mark remedied: audit trail, request resolved, asset back to Available', async () => {
  const key = (await store.listCases()).find((c) => c.vin === unit('TRK-204')).issueKey;
  const badge = await svc.issueBadge(key);
  assert.deepEqual(badge, { type: 'lozenge', value: { label: 'Park It · opened today', type: 'removed' } });
  await assert.rejects(svc.scheduleRepair({ issueKey: key, dealer: '', date: '2026-11-25' }), /dealer/);
  assert.deepEqual(await svc.scheduleRepair({ issueKey: key, dealer: 'Metro Ford', date: '2026-11-25', accountId: 'u1' }), { ok: true, state: 'scheduled' });
  assert.equal(site.issues.get(key).status, 'In progress');
  await assert.rejects(svc.markRemedied({ issueKey: key, ro: '', date: '2026-11-21' }), /repair order/);
  const r = await svc.markRemedied({ issueKey: key, ro: 'RO-184220', date: '2026-11-21', odometer: '42,150', accountId: 'u1' });
  assert.equal(r.vehicleStatus, STATUS.AVAILABLE);
  assert.equal(r.issueStatus, 'Resolved');
  assert.equal(assetStatus(unit('TRK-204')), STATUS.AVAILABLE);
  const c = await store.caseForIssue(key);
  assert.deepEqual(c.history.map((h) => h.what), ['opened', 'scheduled', 'remedied']);
  assert.equal(c.remedy.odometer, 42150);
  const comments = site.issues.get(key).comments;
  assert.equal(comments.length, 2);
  assert.deepEqual(comments[0].properties, [{ key: 'sd.public.comment', value: { internal: true } }]);
  assert.match(JSON.stringify(comments[1].body), /Park It – do not drive → Available/);
  assert.equal((await svc.issueBadge(key)).value.label, 'Remedied');
  const b = await svc.getBoard();
  assert.equal(b.stats.pctRemedied, 7);
  assert.equal(b.stats.doNotDrive, 4);
});

test('scheduled scan as the app: Assets refuses (401), changes are queued and written when a user opens the board', async () => {
  // A new campaign appears for one vehicle: pretend its dealer check was older.
  const vin = unit('VAN-101');
  const v = await store.getVehicle(vin);
  await store.saveVehicle({ ...v, verifiedTo: '2025-01-01', checkFrom: '2025-01-01' });
  site.kv.delete('job:scan');
  const job = await scanToEnd({ who: 'app', trigger: 'schedule' });
  assert.equal(job.counts.opened, 2, '25V442000, and 25V876000 (Rollx) as "possibly": VAN-101 has no equipment notes');
  assert.ok(job.counts.queued >= 1);
  assert.equal(assetStatus(vin), STATUS.AVAILABLE, 'not written yet');
  const b = await svc.getBoard();
  assert.ok(b.flushed >= 1);
  assert.equal(assetStatus(vin), STATUS.DO_NOT_RENT);
});

test('not affected closes a case; the restriction lifts only when no recall is left open', async () => {
  const a = (await store.listCases()).find((c) => c.vin === unit('VAN-105')).issueKey;
  const [vin101, rollx] = (await store.listCases()).filter((c) => c.vin === unit('VAN-101')).sort((x, y) => x.campaign.localeCompare(y.campaign)).map((c) => c.issueKey);
  await svc.markNotAffected({ issueKey: rollx, note: 'Factory cargo van, never converted by Rollx' });
  await assert.rejects(svc.markNotAffected({ issueKey: a, note: '' }), /how you confirmed/);
  const r1 = await svc.markNotAffected({ issueKey: a, note: 'NHTSA VIN lookup shows no open recall' });
  assert.equal(r1.vehicleStatus, STATUS.DO_NOT_RENT, 'VAN-105 has two more open recalls');
  const r2 = await svc.markRemedied({ issueKey: vin101, ro: 'RO-2201', date: '2026-11-20' });
  assert.equal(r2.vehicleStatus, STATUS.AVAILABLE);
  assert.equal(r2.issueStatus, 'Resolved', 'To Do → In progress → Resolved');
  assert.equal(assetStatus(unit('VAN-101')), STATUS.AVAILABLE);
  await assert.rejects(svc.markRemedied({ issueKey: vin101, ro: 'RO-2201', date: '2026-11-20' }), /already closed/);
});

test('a ruled-out match can still be opened by a person', async () => {
  const review = (await store.listReviews()).find((r) => r.vin === unit('RNT-308'));
  const before = site.issues.size;
  const r = await svc.openFromReview({ key: review.key, accountId: 'u1' });
  assert.match(r.issueKey, /^FLEET-\d+$/);
  assert.equal(site.issues.size, before + 1);
  assert.equal(await store.getReview(review.key), undefined);
  const c = await store.caseForIssue(r.issueKey);
  assert.equal(c.verdict, 'unlikely');
  assert.match(c.history[0].detail, /overriding the unlikely verdict/);
  assert.match(JSON.stringify(site.issues.get(r.issueKey).fields.description), /Unlikely/);
  await assert.rejects(svc.openFromReview({ key: review.key }), /no longer in the review list/);
});

test('remove sample: deletes sample vehicles, their requests and records; keeps the rest', async () => {
  const mine = await store.getVehicle(unit('VAN-101'));
  await store.saveVehicle({ ...mine, vin: '1M8GDM9AXKP042788', name: 'BUS-1', objectId: undefined, sample: false });
  let r;
  let req = 0;
  do {
    r = await svc.removeSample();
    req += r.removedRequests;
  } while (r.remaining);
  assert.equal(req, 18);
  assert.equal(site.issues.size, 0);
  assert.equal(site.objects.size, 0);
  assert.deepEqual((await store.listVehicles()).map((v) => v.name), ['BUS-1']);
  assert.deepEqual(await store.listCases(), []);
  assert.deepEqual(await store.listReviews(), []);
});

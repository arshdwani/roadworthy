// A site without Assets: vehicles live in Roadworthy's own register (KVS) and everything else works the same.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createSite, fakeKvs } from './fakes/site.js';

const site = createSite({ assets: false });
const route = (strings, ...vals) => strings.reduce((out, s, i) => out + s + (i < vals.length ? encodeURIComponent(vals[i]) : ''), '');
mock.module('@forge/api', { exports: { asApp: () => ({ requestJira: site.requestJira('app') }), asUser: () => ({ requestJira: site.requestJira('user') }), route, fetch: site.fetch } });
mock.module('@forge/kvs', { exports: fakeKvs(site.kv) });
const svc = await import('../src/service.js');
const { runScanStep } = await import('../src/scan.js');
const store = await import('../src/store.js');

test('no Assets: sample and paste-in vehicles go to the register, scan opens the same requests, remedy updates the register', async () => {
  const r = await svc.loadSample();
  assert.equal(r.added, 25);
  assert.equal(r.inAssets, false);
  assert.match(r.note, /Assets isn't available/);
  const imp = await svc.importVehicles({ text: 'BUS-1, 1M8GDM9AXKP042788, P1, North' });
  assert.equal(imp.added, 1);
  let job;
  do job = await runScanStep({ who: 'user', trigger: 'manual' }); while (job.phase !== 'done');
  assert.equal(job.counts.opened, 15);
  assert.equal(job.counts.decodeFailed, 1, 'the 1989 bus is not in the recorded vPIC fixture');
  assert.equal(site.objects.size, 0);
  const c = (await store.listCases()).find((x) => x.level === 'park-it');
  assert.equal((await store.getVehicle(c.vin)).status, 'Park It – do not drive');
  await svc.markRemedied({ issueKey: c.issueKey, ro: 'RO-1', date: '2026-11-20' });
  assert.equal((await store.getVehicle(c.vin)).status, 'Available');
  const b = await svc.getBoard();
  assert.equal(b.setup.registerOnly, true);
  assert.equal(b.vehicles.length, 26);
});

test('a request type with required fields Roadworthy cannot fill stops the scan with a clear message', async () => {
  await svc.saveSettings({ serviceDeskId: '3', requestTypeId: '30' });
  await assert.rejects(async () => {
    let job;
    do job = await runScanStep({ who: 'user', trigger: 'manual', restart: true }); while (job.phase !== 'done');
  }, /requires Asset tag, which Roadworthy can't fill/);
  const s = await svc.getSettings();
  assert.deepEqual(s.blockingFields, ['Asset tag']);
});

test('no service project needed: recall work items go to a chosen Jira project', async () => {
  await svc.saveSettings({ target: 'jira', projectId: '10100', issueTypeId: '10001' });
  await store.saveVehicle({ ...(await store.listVehicles()).find((v) => v.name === 'TRK-205'), verifiedTo: '2025-01-01', checkFrom: '2025-01-01' });
  site.kv.delete('job:scan');
  let job;
  do job = await runScanStep({ who: 'user', trigger: 'manual', restart: true }); while (job.phase !== 'done');
  assert.ok(job.counts.opened > 0);
  assert.equal(job.counts.failed, 0);
  const ops = [...site.issues.keys()].filter((k) => k.startsWith('OPS-'));
  assert.equal(ops.length, job.counts.opened);
  assert.equal(site.issues.get(ops[0]).fields.issuetype.id, '10001');
});

// Manual check against the live NHTSA APIs (network): node --experimental-test-module-mocks --test test/live/nhtsa.live.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fakeKvs } from '../fakes/site.js';

mock.module('@forge/api', { exports: { fetch: (...a) => fetch(...a), asApp: () => ({}), asUser: () => ({}), route: String.raw } });
mock.module('@forge/kvs', { exports: fakeKvs(new Map()) });
const nhtsa = await import('../../src/nhtsa.js');
const { SAMPLE_FLEET } = await import('../../src/core/sample.js');

test('live vPIC decodes all 25 sample VINs', async () => {
  const rows = await nhtsa.decodeVins(SAMPLE_FLEET.map((v) => v.vin));
  assert.equal(rows.length, 25);
  for (const r of rows) assert.equal(r.clean, true, `${r.vin}: ${r.message}`);
});

test('live recalls: Maverick 2022 has the Park It campaign; ProMaster 2500 falls back to PROMASTER', async () => {
  const m = await nhtsa.campaignsFor('Ford', 'Maverick', 2022);
  assert.ok(m.campaigns.some((c) => c.id === '26V340000' && c.parkIt));
  const p = await nhtsa.campaignsFor('Ram', 'ProMaster 2500', 2020);
  assert.deepEqual(p.models, ['PROMASTER']);
  assert.ok(p.campaigns.length > 0);
  const none = await nhtsa.campaignsFor('Toyota', 'Nosuchmodel', 2020);
  assert.deepEqual(none.campaigns, []);
});

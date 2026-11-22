// Per-vehicle verdicts on real NHTSA recall text and real vPIC decodes of the sample fleet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assess, scopeOf, modelItems } from '../src/core/applicability.js';
import { parseRecalls } from '../src/core/recalls.js';
import { parseDecodeBatch } from '../src/core/decode.js';
import { SAMPLE_FLEET } from '../src/core/sample.js';

const fx = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const camp = (file, id) => parseRecalls(fx(file)).find((c) => c.id === id);
const decoded = new Map(parseDecodeBatch(fx('vpic_batch')).map((d) => [d.vin, d]));
const veh = (unit, extra = {}) => {
  const v = SAMPLE_FLEET.find((x) => x.name === unit);
  const d = decoded.get(v.vin);
  return { ...v, make: d.make, model: d.model, year: d.year, decoded: d, ...extra };
};
const verdict = (file, id, unit, extra, opts) => assess(camp(file, id), veh(unit, extra), opts);
const why = (r) => r.reasons.map((x) => x.text).join(' | ');

test('scope parsing splits the model list from the qualifying tail', () => {
  const s = scopeOf('Ford Motor Company (Ford) is recalling certain 2020-2022 Escape, 2021-2022 Lincoln Corsair, and 2022 Maverick vehicles equipped with 2.5L HEV or PHEV engines.  In the event of an engine failure...');
  assert.equal(s.tail.trim(), 'equipped with 2.5L HEV or PHEV engines');
  assert.deepEqual(modelItems(s.list, 'Maverick'), [{ item: 'MAVERICK', qualifier: '' }]);
  assert.deepEqual(modelItems('2022-2023 Maverick Hybrid', 'Maverick'), [{ item: 'MAVERICK HYBRID', qualifier: 'hybrid' }]);
  assert.deepEqual(modelItems('2018-2022 Transit Connect, 2020-2023 Aviator, Transit', 'Transit'), [{ item: 'TRANSIT', qualifier: '' }]);
});

test('engine: "2.5L HEV or PHEV engines" → hybrid Maverick likely, 2.0L EcoBoost unlikely', () => {
  const hybrid = verdict('recalls_ford_maverick_2022', '22V484000', 'TRK-204');
  assert.equal(hybrid.verdict, 'likely', why(hybrid));
  const eco = verdict('recalls_ford_maverick_2022', '22V484000', 'TRK-205');
  assert.equal(eco.verdict, 'unlikely');
  assert.match(why(eco), /Recall covers 2\.5L engines; this VIN decodes to 2\.0L ecoboost/);
});

test('model qualifier: "2022-2023 Maverick Hybrid vehicles"', () => {
  assert.equal(verdict('recalls_ford_maverick_2022', '24V140000', 'TRK-204').verdict, 'likely');
  const r = verdict('recalls_ford_maverick_2022', '24V140000', 'TRK-205');
  assert.equal(r.verdict, 'unlikely');
  assert.match(why(r), /maverick hybrid only; this VIN decodes to 2\.0L/);
});

test('engine list: "either a 2.7L or 3.0L Nano EcoBoost engine" across three F-150s', () => {
  assert.equal(verdict('recalls_ford_f-150_2021', '24V635000', 'TRK-202').verdict, 'likely'); // 2.7L
  assert.equal(verdict('recalls_ford_f-150_2021', '24V635000', 'TRK-201').verdict, 'unlikely'); // 5.0L
  assert.equal(verdict('recalls_ford_f-150_2021', '24V635000', 'TRK-203').verdict, 'unlikely'); // 3.5L
  assert.equal(verdict('recalls_ford_transit-connect_2019', '21V376000', 'VAN-106').verdict, 'likely'); // 2.5L
  assert.equal(verdict('recalls_ford_transit-connect_2019', '21V376000', 'VAN-105').verdict, 'unlikely'); // 2.0L
  assert.equal(verdict('recalls_ford_bronco-sport_2022', '22V191000', 'TRK-206').verdict, 'likely'); // 1.5L
});

test('drive type: AWD-only Transit recall vs rear-wheel-drive cargo vans', () => {
  const r = verdict('recalls_ford_transit_2020', '21V978000', 'VAN-103');
  assert.equal(r.verdict, 'unlikely');
  assert.match(why(r), /all-wheel drive vehicles; this VIN decodes to RWD\/Rear-Wheel Drive/);
});

test('converters and equipment makers: Rollx, Quality Vans, TransitWorks recalls on a factory cargo van', () => {
  for (const id of ['25V876000', '23V499000', '20V222000']) {
    const r = verdict('recalls_ford_transit_2020', id, 'VAN-103');
    assert.equal(r.verdict, 'unlikely', id);
    assert.equal(r.reasons[0].check, 'converter');
  }
  const converted = verdict('recalls_ford_transit_2020', '25V876000', 'VAN-103', { equipment: 'Rollx wheelchair conversion' });
  assert.equal(converted.verdict, 'likely', why(converted));
});

test('equipment the VIN cannot show: screens, hitches, keys', () => {
  assert.equal(verdict('recalls_ford_f-150_2021', '26V489000', 'TRK-201', { equipment: '8-inch SYNC screen' }).verdict, 'likely');
  const big = verdict('recalls_ford_f-150_2021', '26V489000', 'TRK-202', { equipment: '12-inch SYNC screen' });
  assert.equal(big.verdict, 'unlikely');
  assert.match(why(big), /8-inch screens; this vehicle has a 12-inch screen/);
  assert.equal(verdict('recalls_ford_f-150_2021', '26V489000', 'TRK-202', { equipment: '' }).verdict, 'possible');
  assert.equal(verdict('recalls_kia_sportage_2020', '22V703000', 'RNT-308', { equipment: 'no tow hitch' }).verdict, 'unlikely');
  assert.equal(verdict('recalls_kia_sportage_2020', '22V703000', 'RNT-308', { equipment: 'tow hitch' }).verdict, 'likely');
  assert.equal(verdict('recalls_kia_sportage_2020', '22V703000', 'RNT-308', { equipment: '' }).verdict, 'possible');
  const key = verdict('recalls_nissan_rogue_2020', '23V093000', 'RNT-304', { equipment: 'push-button start' });
  assert.equal(key.verdict, 'unlikely');
  assert.match(why(key), /jackknife .* this vehicle has push-button/);
});

test('earlier repairs: "previously repaired under Recall 21V-650" and chained campaigns', () => {
  const bolt = verdict('recalls_chevrolet_bolt-ev_2020', '24V812000', 'RNT-309');
  assert.equal(bolt.verdict, 'possible');
  assert.match(why(bolt), /no record of that repair/);
  assert.equal(verdict('recalls_chevrolet_bolt-ev_2020', '24V812000', 'RNT-309', {}, { prior: (id) => (id === '21V650000' ? 'remedied' : null) }).verdict, 'likely');
  const chained = verdict('recalls_ford_transit-connect_2019', '25V196000', 'VAN-105', {}, { prior: (id) => (id === '20V636000' ? 'unlikely' : null) });
  assert.equal(chained.verdict, 'unlikely');
});

test('plain scope is likely; a hybrid-only defect on a gasoline engine is possible; plain lists with a hybrid variant stay likely', () => {
  const ball = verdict('recalls_ford_maverick_2022', '26V340000', 'TRK-205');
  assert.equal(ball.verdict, 'likely');
  assert.match(why(ball), /no engine, drive or equipment limits stated/);
  assert.equal(verdict('recalls_ford_maverick_2022', '24V330000', 'TRK-205').verdict, 'possible');
  assert.equal(verdict('recalls_ford_maverick_2022', '24V330000', 'TRK-204').verdict, 'likely');
  assert.equal(verdict('recalls_toyota_camry_2021', '23V865000', 'RNT-301').verdict, 'likely');
  assert.equal(verdict('recalls_ford_transit-connect_2019', '25V442000', 'VAN-107').verdict, 'likely');
});

test('never wrongly rule out: converters without a "no conversions" note stay possible', () => {
  const r = verdict('recalls_ford_transit_2020', '25V876000', 'VAN-103', { equipment: '' });
  assert.equal(r.verdict, 'possible');
  assert.match(why(r), /covers only vehicles they modified/);
  assert.equal(verdict('recalls_ford_transit_2020', '23V499000', 'VAN-103', { equipment: 'factory cargo van, no conversions' }).verdict, 'unlikely');
});

test('never wrongly rule out: brand families are the same maker', () => {
  const gm = { id: 'X', manufacturer: 'General Motors, LLC', summary: 'General Motors, LLC (GM) is recalling certain 2021 GMC Sierra vehicles. A part may fail.', component: 'ENGINE' };
  assert.equal(assess(gm, { make: 'GMC', model: 'Sierra', decoded: { make: 'GMC', manufacturer: '' } }).verdict, 'likely');
  const stl = { id: 'Y', manufacturer: 'Chrysler (FCA US, LLC)', summary: 'Chrysler (FCA US, LLC) is recalling certain 2020 Ram ProMaster vehicles.', component: 'AIR BAGS' };
  assert.equal(assess(stl, { make: 'Ram', model: 'ProMaster', decoded: { make: 'Ram', manufacturer: 'STELLANTIS' } }).verdict, 'likely');
  const lin = { id: 'Z', manufacturer: 'Ford Motor Company', summary: 'Ford Motor Company (Ford) is recalling certain 2021 Lincoln Aviator vehicles.', component: 'SEATS' };
  assert.equal(assess(lin, { make: 'Lincoln', model: 'Aviator', decoded: { make: 'Lincoln', manufacturer: 'LINCOLN' } }).verdict, 'likely');
  const kia = { id: 'K', manufacturer: 'Hyundai Motor America', summary: 'Hyundai Motor America (Hyundai) is recalling certain 2021 Kia Sportage vehicles.', component: 'ENGINE' };
  assert.equal(assess(kia, { make: 'Kia', model: 'Sportage', decoded: { make: 'Kia', manufacturer: 'KIA CORPORATION' } }).verdict, 'likely');
  const other = { id: 'O', manufacturer: 'Mazda North American Operations', summary: 'Mazda is recalling certain 2021 Ford Transit vehicles.', component: 'ENGINE' };
  assert.equal(assess(other, { make: 'Ford', model: 'Transit', decoded: { make: 'Ford', manufacturer: 'FORD MOTOR COMPANY' } }).verdict, 'possible');
});

test('never wrongly rule out: a VIN that does not decode is never "unlikely"', () => {
  const r = assess(camp('recalls_ford_maverick_2022', '22V484000'), { make: 'Ford', model: 'Maverick', year: 2022, decoded: {} });
  assert.equal(r.verdict, 'possible');
  assert.equal(r.reasons[0].check, 'decode');
});

test('plants: recall plant names map to vPIC plant cities; unknown plants stay possible', () => {
  const c = (where) => ({ id: 'P', manufacturer: 'Ford Motor Company', component: 'STEERING', summary: `Ford Motor Company (Ford) is recalling certain 2021 F-150 vehicles built at ${where}. A bolt may loosen.` });
  const f150 = (plant) => ({ make: 'Ford', model: 'F-150', decoded: { make: 'Ford', manufacturer: 'FORD MOTOR COMPANY', plant } });
  assert.equal(assess(c('Kentucky Truck Plant'), f150('Louisville, United States (Usa)')).verdict, 'likely');
  assert.equal(assess(c('Kansas City Assembly Plant'), f150('Kansas City: Claycomo, United States (Usa)')).verdict, 'likely');
  assert.equal(assess(c('Dearborn Truck Plant'), f150('Kansas City: Claycomo, United States (Usa)')).verdict, 'unlikely');
  assert.equal(assess(c('Somewhere Assembly Plant'), f150('Dearborn, United States (Usa)')).verdict, 'possible');
  assert.equal(assess(c('Dearborn Truck Plant'), f150('')).verdict, 'possible');
});

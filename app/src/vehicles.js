// The vehicle register. With Assets connected, vehicles live in JSM Assets and KVS keeps a mirror (so scheduled
// scans can run without a user, and the board renders fast). Without Assets, the KVS mirror is the register.
import * as assets from './assets.js';
import * as store from './store.js';
import { validateVin } from './core/vin.js';

// Fields only Roadworthy keeps (never written to Assets).
const LOCAL = ['decoded', 'appGrounded', 'decodeError', 'sample', 'checkFrom', 'firstSeen'];

export const usesAssets = (cfg) => Boolean(cfg?.assets?.typeId);

/** Read the register; with Assets, refresh the mirror from Assets first (needs a user). */
export async function loadFleet(cfg, who = 'user') {
  const mirror = await store.listVehicles();
  if (!usesAssets(cfg) || who === 'app') return mirror;
  const byVin = new Map(mirror.map((v) => [v.vin, v]));
  const objects = await assets.listObjects(cfg.assets, who);
  const seen = new Set();
  const out = [];
  for (const o of objects) {
    if (!o.vin) continue;
    const prev = byVin.get(o.vin) || {};
    const keep = Object.fromEntries(LOCAL.filter((k) => k in prev).map((k) => [k, prev[k]]));
    // Assets wins for attributes people edit there; a pending (not yet written) change wins over Assets.
    const pending = await store.getPending(o.vin);
    // Fields the Vehicle type has no attribute for (an older Fleet schema, a schema someone else made) stay as we had them.
    const unmapped = Object.entries(assets.FIELD_OF).filter(([name]) => !cfg.assets.attrs[name]).map(([, f]) => f);
    const local = Object.fromEntries(unmapped.filter((f) => f in prev).map((f) => [f, prev[f]]));
    const v = { ...local, ...o, ...keep, ...(pending?.fields || {}), firstSeen: prev.firstSeen || Date.now() };
    seen.add(o.vin);
    if (JSON.stringify(v) !== JSON.stringify(prev)) await store.saveVehicle(v);
    out.push(v);
  }
  for (const v of mirror) if (v.objectId && !seen.has(v.vin)) await store.deleteVehicle(v.vin);
  // Register-only vehicles (added before Assets was connected) stay listed.
  for (const v of mirror) if (!v.objectId && !seen.has(v.vin)) out.push(v);
  return out;
}

/**
 * Change a vehicle. Writes the mirror, then Assets. When Assets refuses (no user present, see ECO-1808), the change
 * is queued in pending:<VIN> and written the next time someone opens Roadworthy. Returns 'assets' | 'queued' | 'local'.
 */
export async function updateVehicle(cfg, v, fields, who = 'user') {
  const next = { ...v, ...fields };
  await store.saveVehicle(next);
  const remote = Object.fromEntries(Object.entries(fields).filter(([k]) => !LOCAL.includes(k)));
  if (!usesAssets(cfg) || !v.objectId || !Object.keys(remote).length) return 'local';
  try {
    await writeAssets(cfg, v.objectId, remote, who);
    return 'assets';
  } catch (e) {
    if (who === 'user') throw e;
    const prev = (await store.getPending(v.vin)) || { fields: {} };
    await store.savePending(v.vin, { objectId: v.objectId, fields: { ...prev.fields, ...remote }, at: Date.now() });
    return 'queued';
  }
}

// Status and the open-recall count matter most; if Assets rejects the whole change (400, e.g. a date format it
// doesn't take), write those two alone rather than fail the remediation.
async function writeAssets(cfg, objectId, fields, who) {
  try {
    await assets.updateObject(cfg.assets, objectId, fields, who);
  } catch (e) {
    const core = Object.fromEntries(Object.entries(fields).filter(([k]) => k === 'status' || k === 'openRecalls'));
    if (e.status !== 400 || !Object.keys(core).length || Object.keys(core).length === Object.keys(fields).length) throw e;
    console.warn('Roadworthy: Assets refused some fields, writing status only', e.message);
    await assets.updateObject(cfg.assets, objectId, core, who);
  }
}

/** Write queued Assets changes (call with a user present). Returns how many vehicles were written. */
export async function flushPending(cfg, who = 'user') {
  if (!usesAssets(cfg)) return 0;
  let n = 0;
  for (const p of await store.listPending()) {
    try {
      await writeAssets(cfg, p.objectId, p.fields, who);
      await store.deletePending(p.vin);
      n++;
    } catch (e) {
      console.error('Roadworthy: pending Assets write failed', p.vin, e.message);
      if (e.status === 404) await store.deletePending(p.vin);
    }
  }
  return n;
}

/**
 * Add vehicles ({ name, vin, plate, depot, driver, verifiedTo, ... }). Skips invalid VINs and VINs already in the
 * register. Returns { added: [vehicle], skipped: [{ vin, reason }] }.
 */
export async function addVehicles(cfg, list, who = 'user', { deadline = Infinity } = {}) {
  const existing = new Set((await store.listVehicles()).map((v) => v.vin));
  const added = [];
  const skipped = [];
  for (const raw of list) {
    if (Date.now() > deadline) {
      skipped.push({ vin: raw.vin, reason: 'later' });
      continue;
    }
    const check = validateVin(raw.vin);
    if (!check.ok) {
      skipped.push({ vin: raw.vin, reason: check.error });
      continue;
    }
    if (existing.has(check.vin)) {
      skipped.push({ vin: check.vin, reason: 'Already in the register' });
      continue;
    }
    let v = { ...raw, vin: check.vin, status: raw.status || 'Available', openRecalls: 0, firstSeen: Date.now() };
    if (usesAssets(cfg)) v = { ...v, ...(await assets.createObject(cfg.assets, v, who)) };
    await store.saveVehicle(v);
    existing.add(v.vin);
    added.push(v);
  }
  return { added, skipped };
}

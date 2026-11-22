// NHTSA calls (declared as backend egress in manifest.yml). Only the VIN (to vPIC) and the make, model and model
// year (to the recalls API) leave the site: no names, plates, drivers or Jira data.
import { fetch } from '@forge/api';
import { parseDecodeBatch, decodeBatches } from './core/decode.js';
import { parseRecalls, recallModelsFor, recallKey } from './core/recalls.js';
import * as store from './store.js';

const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesBatch/';
const RECALLS = 'https://api.nhtsa.gov/recalls/recallsByVehicle';
const MODELS = 'https://api.nhtsa.gov/products/vehicle/models';
const TTL_MS = 12 * 3600e3;

const nhtsaError = (what, status) => Object.assign(new Error(`${what} failed (${status || 'timeout'})`), { status: status || 504, what, product: 'NHTSA' });
const TIMEOUT_MS = 8000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with an 8-second timeout and two retries (1 s, then 3 s) on timeouts, network errors, 429 and 5xx.
 * NHTSA's 400 "no results" answer is returned as is.
 */
export async function fetchRetry(url, opts = {}, what = 'Calling NHTSA', { tries = 3, timeoutMs = TIMEOUT_MS, deadline = Infinity } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    const pause = i === 0 ? 0 : i === 1 ? 1000 : 3000;
    // Never start an attempt that can't finish before the caller's deadline (resolvers must answer in 25 s).
    if (i && Date.now() + pause + timeoutMs > deadline) break;
    if (pause) await sleep(pause);
    try {
      const res = await Promise.race([
        fetch(url, opts),
        sleep(timeoutMs).then(() => { throw nhtsaError(what, 0); }),
      ]);
      if (res.status === 429 || res.status >= 500) {
        last = nhtsaError(what, res.status);
        continue;
      }
      return res;
    } catch (e) {
      last = e.what ? e : nhtsaError(what, 0);
    }
  }
  throw last;
}

/** Decode up to 50 VINs per call. Returns parsed rows (see core/decode.js). */
export async function decodeVins(vins, { deadline = Infinity, batch = 50 } = {}) {
  const out = [];
  for (const data of decodeBatches(vins, batch)) {
    const res = await fetchRetry(VPIC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ format: 'json', data }).toString(),
    }, 'Decoding VINs with NHTSA vPIC', { timeoutMs: 12000, deadline });
    if (!res.ok) throw nhtsaError('Decoding VINs with NHTSA vPIC', res.status);
    out.push(...parseDecodeBatch(await res.json()));
  }
  return out;
}

async function getJson(url, what, deadline) {
  const res = await fetchRetry(url, { headers: { Accept: 'application/json' } }, what, { deadline });
  // The recalls API answers 400 with {"Count":0,"results":[]} when it has nothing for that vehicle.
  if (res.status === 400) return res.json().catch(() => ({ results: [] }));
  if (!res.ok) throw nhtsaError(what, res.status);
  return res.json();
}

async function recallsFor(make, model, year, deadline) {
  const q = new URLSearchParams({ make, model, modelYear: String(year) });
  return parseRecalls(await getJson(`${RECALLS}?${q}`, `Reading NHTSA recalls for ${year} ${make} ${model}`, deadline));
}

/**
 * Campaigns NHTSA lists for a make/model/year, cached for 12 hours. When the vPIC model name finds nothing, try the
 * recall model names NHTSA uses for that make and year ("ProMaster 2500" -> "PROMASTER").
 * Returns { key, campaigns, models, fetchedAt, cached }.
 */
export async function campaignsFor(make, model, year, { force = false, deadline = Infinity } = {}) {
  const key = recallKey(make, model, year);
  const hit = await store.getRecalls(key);
  if (!force && hit && Date.now() - hit.fetchedAt < TTL_MS) return { ...hit, key, cached: true };
  let models = [model];
  let campaigns = await recallsFor(make, model, year, deadline);
  if (!campaigns.length) {
    const q = new URLSearchParams({ modelYear: String(year), make, issueType: 'r' });
    const list = (await getJson(`${MODELS}?${q}`, 'Reading NHTSA model names', deadline))?.results || [];
    const alt = recallModelsFor(model, list.map((m) => m.model)).filter((m) => m.toUpperCase() !== model.toUpperCase());
    if (alt.length) {
      models = alt;
      const seen = new Map();
      for (const m of alt) for (const c of await recallsFor(make, m, year, deadline)) if (!seen.has(c.id)) seen.set(c.id, c);
      campaigns = [...seen.values()];
    }
  }
  const value = { fetchedAt: Date.now(), models, campaigns };
  await store.saveRecalls(key, value);
  return { ...value, key, cached: false };
}

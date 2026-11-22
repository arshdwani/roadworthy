// The recall scan, as a resumable job. Each call to runScanStep works until its time budget is used, saves where it
// got to in job:scan and returns; the board calls it again until it is done (resolvers must answer within 25 s), and
// the hourly scheduled trigger finishes a scan or starts the daily one.
//
// Phases: load (read the register) -> decode (vPIC) -> recalls (NHTSA, one call per make/model/year, cached)
//         -> open (one JSM request per new campaign x vehicle, Park It first) -> status (update vehicles) -> done
import * as store from './store.js';
import * as nhtsa from './nhtsa.js';
import * as jira from './jira.js';
import * as fleet from './vehicles.js';
import * as assets from './assets.js';
import { planCases, planStatuses } from './core/scan.js';
import { recallKey } from './core/recalls.js';
import { isoDate, isGrounding } from './core/severity.js';
import { isOpen } from './core/fleet.js';
import { requestSummary, requestDescription } from './core/adf.js';
import { UserError } from './errors.js';

const PHASES = ['load', 'decode', 'recalls', 'open', 'status', 'done'];
const DECODE_VERSION = 2; // bump when we keep more vPIC fields
const DAY_MS = 864e5;

const STALE_MS = 30 * 60e3; // an unfinished scan untouched this long is abandoned by "Scan now"
const TRIES = 3; // attempts per NHTSA lookup across scan steps before it counts as failed

export const scanDue = (job) => !job || (job.phase === 'done' && Date.now() - (job.finishedAt || 0) > DAY_MS - 3600e3);

export function newJob({ by, trigger }) {
  return {
    id: `scan-${Date.now()}`,
    trigger,
    by: by || null,
    startedAt: Date.now(),
    phase: 'load',
    counts: { vehicles: 0, decoded: 0, decodeFailed: 0, decodeUnavailable: 0, models: 0, recallsFailed: 0, campaigns: 0, matches: 0, opened: 0, failed: 0, likely: 0, possible: 0, ruledOut: 0, checkOnce: 0, escalated: 0, statusChanges: 0, queued: 0 },
    tries: {},
    warnings: [],
    errors: [],
  };
}

const warn = (job, msg) => {
  if (job.warnings.length < 20 && !job.warnings.includes(msg)) job.warnings.push(msg);
};

/**
 * Run one slice of the scan. `who`: 'user' from the board, 'app' from the scheduled trigger.
 * Returns the job (phase 'done' when finished).
 */
export async function runScanStep({ who = 'user', budgetMs = 18000, accountId, trigger = 'manual', restart = false } = {}) {
  const deadline = Date.now() + budgetMs;
  const cfg = await store.getConfig();
  const target = cfg.target === 'jira' ? cfg.jiraProject?.projectId && cfg.jiraProject?.issueTypeId : cfg.serviceDeskId && cfg.requestTypeId;
  if (!target) throw new UserError('Choose where recall requests go (a service project, or a Jira project) in Settings first.');
  let job = await store.getJob();
  // "Scan now" resumes an unfinished scan (after a timeout or a closed tab) instead of starting over.
  const stale = job && Date.now() - (job.updatedAt || job.startedAt || 0) > STALE_MS;
  if (!job || job.phase === 'done' || (restart && stale)) job = newJob({ by: accountId, trigger });
  job.tries ||= {};
  const today = isoDate(Date.now());
  const site = await jira.siteUrl().catch(() => '');

  try {
    while (job.phase !== 'done' && Date.now() < deadline) {
      if (job.phase === 'load') {
        // Older Fleet schemas get the attributes added since (e.g. Equipment), when a user is present.
        if (who === 'user' && cfg.assets && cfg.assets.version !== assets.SCHEMA_VERSION) {
          cfg.assets = await assets.ensureFleetSchema(cfg.assets.workspaceId, { schemaId: cfg.assets.schemaId, who });
          await store.saveConfig({ ...(await store.getConfig()), assets: cfg.assets });
        }
        const list = await fleet.loadFleet(cfg, who);
        job.counts.vehicles = list.length;
        job.phase = 'decode';
      } else if (job.phase === 'decode') {
        const todo = (await store.listVehicles()).filter((v) => v.decoded?.v !== DECODE_VERSION && !v.decodeError).slice(0, 50);
        if (!todo.length) {
          job.phase = 'recalls';
          continue;
        }
        let rows;
        try {
          rows = await nhtsa.decodeVins(todo.map((v) => v.vin), { deadline, batch: who === 'user' ? 25 : 50 });
        } catch (e) {
          // vPIC down or slow: try again on the next step; after three tries, scan the rest without decoding.
          job.tries.decode = (job.tries.decode || 0) + 1;
          if (job.tries.decode < TRIES) break;
          job.counts.decodeUnavailable += todo.length;
          warn(job, `NHTSA vPIC didn't answer (${e.message}); ${todo.length} VINs were not decoded this time.`);
          job.phase = 'recalls';
          continue;
        }
        const byVin = new Map(rows.map((r) => [r.vin, r]));
        for (const v of todo) {
          const d = byVin.get(v.vin);
          if (!d?.ok) {
            job.counts.decodeFailed++;
            warn(job, `${v.name || v.vin}: vPIC could not decode the VIN${d?.message ? ` (${d.message})` : ''}.`);
            await store.saveVehicle({ ...v, decodeError: d?.message || 'Not decoded' });
            continue;
          }
          job.counts.decoded++;
          const { vin: _v, ok: _o, clean: _c, message: _m, ...fields } = d;
          const decoded = { ...fields, v: DECODE_VERSION, at: Date.now() };
          // Fill make/model/year in the register when people left them empty; never overwrite what they typed.
          const fill = {};
          if (!v.make) fill.make = d.make;
          if (!v.model) fill.model = d.model;
          if (!v.year) fill.year = d.year;
          const r = await fleet.updateVehicle(cfg, v, { ...fill, decoded }, who);
          if (r === 'queued') job.counts.queued++;
        }
      } else if (job.phase === 'recalls') {
        const vehicles = await store.listVehicles();
        const keys = new Map();
        for (const v of vehicles) {
          const m = vehicleModel(v);
          if (m) keys.set(recallKey(m.make, m.model, m.year), m);
        }
        job.counts.models = keys.size;
        let pending = false;
        for (const [k, m] of keys) {
          if (Date.now() > deadline) {
            pending = true;
            break;
          }
          if ((job.fetched || []).includes(k)) continue;
          try {
            const r = await nhtsa.campaignsFor(m.make, m.model, m.year, { force: job.trigger === 'manual', deadline });
            for (const c of r.campaigns) await store.saveCampaign(c);
          } catch (e) {
            // Retry on the next step; after three failed tries, count it and fall back to the last cached answer.
            job.tries[k] = (job.tries[k] || 0) + 1;
            if (job.tries[k] < TRIES) {
              pending = true;
              break;
            }
            job.counts.recallsFailed++;
            const old = await store.getRecalls(k);
            warn(job, `NHTSA recalls for ${m.year} ${m.make} ${m.model} didn't load (${e.message})${old ? `; used the copy from ${isoDate(old.fetchedAt)}` : '; these vehicles were not checked this time'}.`);
          }
          job.fetched = [...(job.fetched || []), k];
        }
        if (!pending) job.phase = 'open';
      } else if (job.phase === 'open') {
        // Check the request type's form once per scan: required fields we can't fill would fail every create.
        if (cfg.target !== 'jira' && !job.formChecked) {
          const blocking = jira.blockingFields(await jira.requestTypeFields(cfg.serviceDeskId, cfg.requestTypeId, who === 'app' ? 'app' : 'user').catch(() => []));
          if (blocking.length) {
            throw new UserError(`The request type "${cfg.requestTypeName || cfg.requestTypeId}" requires ${blocking.join(', ')}, which Roadworthy can't fill. In Settings, choose another request type or create the "Vehicle safety recall" type.`);
          }
          job.formChecked = true;
        }
        const done = await openRequests({ cfg, job, who, today, site, deadline });
        if (done) job.phase = 'status';
      } else if (job.phase === 'status') {
        const done = await updateStatuses({ cfg, job, who, today, deadline });
        if (done) {
          job.phase = 'done';
          job.finishedAt = Date.now();
        }
      }
      job.phaseIndex = PHASES.indexOf(job.phase);
      job.updatedAt = Date.now();
      await store.saveJob(job);
    }
  } catch (e) {
    job.errors = [...(job.errors || []), e.message].slice(-5);
    await store.saveJob(job);
    throw e;
  }
  job.updatedAt = Date.now();
  // Honest result: a scan that couldn't open some requests or read some recalls says so.
  job.problems = job.counts.failed + job.counts.recallsFailed + job.counts.decodeUnavailable;
  await store.saveJob(job);
  return job;
}

/** Make/model/year to look up: what people entered, else what vPIC decoded. */
export function vehicleModel(v) {
  const make = v.make || v.decoded?.make;
  const model = v.model || v.decoded?.model;
  const year = Number(v.year || v.decoded?.year) || null;
  return make && model && year ? { make, model, year } : null;
}

async function recallsIndex(vehicles) {
  const out = {};
  for (const v of vehicles) {
    const m = vehicleModel(v);
    if (!m) continue;
    const k = recallKey(m.make, m.model, m.year);
    if (k in out) continue;
    const hit = await store.getRecalls(k);
    if (hit) out[k] = hit.campaigns;
  }
  return out;
}

async function openRequests({ cfg, job, who, today, site, deadline }) {
  const vehicles = (await store.listVehicles()).map((v) => ({ ...v, ...vehicleModel(v) }));
  const recallsByKey = await recallsIndex(vehicles);
  const existing = await store.listCases();
  const claimed = new Set(await store.listClaims());
  const dismissed = new Set((await store.listDismissed()).map((d) => d.key));
  const { newCases, reviews, checkOnce } = planCases({ vehicles, recallsByKey, existing, today, claimed, dismissed, policy: { ...(cfg.dueDays || {}), openUnlikely: cfg.openUnlikely } });
  job.counts.checkOnce = checkOnce.length;
  job.counts.campaigns = new Set([...newCases.map((c) => c.campaign.id), ...existing.filter(isOpen).map((c) => c.campaign)]).size;
  job.counts.ruledOut = reviews.length;
  job.counts.matches = existing.length + newCases.length + reviews.length;
  // Unlikely matches are kept for review (no request); drop reviews that no longer apply.
  if (!job.reviewsSaved) {
    const keep = new Set(reviews.map((r) => r.key));
    for (const old of await store.listReviews()) if (!keep.has(old.key)) await store.deleteReview(old.key);
    for (const r of reviews) {
      await store.saveReview({
        key: r.key, campaign: r.campaign.id, vin: r.vin, level: r.severity.level, component: r.campaign.component,
        verdict: r.applicability.verdict, reasons: r.applicability.reasons, at: Date.now(),
      });
    }
    const keepChecks = new Set(checkOnce.map((r) => r.key));
    for (const old of await store.listChecks()) if (!keepChecks.has(old.key)) await store.deleteCheck(old.key);
    for (const r of checkOnce) {
      await store.saveCheck({
        key: r.key, campaign: r.campaign.id, vin: r.vin, level: r.severity.level, component: r.campaign.component, reported: r.campaign.reported,
        verdict: r.applicability.verdict, reasons: r.applicability.reasons, at: Date.now(),
      });
    }
    job.reviewsSaved = true;
  }
  const byVin = new Map(vehicles.map((v) => [v.vin, v]));
  for (const n of newCases) {
    if (Date.now() > deadline) return false;
    const v = byVin.get(n.vin);
    try {
      const c = await openOne({ cfg, n, v, who, today, site, job, accountId: job.by });
      if (!c) continue; // another scan got here first
      job.counts.opened++;
      job.counts[n.applicability.verdict === 'possible' ? 'possible' : 'likely']++;
      if (isGrounding(n.severity.level)) job.counts.escalated++;
    } catch (e) {
      job.counts.failed++;
      warn(job, `Could not open a request for ${n.campaign.id} on ${v.name || v.vin}: ${e.message}`);
      if (e.status === 401 || e.status === 403) throw e;
    }
  }
  return true;
}

/**
 * Claim, raise the request, record the case and ground the vehicle at once for Park It / Park Outside.
 * Returns the case, or null when another scan already claimed it. On failure the claim is released and it throws.
 */
export async function openOne({ cfg, n, v, who, today, site, job, accountId, note }) {
  if (!(await store.claim(n.key))) return null;
  const url = site ?? (await jira.siteUrl().catch(() => ''));
  const assetUrl = assets.objectUrl(url, cfg.assets, v.objectId);
  try {
    const created = await createAs(cfg, who, {
      jiraProject: cfg.target === 'jira' ? cfg.jiraProject : null,
      serviceDeskId: cfg.serviceDeskId,
      requestTypeId: cfg.requestTypeId,
      summary: requestSummary(n.campaign, v, n.severity),
      description: requestDescription({ campaign: n.campaign, vehicle: v, severity: n.severity, due: n.due, assetUrl, assetKey: v.objectKey, applicability: n.applicability }),
      assetField: cfg.assetFieldId && v.objectId ? { id: cfg.assetFieldId, workspaceId: cfg.assets?.workspaceId, objectId: v.objectId } : null,
      priority: n.severity.priority,
      due: n.due,
      labels: ['roadworthy', 'recall', ...(isGrounding(n.severity.level) ? [n.severity.level] : []), ...(n.applicability.verdict === 'possible' ? ['verify-vin'] : []), ...(v.sample ? ['roadworthy-sample'] : [])],
      property: { campaign: n.campaign.id, vin: n.vin, level: n.severity.level, due: n.due, verdict: n.applicability.verdict },
    }, job);
    if (job) for (const w of created.warnings) warn(job, `${created.key}: ${w}`);
    const c = {
      key: n.key,
      campaign: n.campaign.id,
      vin: n.vin,
      vehicleName: v.name || '',
      depot: v.depot || '',
      component: n.campaign.component,
      level: n.severity.level,
      priority: n.severity.priority,
      reason: n.severity.reason,
      due: n.due,
      opened: today,
      state: 'open',
      verdict: n.applicability.verdict,
      reasons: n.applicability.reasons,
      sample: Boolean(v.sample),
      assetKey: v.objectKey || null,
      issueKey: created.key,
      issueId: created.id,
      history: [{ at: Date.now(), by: accountId || null, what: 'opened', detail: note || `Opened from NHTSA campaign ${n.campaign.id} (${n.severity.label}, due ${n.due}).` }],
    };
    await store.saveCase(c);
    await store.linkIssue(created.key, n.key);
    // Ground the vehicle at once, not at the end of the scan.
    if (isGrounding(n.severity.level)) await applyStatus({ cfg, vin: n.vin, who, job, today });
    return c;
  } catch (e) {
    await store.releaseClaim(n.key);
    throw e;
  }
}

// Requests are raised by the app ("Roadworthy" as reporter), so they don't depend on who clicked Scan. If the app
// can't raise requests in that project, fall back to the signed-in user and remember it.
async function createAs(cfg, who, args, job = { warnings: [] }) {
  const first = cfg.raiseAs === 'user' && who === 'user' ? 'user' : 'app';
  try {
    return await jira.createRequest({ ...args, who: first });
  } catch (e) {
    if (first === 'user' || who !== 'user' || ![400, 401, 403].includes(e.status)) throw e;
    const r = await jira.createRequest({ ...args, who: 'user' });
    warn(job, `The app could not raise requests (${e.status}); raised as you instead.`);
    await store.saveConfig({ ...(await store.getConfig()), raiseAs: 'user' });
    cfg.raiseAs = 'user';
    return r;
  }
}

/** Recompute one vehicle's status from its cases and write it if it changed. */
export async function applyStatus({ cfg, vin, who, job, today }) {
  const v = await store.getVehicle(vin);
  if (!v) return null;
  const cases = (await store.listCases()).filter((c) => c.vin === vin);
  const [change] = planStatuses({ vehicles: [v], cases, parkOutsideGrounds: cfg.parkOutsideGrounds !== false });
  const openRecalls = cases.filter(isOpen).length;
  const fields = {};
  if (change) Object.assign(fields, { status: change.to, appGrounded: change.appGrounded });
  if (Number(v.openRecalls) !== openRecalls) fields.openRecalls = openRecalls;
  if (today && String(v.lastCheck || '').slice(0, 10) !== today) fields.lastCheck = new Date().toISOString();
  if (!Object.keys(fields).length) return null;
  const r = await fleet.updateVehicle(cfg, v, fields, who);
  if (job) {
    if (change) job.counts.statusChanges++;
    if (r === 'queued') job.counts.queued++;
  }
  return change || null;
}

async function updateStatuses({ cfg, job, who, today, deadline }) {
  const vehicles = await store.listVehicles();
  for (const v of vehicles) {
    if (Date.now() > deadline) return false;
    if ((job.statusDone || []).includes(v.vin)) continue;
    try {
      await applyStatus({ cfg, vin: v.vin, who, job, today });
    } catch (e) {
      warn(job, `Could not update ${v.name || v.vin}: ${e.message}`);
    }
    job.statusDone = [...(job.statusDone || []), v.vin];
  }
  return true;
}

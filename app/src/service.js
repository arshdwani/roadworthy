// Roadworthy's operations, shared by the UI resolvers, the scheduled trigger and the Rovo actions.
import * as store from './store.js';
import * as jira from './jira.js';
import * as assets from './assets.js';
import * as fleet from './vehicles.js';
import { applyStatus, vehicleModel } from './scan.js';
import { fleetStats, isOpen, STATUS, dispatchable } from './core/fleet.js';
import { LEVELS, daysBetween, isoDate, levelRank } from './core/severity.js';
import { auditComment, vehicleLabel } from './core/adf.js';
import { campaignUrl, vinLookupUrl } from './core/recalls.js';
import { SAMPLE_FLEET } from './core/sample.js';
import { parseFleetCsv } from './core/csv.js';
import { VERDICT_LABEL } from './core/applicability.js';
import { classify, dueDate } from './core/severity.js';
import { openOne } from './scan.js';
import { UserError } from './errors.js';

const SAMPLE_VINS = new Set(SAMPLE_FLEET.map((v) => v.vin));

export const requireAdmin = async (what) => {
  if (!(await jira.isJiraAdmin().catch(() => false))) throw new UserError(`Only Jira administrators can ${what}.`);
};

// ---- Settings -------------------------------------------------------------------------------------------
export async function getSettings() {
  const cfg = await store.getConfig();
  const [isAdmin, desks, ws] = await Promise.all([
    jira.isJiraAdmin().catch(() => false),
    jira.listServiceDesks('user').catch(() => []),
    cfg.assets?.workspaceId ? Promise.resolve(cfg.assets.workspaceId) : assets.workspaceId('user').catch(() => null),
  ]);
  const requestTypes = cfg.serviceDeskId ? await jira.listRequestTypes(cfg.serviceDeskId).catch(() => []) : [];
  const blocking = cfg.serviceDeskId && cfg.requestTypeId && cfg.target !== 'jira'
    ? jira.blockingFields(await jira.requestTypeFields(cfg.serviceDeskId, cfg.requestTypeId).catch(() => []))
    : [];
  const projects = !desks.length || cfg.target === 'jira' ? await jira.listProjects().catch(() => []) : [];
  const issueTypes = cfg.jiraProject?.projectId ? await jira.listIssueTypes(cfg.jiraProject.projectId).catch(() => []) : [];
  return {
    isAdmin,
    serviceDeskId: cfg.serviceDeskId || null,
    requestTypeId: cfg.requestTypeId || null,
    parkOutsideGrounds: cfg.parkOutsideGrounds !== false,
    assets: cfg.assets ? { schemaId: cfg.assets.schemaId, schemaName: cfg.assets.schemaName, typeId: cfg.assets.typeId } : null,
    assetsAvailable: Boolean(ws),
    target: cfg.target === 'jira' || !desks.length ? 'jira' : 'jsm',
    blockingFields: blocking,
    hasRecallType: requestTypes.some((t) => /vehicle safety recall/i.test(t.name)),
    projects,
    issueTypes,
    jiraProject: cfg.jiraProject || null,
    registerOnly: Boolean(cfg.registerOnly),
    openUnlikely: Boolean(cfg.openUnlikely),
    assetFieldId: cfg.assetFieldId || null,
    assetFields: await jira.listAssetFields().catch(() => []),
    desks,
    requestTypes,
  };
}

export async function listRequestTypes(serviceDeskId) {
  return jira.listRequestTypes(serviceDeskId);
}

export async function saveSettings(p) {
  await requireAdmin('change Roadworthy settings');
  const cfg = await store.getConfig();
  if (p.target === 'jira') {
    if (!p.projectId || !p.issueTypeId) throw new UserError('Choose a Jira project and a work type.');
    const proj = (await jira.listProjects()).find((x) => String(x.id) === String(p.projectId));
    const type = (await jira.listIssueTypes(p.projectId)).find((t) => String(t.id) === String(p.issueTypeId));
    if (!proj || !type) throw new UserError('Choose a Jira project and a work type.');
    Object.assign(cfg, { target: 'jira', jiraProject: { projectId: proj.id, projectKey: proj.key, projectName: proj.name, issueTypeId: type.id, issueTypeName: type.name } });
  } else if (p.serviceDeskId !== undefined) {
    cfg.target = 'jsm';
    const desks = await jira.listServiceDesks('user');
    const desk = desks.find((d) => String(d.id) === String(p.serviceDeskId));
    if (!desk) throw new UserError('Choose a service project.');
    const types = await jira.listRequestTypes(desk.id);
    const type = types.find((t) => String(t.id) === String(p.requestTypeId)) || jira.defaultRequestType(types);
    if (!type) throw new UserError(`${desk.projectName} has no request types yet. Add one in its project settings.`);
    Object.assign(cfg, { serviceDeskId: desk.id, projectKey: desk.projectKey, projectName: desk.projectName, requestTypeId: type.id, requestTypeName: type.name });
  }
  if (p.parkOutsideGrounds !== undefined) cfg.parkOutsideGrounds = Boolean(p.parkOutsideGrounds);
  if (p.openUnlikely !== undefined) cfg.openUnlikely = Boolean(p.openUnlikely);
  if (p.assetFieldId !== undefined) cfg.assetFieldId = p.assetFieldId || null;
  // Keep vehicles in Roadworthy's own register even where Assets exists (or go back to Assets).
  if (p.registerOnly !== undefined) {
    cfg.registerOnly = Boolean(p.registerOnly);
    if (cfg.registerOnly) delete cfg.assets;
    else delete cfg.assetsNote;
  }
  await store.saveConfig(cfg);
  return { ok: true };
}

/** Create the "Vehicle safety recall" request type in the chosen service project and select it. */
export async function createRecallRequestType() {
  await requireAdmin('create a request type');
  const cfg = await store.getConfig();
  if (!cfg.serviceDeskId) throw new UserError('Choose a service project first.');
  const types = await jira.listRequestTypes(cfg.serviceDeskId);
  const existing = types.find((t) => /vehicle safety recall/i.test(t.name));
  const base = types.find((t) => String(t.id) === String(cfg.requestTypeId)) || types[0];
  const created = existing || (await jira.createRequestType(cfg.serviceDeskId, base?.issueTypeId).catch((e) => {
    if (e.status === 401 || e.status === 403) throw new UserError('Only an admin of this service project can create request types. Ask one, or pick an existing request type.');
    console.error('Roadworthy: request type create failed', e.message);
    throw new UserError(`Jira didn't create the request type (${String(e.body || '').replace(/[{}"]/g, ' ').trim().slice(0, 160) || e.status}). Create it in Project settings → Request types, then pick it here.`);
  }));
  Object.assign(cfg, { requestTypeId: String(created.id), requestTypeName: created.name, target: 'jsm' });
  await store.saveConfig(cfg);
  return { ok: true, name: created.name, existed: Boolean(existing) };
}

/** Find or create the Fleet schema in Assets. Returns false when Assets isn't available on this site. */
export async function connectAssets({ schemaId } = {}) {
  await requireAdmin('connect Assets');
  const ws = await assets.workspaceId('user');
  if (!ws) return { ok: false, reason: "Assets isn't available on this site, so Roadworthy keeps vehicles in its own register." };
  const cfg = await store.getConfig();
  cfg.assets = await assets.ensureFleetSchema(ws, { schemaId: schemaId || cfg.assets?.schemaId, who: 'user' });
  await store.saveConfig(cfg);
  return { ok: true, assets: cfg.assets };
}

// Bring an older Fleet schema up to date (new attributes such as Equipment) before writing vehicles to it.
async function ensureSchemaVersion(cfg) {
  if (!cfg.assets || cfg.assets.version === assets.SCHEMA_VERSION) return cfg;
  cfg.assets = await assets.ensureFleetSchema(cfg.assets.workspaceId, { schemaId: cfg.assets.schemaId, who: 'user' });
  await store.saveConfig(cfg);
  return cfg;
}

// Pick the first service project and a sensible request type when none is chosen yet (sample data, first scan).
async function ensureProject(cfg) {
  if (cfg.target === 'jira' ? cfg.jiraProject?.projectId : cfg.serviceDeskId && cfg.requestTypeId) return cfg;
  const desks = await jira.listServiceDesks('user');
  if (!desks.length) throw new UserError('This site has no Jira Service Management project. In Settings, choose a Jira project instead; Roadworthy will create recall work items there.');
  const desk = jira.defaultDesk(desks);
  const type = jira.defaultRequestType(await jira.listRequestTypes(desk.id));
  if (!type) throw new UserError(`${desk.projectName} has no request types yet.`);
  Object.assign(cfg, { serviceDeskId: desk.id, projectKey: desk.projectKey, projectName: desk.projectName, requestTypeId: type.id, requestTypeName: type.name });
  await store.saveConfig(cfg);
  return cfg;
}

// ---- Sample fleet ---------------------------------------------------------------------------------------
/** Add the 25 sample vehicles (resumable: call until remaining is 0). Then run a normal scan. */
export async function loadSample({ budgetMs = 15000 } = {}) {
  await requireAdmin('load the sample fleet');
  const deadline = Date.now() + budgetMs;
  let cfg = await ensureProject(await store.getConfig());
  if (!cfg.assets && !cfg.registerOnly) {
    const r = await connectAssets().catch((e) => ({ ok: false, reason: e.message }));
    cfg = await store.getConfig();
    if (!r.ok) {
      cfg.registerOnly = true;
      cfg.assetsNote = r.reason;
      await store.saveConfig(cfg);
    }
  }
  cfg = await ensureSchemaVersion(cfg);
  const rows = SAMPLE_FLEET.map((v) => ({ ...v, sample: true }));
  const { added, skipped } = await fleet.addVehicles(cfg, rows, 'user', { deadline });
  const remaining = skipped.filter((s) => s.reason === 'later').length;
  return { added: added.length, remaining, inAssets: fleet.usesAssets(cfg), note: cfg.assetsNote || null };
}

/** Paste-in import (Assets or the in-app register). Resumable like loadSample: send the same text again. */
export async function importVehicles({ text, checkFrom, budgetMs = 15000 } = {}) {
  await requireAdmin('add vehicles');
  const parsed = parseFleetCsv(text);
  const errors = parsed.errors;
  // Rows without "Recalls verified to": campaigns before `checkFrom` (default: 12 months ago) go to "Check once".
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(checkFrom || '')) ? checkFrom : isoDate(Date.now() - 365 * 864e5);
  const rows = parsed.rows.map((r) => (r.verifiedTo ? r : { ...r, checkFrom: from }));
  if (!rows.length && !errors.length) throw new UserError('Paste at least one VIN.');
  let cfg = await ensureProject(await store.getConfig());
  if (!cfg.assets && !cfg.registerOnly) {
    const r = await connectAssets().catch((e) => ({ ok: false, reason: e.message }));
    cfg = await store.getConfig();
    if (!r.ok) Object.assign(cfg, { registerOnly: true, assetsNote: r.reason });
    await store.saveConfig(cfg);
  }
  cfg = await ensureSchemaVersion(cfg);
  const { added, skipped } = await fleet.addVehicles(cfg, rows, 'user', { deadline: Date.now() + budgetMs });
  return {
    added: added.length,
    remaining: skipped.filter((s) => s.reason === 'later').length,
    skipped: skipped.filter((s) => s.reason !== 'later'),
    errors,
    inAssets: fleet.usesAssets(cfg),
  };
}

// ---- Board ----------------------------------------------------------------------------------------------
const caseRow = (c, v, today) => ({
  key: c.key,
  campaign: c.campaign,
  campaignUrl: campaignUrl(c.campaign),
  issueKey: c.issueKey,
  verdict: c.verdict || 'likely',
  verdictLabel: VERDICT_LABEL[c.verdict || 'likely'],
  vin: c.vin,
  vehicle: v ? `${v.name || v.vin} · ${vehicleLabel(vehicleModel(v) || v)}` : c.vehicleName || c.vin,
  depot: v?.depot || c.depot || '',
  component: c.component,
  level: c.level,
  levelLabel: LEVELS[c.level]?.label || c.level,
  due: c.due,
  overdue: isOpen(c) && c.due < today,
  daysOpen: daysBetween(c.opened, today),
  state: c.state,
  schedule: c.schedule || null,
});

export async function getBoard() {
  const cfg = await store.getConfig();
  // Write Assets changes the scheduled scan could not make (no user), then read the register.
  const flushed = await fleet.flushPending(cfg).catch(() => 0);
  const vehicles = await fleet.loadFleet(cfg, 'user').catch(async (e) => {
    console.error('Roadworthy: Assets read failed, using the mirror', e.message);
    return store.listVehicles();
  });
  const cases = await store.listCases();
  const today = isoDate(Date.now());
  const stats = fleetStats(vehicles, cases, today);
  const byVin = new Map(vehicles.map((v) => [v.vin, v]));
  const open = cases
    .filter(isOpen)
    .map((c) => caseRow(c, byVin.get(c.vin), today))
    .sort((a, b) => levelRank(a.level) - levelRank(b.level) || String(a.due).localeCompare(String(b.due)));
  const grounded = vehicles
    .filter((v) => v.status === STATUS.PARK_IT)
    .map((v) => ({ vin: v.vin, name: v.name, label: vehicleLabel(vehicleModel(v) || v), depot: v.depot, campaigns: open.filter((c) => c.vin === v.vin).map((c) => c.campaign) }));
  const job = await store.getJob();
  const site = await jira.siteUrl().catch(() => '');
  const reviews = (await store.listReviews())
    .filter((r) => byVin.has(r.vin))
    .map((r) => {
      const v = byVin.get(r.vin);
      return {
        key: r.key, campaign: r.campaign, campaignUrl: campaignUrl(r.campaign), vin: r.vin,
        vehicle: `${v.name || v.vin} · ${vehicleLabel(vehicleModel(v) || v)}`, depot: v.depot || '',
        level: r.level, levelLabel: LEVELS[r.level]?.label || r.level, component: r.component,
        why: (r.reasons || []).filter((x) => x.result === 'mismatch').map((x) => x.text).join(' '),
        vinLookupUrl: vinLookupUrl(r.vin),
      };
    })
    .sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.vehicle.localeCompare(b.vehicle));
  const checks = (await store.listChecks())
    .filter((r) => byVin.has(r.vin))
    .map((r) => {
      const v = byVin.get(r.vin);
      return {
        key: r.key, campaign: r.campaign, campaignUrl: campaignUrl(r.campaign), vin: r.vin, reported: r.reported,
        vehicle: `${v.name || v.vin} · ${vehicleLabel(vehicleModel(v) || v)}`, depot: v.depot || '',
        level: r.level, levelLabel: LEVELS[r.level]?.label || r.level, component: r.component, vinLookupUrl: vinLookupUrl(r.vin),
      };
    })
    .sort((a, b) => a.vehicle.localeCompare(b.vehicle) || String(b.reported).localeCompare(String(a.reported)));
  const isAdmin = await jira.isJiraAdmin().catch(() => false);
  const allCases = cases.filter((c) => byVin.has(c.vin));
  return {
    isAdmin,
    reviews,
    checks,
    // The headline: NHTSA matched N; M need action; K ruled out per vehicle, with reasons.
    headline: { matched: allCases.length + reviews.length, needAction: open.length, fixed: allCases.filter((c) => !isOpen(c)).length, ruledOut: reviews.length, checkOnce: checks.length },
    stats: { ...stats, ruledOut: reviews.length },
    open,
    grounded,
    vehicles: vehicles
      .map((v) => ({
        vin: v.vin,
        name: v.name,
        label: vehicleLabel(vehicleModel(v) || v),
        depot: v.depot,
        plate: v.plate,
        status: v.status || STATUS.AVAILABLE,
        dispatchable: dispatchable(v.status),
        openRecalls: cases.filter((c) => c.vin === v.vin && isOpen(c)).length,
        lastCheck: v.lastCheck || null,
        decodeError: v.decodeError || null,
        sample: Boolean(v.sample) || SAMPLE_VINS.has(v.vin),
        equipment: v.equipment || '',
        assetUrl: assets.objectUrl(site, cfg.assets, v.objectId),
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    job: job ? { phase: job.phase, startedAt: job.startedAt, finishedAt: job.finishedAt || null, counts: job.counts, warnings: job.warnings || [], trigger: job.trigger, problems: job.problems || 0 } : null,
    setup: {
      project: cfg.target === 'jira' && cfg.jiraProject ? `${cfg.jiraProject.projectName} (${cfg.jiraProject.projectKey}) · ${cfg.jiraProject.issueTypeName}` : cfg.projectName ? `${cfg.projectName} (${cfg.projectKey}) · ${cfg.requestTypeName}` : null,
      assets: cfg.assets ? cfg.assets.schemaName : null,
      registerOnly: Boolean(cfg.registerOnly),
      note: cfg.assetsNote || null,
    },
    progress: {
      project: Boolean(cfg.target === 'jira' ? cfg.jiraProject : cfg.serviceDeskId),
      vehicles: vehicles.length > 0,
      scanned: Boolean(job?.finishedAt),
      remediated: cases.some((c) => !isOpen(c)),
    },
    flushed,
    site,
    today,
  };
}

/** Mark a "check once" campaign as checked (the VIN lookup shows it was done or doesn't apply). */
export async function dismissCheck({ key, accountId }) {
  if (!(await store.getCheck(key))) throw new UserError('That item is no longer in the list. Refresh the page.');
  await store.saveDismissed(key, accountId);
  await store.deleteCheck(key);
  return { ok: true };
}

/** Open a request for a ruled-out match or a "check once" campaign (people know better than the recall text). */
export async function openFromReview({ key, accountId }) {
  const fromCheck = await store.getCheck(key);
  const r = fromCheck || (await store.getReview(key));
  if (!r) throw new UserError('That match is no longer in the review list. Refresh the page.');
  const [campaign, v, cfg] = await Promise.all([store.getCampaign(r.campaign), store.getVehicle(r.vin), store.getConfig()]);
  if (!campaign || !v) throw new UserError('That vehicle or campaign is no longer in the register.');
  const severity = classify(campaign, cfg.dueDays || {});
  const today = isoDate(Date.now());
  const n = { key, campaign, vin: r.vin, severity, due: dueDate(today, severity.days), applicability: { verdict: r.verdict, reasons: r.reasons } };
  const note = fromCheck ? 'Opened from the "Check once" list: the NHTSA VIN lookup shows this recall still open.' : 'Opened from the "Ruled out" list by a person, overriding the unlikely verdict.';
  const c = await openOne({ cfg, n, v, who: 'user', accountId, today, note });
  if (!c) throw new UserError('A request for this recall and vehicle already exists.');
  if (fromCheck) await store.deleteCheck(key);
  else await store.deleteReview(key);
  return { ok: true, issueKey: c.issueKey };
}

/** Remove the sample fleet: its Assets objects, its requests and Roadworthy's records. Resumable. */
export async function removeSample({ budgetMs = 15000 } = {}) {
  await requireAdmin('remove the sample fleet');
  const deadline = Date.now() + budgetMs;
  const cfg = await store.getConfig();
  const sampleVins = new Set(SAMPLE_FLEET.map((v) => v.vin));
  let removedRequests = 0;
  let removedVehicles = 0;
  let remaining = 0;
  for (const c of await store.listCases()) {
    if (!sampleVins.has(c.vin)) continue;
    if (Date.now() > deadline) { remaining++; continue; }
    if (c.issueKey) await jira.deleteIssue(c.issueKey).catch((e) => { if (e.status !== 404) throw e; });
    await store.deleteCase(c.key);
    await store.unlinkIssue(c.issueKey);
    await store.releaseClaim(c.key);
    removedRequests++;
  }
  for (const r of await store.listReviews()) if (sampleVins.has(r.vin)) await store.deleteReview(r.key);
  for (const r of await store.listChecks()) if (sampleVins.has(r.vin)) await store.deleteCheck(r.key);
  for (const v of await store.listVehicles()) {
    if (!sampleVins.has(v.vin)) continue;
    if (Date.now() > deadline) { remaining++; continue; }
    if (v.objectId && cfg.assets) await assets.deleteObject(cfg.assets, v.objectId).catch((e) => { if (e.status !== 404) throw e; });
    await store.deleteVehicle(v.vin);
    await store.deletePending(v.vin);
    removedVehicles++;
  }
  if (!remaining && !(await store.listVehicles()).length) await store.deleteJob();
  return { removedRequests, removedVehicles, remaining };
}

// ---- Remediation (issue panel, Rovo) --------------------------------------------------------------------
async function caseOrThrow(issueKey) {
  const c = await store.caseForIssue(issueKey);
  if (!c) throw new UserError(`${issueKey} isn't a Roadworthy recall request.`);
  return c;
}

export async function getPanel(issueKey) {
  const c = await store.caseForIssue(issueKey);
  if (!c) return { none: true };
  const cfg = await store.getConfig();
  const [campaign, v, site] = await Promise.all([store.getCampaign(c.campaign), store.getVehicle(c.vin), jira.siteUrl().catch(() => '')]);
  const today = isoDate(Date.now());
  return {
    case: { ...caseRow(c, v, today), reason: c.reason, opened: c.opened, history: c.history || [], remedy: c.remedy || null, note: c.note || null, reasons: c.reasons || [], assetKey: c.assetKey || v?.objectKey || null },
    campaign: campaign
      ? { id: campaign.id, component: campaign.component, summary: campaign.summary, consequence: campaign.consequence, remedy: campaign.remedy, reported: campaign.reported, manufacturer: campaign.manufacturer, ota: campaign.ota }
      : null,
    vehicle: v ? { name: v.name, vin: v.vin, label: vehicleLabel(vehicleModel(v) || v), plate: v.plate, depot: v.depot, status: v.status, driver: v.driver, equipment: v.equipment || '' } : null,
    assetUrl: assets.objectUrl(site, cfg.assets, v?.objectId),
    vinLookupUrl: vinLookupUrl(c.vin),
  };
}

const record = (c, accountId, what, detail) => ({ ...c, history: [...(c.history || []), { at: Date.now(), by: accountId || null, what, detail }] });

export async function scheduleRepair({ issueKey, dealer, date, accountId }) {
  const d = String(dealer || '').trim();
  if (!d) throw new UserError('Enter the dealer or repair shop.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new UserError('Pick the appointment date.');
  let c = await caseOrThrow(issueKey);
  if (!isOpen(c)) throw new UserError('This recall is already closed.');
  c = record({ ...c, state: 'scheduled', schedule: { dealer: d, date } }, accountId, 'scheduled', `Appointment at ${d} on ${date}.`);
  await store.saveCase(c);
  await jira.addComment(issueKey, auditComment(`Repair scheduled at ${d} for ${date}.`, [c.level === 'park-it' ? 'Park It: tow the vehicle to the dealer; do not drive it.' : null])).catch((e) => console.error(e.message));
  await jira.transitionTo(issueKey, 'indeterminate').catch(() => null);
  return { ok: true, state: c.state };
}

export async function markRemedied({ issueKey, ro, date, odometer, accountId }) {
  const roNum = String(ro || '').trim();
  if (!roNum) throw new UserError('Enter the repair order number from the dealer.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new UserError('Pick the date of the repair.');
  // Allow one day ahead: the person's local date can be ahead of UTC.
  if (date > isoDate(Date.now() + 864e5)) throw new UserError("The repair date can't be in the future.");
  const miles = odometer === '' || odometer === undefined || odometer === null ? null : Number(String(odometer).replace(/[,\s]/g, ''));
  if (miles !== null && (!Number.isFinite(miles) || miles < 0)) throw new UserError('Odometer must be a number, e.g. 42150.');
  return close(issueKey, accountId, 'remedied', { ro: roNum, date, odometer: miles }, `Remedied: repair order ${roNum} on ${date}${miles !== null ? `, odometer ${miles.toLocaleString('en-US')}` : ''}.`);
}

export async function markNotAffected({ issueKey, note, accountId }) {
  const n = String(note || '').trim();
  if (n.length < 4) throw new UserError('Say how you confirmed it, e.g. "NHTSA VIN lookup shows no open recall".');
  return close(issueKey, accountId, 'not-affected', null, `Not affected: ${n}`, n);
}

async function close(issueKey, accountId, state, remedy, line, note) {
  let c = await caseOrThrow(issueKey);
  if (!isOpen(c)) throw new UserError('This recall is already closed.');
  c = record({ ...c, state, remedy, note: note || null, closed: isoDate(Date.now()) }, accountId, state, line);
  await store.saveCase(c);
  const cfg = await store.getConfig();
  // The vehicle's status follows its remaining open recalls (Assets written as the signed-in user).
  const before = (await store.getVehicle(c.vin))?.status;
  const change = await applyStatus({ cfg, vin: c.vin, who: 'user', today: isoDate(Date.now()) });
  const after = change?.to || before;
  await jira.addComment(issueKey, auditComment(line, [change ? `Vehicle status: ${before || 'none'} → ${after}.` : `Vehicle status stays ${after}.`])).catch((e) => console.error(e.message));
  const moved = await jira.transitionTo(issueKey, 'done').catch(() => null);
  return { ok: true, state, vehicleStatus: after, statusChanged: Boolean(change), issueStatus: moved };
}

/** Badge for the jira:issueContext glance, e.g. "Park It · 2 days open". */
export async function issueBadge(issueKey) {
  const c = await store.caseForIssue(issueKey);
  if (!c) return null;
  const today = isoDate(Date.now());
  const label = LEVELS[c.level]?.label || 'Recall';
  if (!isOpen(c)) return { type: 'lozenge', value: { label: c.state === 'remedied' ? 'Remedied' : 'Not affected', type: 'success' } };
  const days = daysBetween(c.opened, today);
  const age = days === 0 ? 'opened today' : `${days} day${days === 1 ? '' : 's'} open`;
  const overdue = c.due < today;
  const type = c.level === 'park-it' || c.level === 'park-outside' || overdue ? 'removed' : c.state === 'scheduled' ? 'inprogress' : 'moved';
  return { type: 'lozenge', value: { label: `${label} · ${overdue ? 'overdue' : age}`, type } };
}

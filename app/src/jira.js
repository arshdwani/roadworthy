// Jira and Jira Service Management REST calls. `who` is 'user' (UI resolvers, Rovo actions) or 'app' (scheduled
// scans, where no user is present).
import { asApp, asUser, route } from '@forge/api';
import { checked } from './errors.js';

const as = (who) => (who === 'app' ? asApp() : asUser());
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

const get = async (who, r, what) => checked(await as(who).requestJira(r, { headers: { Accept: 'application/json' } }), what);
const send = async (who, method, r, body, what) =>
  checked(await as(who).requestJira(r, { method, headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) }), what);

export async function isJiraAdmin() {
  const r = await get('user', route`/rest/api/3/mypermissions?permissions=ADMINISTER`, 'Checking your permissions');
  return Boolean(r?.permissions?.ADMINISTER?.havePermission);
}

export async function siteUrl() {
  const r = await get('app', route`/rest/api/3/serverInfo`, 'Reading the site address');
  return String(r?.baseUrl || '').replace(/\/$/, '');
}

// ---- Service desks and request types ----------------------------------------------------------------------
export async function listServiceDesks(who = 'user') {
  const r = await get(who, route`/rest/servicedeskapi/servicedesk?limit=100`, 'Listing service projects');
  return (r?.values || []).map((s) => ({ id: s.id, projectId: s.projectId, projectKey: s.projectKey, projectName: s.projectName }));
}

export async function listRequestTypes(serviceDeskId, who = 'user') {
  const r = await get(who, route`/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype?limit=100`, 'Listing request types');
  return (r?.values || []).map((t) => ({ id: t.id, name: t.name, issueTypeId: t.issueTypeId, description: t.description || '' }));
}

// Fields Roadworthy fills on every request (the rest of a request type's required fields would block creation).
export const FILLED_FIELDS = ['summary', 'description', 'priority', 'duedate', 'labels'];

/** The request type's form fields: [{ fieldId, name, required }]. */
export async function requestTypeFields(serviceDeskId, requestTypeId, who = 'user') {
  const r = await get(who, route`/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype/${requestTypeId}/field`, 'Reading the request type form');
  return (r?.requestTypeFields || []).map((f) => ({ fieldId: f.fieldId, name: f.name, required: Boolean(f.required) }));
}

/** Required fields Roadworthy can't fill, by name. */
export const blockingFields = (fields) => fields.filter((f) => f.required && !FILLED_FIELDS.includes(f.fieldId)).map((f) => f.name);

/** Create the "Vehicle safety recall" request type (service project admins; JSM API marks it experimental). */
export async function createRequestType(serviceDeskId, issueTypeId, who = 'user') {
  // Experimental JSM endpoint: it needs the opt-in header.
  const res = await as(who).requestJira(route`/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'X-ExperimentalApi': 'opt-in' },
    body: JSON.stringify({
      name: 'Vehicle safety recall',
      description: 'A manufacturer safety recall on one fleet vehicle, opened by Roadworthy from NHTSA data.',
      helpText: 'Opened automatically by Roadworthy. Schedule the dealer visit, then record the repair order.',
      issueTypeId: String(issueTypeId),
    }),
  });
  return checked(res, 'Creating the "Vehicle safety recall" request type');
}

// ---- Plain Jira projects (sites without a service project) ----------------------------------------------
export async function listProjects(who = 'user') {
  const r = await get(who, route`/rest/api/3/project/search?maxResults=100&orderBy=name`, 'Listing projects');
  return (r?.values || []).map((p) => ({ id: p.id, key: p.key, name: p.name, type: p.projectTypeKey }));
}

export async function listIssueTypes(projectId, who = 'user') {
  const r = await get(who, route`/rest/api/3/issue/createmeta/${projectId}/issuetypes`, 'Reading issue types');
  return (r?.issueTypes || r?.values || []).filter((t) => !t.subtask).map((t) => ({ id: t.id, name: t.name }));
}

/** Pick a sensible default request type for recall work. */
export function defaultRequestType(types) {
  const pref = [/recall/i, /repair|maint|fault|vehicle|fleet/i, /problem|incident/i, /request/i];
  for (const re of pref) {
    const t = types.find((x) => re.test(x.name));
    if (t) return t;
  }
  return types[0] || null;
}

/** Pick the service project that best fits fleet work (used until an admin chooses one in Settings). */
export function defaultDesk(desks) {
  const pref = [/fleet|vehicle|transport|logistic/i, /facilit|maint/i, /operations/i];
  for (const re of pref) {
    const d = desks.find((x) => re.test(x.projectName));
    if (d) return d;
  }
  return desks[0] || null;
}

// ---- Priorities -----------------------------------------------------------------------------------------
let priorityCache;
export async function priorityId(name, who) {
  if (!priorityCache) {
    const r = await get(who, route`/rest/api/3/priority/search?maxResults=50`, 'Reading priorities').catch(() => null);
    priorityCache = r?.values || [];
  }
  const exact = priorityCache.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact.id;
  // Fall back by position (Jira lists priorities highest first).
  const order = ['highest', 'high', 'medium', 'low', 'lowest'];
  const i = order.indexOf(name.toLowerCase());
  return priorityCache[Math.min(i, priorityCache.length - 1)]?.id || null;
}

// ---- Requests -------------------------------------------------------------------------------------------
/**
 * Create the remediation request, then set priority, due date and labels (best effort: a field that is not on the
 * project's edit screen is skipped and reported in `warnings`). Returns { key, id, warnings }.
 */
export async function createRequest({ who, serviceDeskId, requestTypeId, summary, description, priority, due, labels, property, assetField, jiraProject }) {
  const warnings = [];
  let created;
  if (jiraProject) {
    // No service project: a standard Jira work item in the chosen project.
    const r = await send(who, 'POST', route`/rest/api/3/issue`, {
      fields: { project: { id: String(jiraProject.projectId) }, issuetype: { id: String(jiraProject.issueTypeId) }, summary, description },
    }, 'Creating the recall work item');
    created = { issueKey: r.key, issueId: r.id };
  } else {
    try {
    created = await send(who, 'POST', route`/rest/servicedeskapi/request`, {
      serviceDeskId: String(serviceDeskId),
      requestTypeId: String(requestTypeId),
      requestFieldValues: { summary, description },
      isAdfRequest: true,
    }, 'Creating the remediation request');
  } catch (e) {
    // Some request types have no Description field on the form; create the request with the summary, then set the
    // description as an agent edit (or, if the edit screen refuses it too, add the details as an internal note).
    if (e.status !== 400 || !/description/i.test(e.body || '')) throw e;
    created = await send(who, 'POST', route`/rest/servicedeskapi/request`, {
      serviceDeskId: String(serviceDeskId),
      requestTypeId: String(requestTypeId),
      requestFieldValues: { summary },
    }, 'Creating the remediation request');
    const w = await editFields(created.issueKey, { description }, who, []).catch((err) => [err.message]);
    if (w.length) await addComment(created.issueKey, description, { who, internal: true }).catch((err) => warnings.push(`details note: ${err.message}`));
  }
  }
  const key = created.issueKey;
  const fields = {};
  const pid = priority ? await priorityId(priority, who).catch(() => null) : null;
  if (pid) fields.priority = { id: pid };
  if (due) fields.duedate = due;
  if (labels?.length) fields.labels = labels;
  // Link the vehicle through the Assets object field the admin chose in Settings.
  if (assetField?.id) fields[assetField.id] = [{ workspaceId: assetField.workspaceId, id: `${assetField.workspaceId}:${assetField.objectId}`, objectId: String(assetField.objectId) }];
  // Once the request exists nothing below may throw, or the scan would release its claim and open a duplicate.
  await editFields(key, fields, who, warnings).catch((e) => warnings.push(e.message));
  if (property) await setProperty(key, 'roadworthy', property, who).catch((e) => warnings.push(`property: ${e.message}`));
  return { key, id: created.issueId, warnings };
}

/** PUT fields; on a 400, drop the fields Jira names and try once more. */
export async function editFields(key, fields, who, warnings = []) {
  if (!Object.keys(fields).length) return warnings;
  try {
    await send(who, 'PUT', route`/rest/api/3/issue/${key}?notifyUsers=false`, { fields }, `Updating ${key}`);
  } catch (e) {
    if (e.status !== 400) throw e;
    let bad = {};
    try {
      bad = JSON.parse(e.body || '{}').errors || {};
    } catch (_) { /* not JSON */ }
    const rest = Object.fromEntries(Object.entries(fields).filter(([k]) => !(k in bad)));
    for (const k of Object.keys(fields)) if (k in bad) warnings.push(`${k}: ${bad[k]}`);
    if (Object.keys(rest).length && Object.keys(rest).length < Object.keys(fields).length) {
      await send(who, 'PUT', route`/rest/api/3/issue/${key}?notifyUsers=false`, { fields: rest }, `Updating ${key}`).catch((err) => warnings.push(err.message));
    } else if (!Object.keys(bad).length) warnings.push(e.message);
  }
  return warnings;
}

export const setProperty = (key, prop, value, who = 'user') =>
  send(who, 'PUT', route`/rest/api/3/issue/${key}/properties/${prop}`, value, `Saving data on ${key}`);

/** Internal note (agents only) on a JSM request, or a normal comment when that fails. */
export async function addComment(key, adf, { who = 'user', internal = true } = {}) {
  try {
    return await send(who, 'POST', route`/rest/api/3/issue/${key}/comment`, {
      body: adf,
      properties: internal ? [{ key: 'sd.public.comment', value: { internal: true } }] : undefined,
    }, `Commenting on ${key}`);
  } catch (e) {
    if (!internal) throw e;
    return send(who, 'POST', route`/rest/api/3/issue/${key}/comment`, { body: adf }, `Commenting on ${key}`);
  }
}

/**
 * Move an issue to a status in `category` ('done' or 'indeterminate'). Workflows often have no direct To Do → Done
 * step, so when there is none we go through "Start"/"In progress" first (at most three steps).
 * Returns the final status name, or null when no path was found.
 */
export async function transitionTo(key, category, who = 'user') {
  const names = category === 'done' ? /resolve|done|close|complete|fix/i : /progress|start|work/i;
  let moved = null;
  for (let step = 0; step < 3; step++) {
    const r = await get(who, route`/rest/api/3/issue/${key}/transitions`, `Reading workflow steps for ${key}`);
    const list = r?.transitions || [];
    const direct = list.find((x) => x.to?.statusCategory?.key === category && names.test(x.name)) || list.find((x) => x.to?.statusCategory?.key === category);
    const via = category === 'done' ? list.find((x) => x.to?.statusCategory?.key === 'indeterminate' && /start|progress|work/i.test(`${x.name} ${x.to?.name}`)) : null;
    const t = direct || via;
    if (!t || (moved && !direct && t.to?.name === moved)) return direct ? t.to?.name : moved && category !== 'done' ? moved : null;
    await send(who, 'POST', route`/rest/api/3/issue/${key}/transitions`, { transition: { id: t.id } }, `Moving ${key} to ${t.to?.name}`);
    moved = t.to?.name || t.name;
    if (direct) return moved;
  }
  return null;
}

export const deleteIssue = (key, who = 'user') => send(who, 'DELETE', route`/rest/api/3/issue/${key}`, undefined, `Deleting ${key}`);

/** Assets object custom fields (to link a request to its vehicle). */
export async function listAssetFields(who = 'user') {
  const r = await get(who, route`/rest/api/3/field`, 'Listing fields');
  return (r || []).filter((f) => /cmdb/i.test(f.schema?.custom || '')).map((f) => ({ id: f.id, name: f.name }));
}

export async function issueBasics(key, who = 'user') {
  const r = await get(who, route`/rest/api/3/issue/${key}?fields=summary,status,created,duedate,priority`, `Reading ${key}`);
  return { key: r.key, id: r.id, summary: r.fields?.summary, status: r.fields?.status?.name, statusCategory: r.fields?.status?.statusCategory?.key, created: r.fields?.created };
}

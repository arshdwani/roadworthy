// Persistence on Forge Key-Value Storage (KVS). Keys use only [A-Za-z0-9:._-#].
//
//   cfg                      settings (see service.getSettings)
//   veh:<VIN>                vehicle mirror: the register when Assets is off, a cache of Assets objects when on
//   case:<campaign>:<VIN>    one remediation case (campaign x vehicle)
//   claim:<campaign>:<VIN>   FAIL_IF_EXISTS claim taken before a request is created (exactly one request each)
//   issue:<KEY>              case key for a Jira issue
//   camp:<campaign>          campaign details from NHTSA
//   rc:<make_model_year>     NHTSA recalls for one make/model/year, with fetch time
//   pending:<VIN>            Assets attribute changes made where Assets could not be written (no user present)
//   review:<campaign>:<VIN>  a match ruled unlikely for this vehicle (no request), with the reasons
//   check:<campaign>:<VIN>   an older campaign to check once with the VIN lookup (no request)
//   dismissed:<campaign>:<VIN> a "check once" item someone marked as checked
//   job:scan                 the current or last recall scan
import { kvs, WhereConditions } from '@forge/kvs';

const safeKey = (s) => String(s).replace(/[^A-Za-z0-9:._#-]+/g, '_');

async function listPrefix(prefix) {
  const out = [];
  let cursor;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    for (const r of page.results || []) out.push(r.value);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

export const getConfig = async () => (await kvs.get('cfg')) || {};
export const saveConfig = (cfg) => kvs.set('cfg', cfg);

export const listVehicles = () => listPrefix('veh:');
export const getVehicle = (vin) => kvs.get('veh:' + vin);
export const saveVehicle = (v) => kvs.set('veh:' + v.vin, v);
export const deleteVehicle = (vin) => kvs.delete('veh:' + vin);

export const listCases = () => listPrefix('case:');
export const getCase = (key) => kvs.get('case:' + safeKey(key));
export const saveCase = (c) => kvs.set('case:' + safeKey(c.key), c);
export const deleteCase = (key) => kvs.delete('case:' + safeKey(key));
export const caseForIssue = async (issueKey) => {
  const key = await kvs.get('issue:' + safeKey(issueKey));
  return key ? getCase(key) : null;
};
export const linkIssue = (issueKey, caseKey) => kvs.set('issue:' + safeKey(issueKey), caseKey);
export const unlinkIssue = (issueKey) => (issueKey ? kvs.delete('issue:' + safeKey(issueKey)) : null);

/** Atomic "first one wins": true only for the caller that created the claim. */
export async function claim(key) {
  try {
    await kvs.set('claim:' + safeKey(key), Date.now(), { keyPolicy: 'FAIL_IF_EXISTS' });
    return true;
  } catch (_) {
    return false;
  }
}
export const releaseClaim = (key) => kvs.delete('claim:' + safeKey(key));

export const getCampaign = (id) => kvs.get('camp:' + safeKey(id));
export const saveCampaign = (c) => kvs.set('camp:' + safeKey(c.id), c);

export const getRecalls = (rkey) => kvs.get('rc:' + safeKey(rkey));
export const saveRecalls = (rkey, value) => kvs.set('rc:' + safeKey(rkey), value);

export const listPending = () => listPrefix('pending:');
export const getPending = (vin) => kvs.get('pending:' + vin);
export const savePending = (vin, patch) => kvs.set('pending:' + vin, { vin, ...patch });
export const deletePending = (vin) => kvs.delete('pending:' + vin);

export const listReviews = () => listPrefix('review:');
export const getReview = (key) => kvs.get('review:' + safeKey(key));
export const saveReview = (r) => kvs.set('review:' + safeKey(r.key), r);
export const deleteReview = (key) => kvs.delete('review:' + safeKey(key));
export const listChecks = () => listPrefix('check:');
export const getCheck = (key) => kvs.get('check:' + safeKey(key));
export const saveCheck = (r) => kvs.set('check:' + safeKey(r.key), r);
export const deleteCheck = (key) => kvs.delete('check:' + safeKey(key));
export const listDismissed = () => listPrefix('dismissed:');
export const putDismissed = (record) => kvs.set('dismissed:' + safeKey(record.key), record);
export const saveDismissed = (key, by) => kvs.set('dismissed:' + safeKey(key), { key, by: by || null, at: Date.now() });

export const listClaims = async () => {
  const out = [];
  let cursor;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith('claim:')).limit(100);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    for (const r of page.results || []) out.push(r.key.slice(6));
    cursor = page.nextCursor;
  } while (cursor);
  return out;
};

export const getJob = () => kvs.get('job:scan');
export const saveJob = (job) => kvs.set('job:scan', job);
export const deleteJob = () => kvs.delete('job:scan');

// The pure part of a recall scan: given vehicles, the campaigns NHTSA lists for each make/model/year and the cases
// we already have, work out which new cases to open and what each vehicle's status should become.
import { recallKey, campaignsToOpen } from './recalls.js';
import { classify, dueDate, levelRank, isoDate } from './severity.js';
import { vehicleStatus, isOpen } from './fleet.js';
import { assess } from './applicability.js';

export const caseKey = (campaignId, vin) => `${campaignId}:${vin}`;

const YEAR_MS = 365 * 864e5;
/**
 * A vehicle's recall-history window:
 *   skipThrough   campaigns reported on or before it were checked at a dealer ("Recalls verified to"): ignored
 *   checkThrough  older campaigns we can't vouch for: listed once under "Check once", no request, no restriction
 * Without "Recalls verified to", campaigns older than 12 months before Roadworthy first saw the vehicle are
 * "check once", so pasting a 2012 van doesn't open a request for every recall since 2012.
 */
export function windowOf(v) {
  const skipThrough = v.verifiedTo || null;
  const fallback = v.firstSeen ? isoDate(v.firstSeen - YEAR_MS) : null;
  const checkThrough = v.checkFrom || (skipThrough ? null : fallback);
  return { skipThrough, checkThrough };
}

/**
 * vehicles: [{ vin, make, model, year, verifiedTo, status, appGrounded, equipment, decoded }]
 * recallsByKey: { [recallKey]: campaign[] }
 * existing: [case] (any state); claimed: Set of case keys already claimed (a request exists or is being made)
 * Returns { newCases, reviews, skipped }:
 *   newCases  [{ key, campaign, vin, severity, due, applicability }] for likely and possible matches, most urgent first
 *             (a scan that runs out of time opens Park It requests before the rest)
 *   reviews   [{ key, campaign, vin, severity, applicability }] unlikely matches: listed for review, no request
 *   checkOnce same shape: campaigns older than the vehicle's recall-history window (see windowOf), no request
 * `policy.openUnlikely` opens requests for unlikely matches too.
 */
export function planCases({ vehicles, recallsByKey, existing = [], today, policy = {}, claimed = new Set(), dismissed = new Set() }) {
  const have = new Set([...existing.map((c) => caseKey(c.campaign, c.vin)), ...claimed, ...dismissed]);
  const byKey = new Map(existing.map((c) => [caseKey(c.campaign, c.vin), c]));
  const newCases = [];
  const reviews = [];
  const checkOnce = [];
  const skipped = [];
  for (const v of vehicles) {
    if (!v.make || !v.model || !v.year) {
      skipped.push({ vin: v.vin, reason: 'Not decoded yet' });
      continue;
    }
    const campaigns = recallsByKey[recallKey(v.make, v.model, v.year)];
    if (!campaigns) {
      skipped.push({ vin: v.vin, reason: 'Recalls not fetched yet' });
      continue;
    }
    const byId = new Map(campaigns.map((c) => [c.id, c]));
    // History with an earlier campaign: a recorded repair, or (one level deep) whether it applied at all.
    const prior = (id) => {
      const c = byKey.get(caseKey(id, v.vin));
      if (c?.state === 'remedied') return 'remedied';
      if (c?.verdict) return c.verdict;
      return byId.has(id) ? assess(byId.get(id), v).verdict : null;
    };
    const { skipThrough, checkThrough } = windowOf(v);
    for (const c of campaignsToOpen(campaigns, { verifiedTo: skipThrough })) {
      const key = caseKey(c.id, v.vin);
      if (have.has(key)) continue;
      const severity = classify(c, policy);
      const applicability = assess(c, v, { prior });
      if (checkThrough && c.reported && c.reported <= checkThrough) {
        if (applicability.verdict !== 'unlikely') checkOnce.push({ key, campaign: c, vin: v.vin, severity, applicability });
        continue;
      }
      if (applicability.verdict === 'unlikely' && !policy.openUnlikely) {
        reviews.push({ key, campaign: c, vin: v.vin, severity, applicability });
        continue;
      }
      have.add(key);
      newCases.push({ key, campaign: c, vin: v.vin, severity, due: dueDate(today, severity.days), applicability });
    }
  }
  newCases.sort((a, b) => levelRank(a.severity.level) - levelRank(b.severity.level) || a.key.localeCompare(b.key));
  return { newCases, reviews, checkOnce, skipped };
}

/** Status changes for vehicles, given all cases. Returns [{ vin, from, to, appGrounded }] for vehicles that change. */
export function planStatuses({ vehicles, cases, parkOutsideGrounds = true }) {
  const openByVin = new Map();
  for (const c of cases) {
    if (!isOpen(c)) continue;
    if (!openByVin.has(c.vin)) openByVin.set(c.vin, []);
    openByVin.get(c.vin).push(c);
  }
  const out = [];
  for (const v of vehicles) {
    const openCases = openByVin.get(v.vin) || [];
    const next = vehicleStatus({ current: v.status, appGrounded: v.appGrounded, openCases, parkOutsideGrounds });
    if (next.status !== v.status || next.appGrounded !== Boolean(v.appGrounded)) {
      out.push({ vin: v.vin, from: v.status || null, to: next.status, appGrounded: next.appGrounded, openCount: openCases.length });
    }
  }
  return out;
}

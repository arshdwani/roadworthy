// Personal data: Roadworthy stores Atlassian account IDs only (who opened, scheduled or remedied a recall; who
// marked a "check once" item; who started a scan). These pure helpers list them for Forge's personal data reporting
// API and erase the ones Atlassian reports as closed. Names are never stored (looked up at display time).

const later = (a, b) => (!a || (b && b > a) ? b : a);
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/**
 * Every account ID we hold, with the last time we stored data for it.
 * Returns [{ accountId, updatedAt }] (updatedAt as ISO 8601), sorted by accountId.
 */
export function collectAccounts({ cases = [], dismissed = [], job = null } = {}) {
  const seen = new Map();
  const add = (id, at) => {
    if (!id || typeof id !== 'string') return;
    seen.set(id, later(seen.get(id), iso(at) || new Date(0).toISOString()));
  };
  for (const c of cases) for (const h of c.history || []) add(h.by, h.at);
  for (const d of dismissed) add(d.by, d.at);
  if (job) add(job.by, job.updatedAt || job.startedAt);
  return [...seen.entries()].map(([accountId, updatedAt]) => ({ accountId, updatedAt })).sort((a, b) => a.accountId.localeCompare(b.accountId));
}

/** Remove closed accounts from one case's audit trail. Returns the new case, or null if nothing changed. */
export function scrubCase(c, closed) {
  let changed = false;
  const history = (c.history || []).map((h) => {
    if (h.by && closed.has(h.by)) {
      changed = true;
      return { ...h, by: null, byRemoved: true };
    }
    return h;
  });
  return changed ? { ...c, history } : null;
}

/** Same for a dismissed "check once" record or the scan job: drop the account ID. */
export function scrubBy(record, closed) {
  return record?.by && closed.has(record.by) ? { ...record, by: null, byRemoved: true } : null;
}

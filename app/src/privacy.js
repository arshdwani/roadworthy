// Forge personal data reporting: report the account IDs we store and erase those Atlassian says are closed.
// Runs weekly from a scheduled trigger (Atlassian asks for a report at least every 15 days).
import { privacy } from '@forge/api';
import * as store from './store.js';
import { collectAccounts, scrubCase, scrubBy } from './core/privacy.js';

export async function runPrivacyReport() {
  const [cases, dismissed, job] = await Promise.all([store.listCases(), store.listDismissed(), store.getJob()]);
  const accounts = collectAccounts({ cases, dismissed, job });
  if (!accounts.length) return { reported: 0, closed: 0, scrubbed: 0 };
  const updates = await privacy.reportPersonalData(accounts);
  const closed = new Set((updates || []).filter((u) => u.status === 'closed').map((u) => u.accountId));
  let scrubbed = 0;
  if (closed.size) {
    for (const c of cases) {
      const next = scrubCase(c, closed);
      if (next) {
        await store.saveCase(next);
        scrubbed++;
      }
    }
    for (const d of dismissed) {
      const next = scrubBy(d, closed);
      if (next) {
        await store.putDismissed(next);
        scrubbed++;
      }
    }
    const j = scrubBy(job, closed);
    if (j) {
      await store.saveJob(j);
      scrubbed++;
    }
  }
  // Nothing else needs doing for "updated" accounts: we keep no profile data, only IDs.
  return { reported: accounts.length, closed: closed.size, scrubbed };
}

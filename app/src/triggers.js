// Scheduled scan and the issue-sidebar badge.
import * as svc from './service.js';
import * as store from './store.js';
import { runScanStep, scanDue } from './scan.js';
import { runPrivacyReport } from './privacy.js';

// Weekly: report stored account IDs to Atlassian and erase closed accounts (Forge personal data reporting).
export async function onPrivacy() {
  try {
    const r = await runPrivacyReport();
    console.log('Roadworthy: personal data report', JSON.stringify(r));
  } catch (e) {
    console.error('Roadworthy: personal data report failed', e.message);
  }
}

// Hourly: finish a scan that ran out of time, or start the daily scan when the last one finished ~24 h ago.
// Runs as the app: Jira requests are raised as the app; Assets changes are queued if Assets refuses app calls.
export async function onSchedule() {
  const cfg = await store.getConfig();
  if (!cfg.serviceDeskId) return;
  const job = await store.getJob();
  const unfinished = job && job.phase !== 'done';
  if (!unfinished && !scanDue(job)) return;
  try {
    const r = await runScanStep({ who: 'app', budgetMs: 240000, trigger: 'schedule' });
    console.log('Roadworthy: scheduled scan', r.phase, JSON.stringify(r.counts));
  } catch (e) {
    console.error('Roadworthy: scheduled scan failed', e.message);
  }
}

// jira:issueContext dynamic properties: the badge on the collapsed "Roadworthy" section.
export async function contextStatus(payload) {
  const key = payload?.extension?.issue?.key;
  if (!key) return {};
  try {
    const status = await svc.issueBadge(key);
    return status ? { status } : {};
  } catch (e) {
    console.error('Roadworthy: badge failed', key, e.message);
    return {};
  }
}

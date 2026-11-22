// UI resolvers: the backend for the Fleet compliance board and the request panel.
import ResolverModule from '@forge/resolver';
// With "type": "module", Forge's bundler hands back the CommonJS namespace; unwrap the class either way.
const Resolver = ResolverModule.default || ResolverModule;
import * as svc from '../service.js';
import { runScanStep } from '../scan.js';
import { friendly } from '../errors.js';
import * as jira from '../jira.js';

const resolver = new Resolver();
const accountId = (req) => req.context?.accountId;
const issueKeyOf = (req) => req.payload?.issueKey || req.context?.extension?.issue?.key;

// Every resolver returns { error } with a message people can act on; the raw response goes to the logs.
const safe = (fn) => async (req) => {
  try {
    return await fn(req);
  } catch (e) {
    console.error(e);
    return { error: friendly(e) };
  }
};

resolver.define('getBoard', safe(() => svc.getBoard()));
resolver.define('scanStep', safe((req) => runScanStep({ who: 'user', accountId: accountId(req), trigger: 'manual', restart: Boolean(req.payload?.restart) })));
resolver.define('loadSample', safe(() => svc.loadSample()));
resolver.define('removeSample', safe(() => svc.removeSample()));
resolver.define('dismissCheck', safe((req) => svc.dismissCheck({ key: req.payload?.key, accountId: accountId(req) })));
resolver.define('openFromReview', safe((req) => svc.openFromReview({ key: req.payload?.key, accountId: accountId(req) })));
resolver.define('importVehicles', safe((req) => svc.importVehicles(req.payload || {})));

resolver.define('getSettings', safe(() => svc.getSettings()));
resolver.define('listRequestTypes', safe((req) => svc.listRequestTypes(req.payload.serviceDeskId)));
resolver.define('saveSettings', safe((req) => svc.saveSettings(req.payload || {})));
resolver.define('createRecallRequestType', safe(() => svc.createRecallRequestType()));
resolver.define('listIssueTypes', safe((req) => jira.listIssueTypes(req.payload.projectId)));
resolver.define('connectAssets', safe((req) => svc.connectAssets(req.payload || {})));

resolver.define('getPanel', safe((req) => svc.getPanel(issueKeyOf(req))));
resolver.define('scheduleRepair', safe((req) => svc.scheduleRepair({ ...req.payload, issueKey: issueKeyOf(req), accountId: accountId(req) })));
resolver.define('markRemedied', safe((req) => svc.markRemedied({ ...req.payload, issueKey: issueKeyOf(req), accountId: accountId(req) })));
resolver.define('markNotAffected', safe((req) => svc.markNotAffected({ ...req.payload, issueKey: issueKeyOf(req), accountId: accountId(req) })));

export const handler = resolver.getDefinitions();

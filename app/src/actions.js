// Rovo agent actions. Each result carries an explicit `source` so the agent never invents provenance.
import * as svc from './service.js';
import * as store from './store.js';
import { isOpen, dispatchable } from './core/fleet.js';
import { vehicleModel } from './scan.js';
import { vehicleLabel } from './core/adf.js';
import { LEVELS, isoDate } from './core/severity.js';
import { friendly } from './errors.js';
import { VERDICT_LABEL } from './core/applicability.js';

const SOURCE = { title: 'Roadworthy fleet register and NHTSA recalls (nhtsa.gov)', url: 'https://www.nhtsa.gov/recalls' };
const ok = (data) => ({ ...data, source: SOURCE });
const fail = (e) => ({ error: friendly(e), source: null });
const label = (v) => `${v.name || v.vin} (${vehicleLabel(vehicleModel(v) || v)})`;
const depotMatch = (v, depot) => !depot || String(v.depot || '').toLowerCase() === String(depot).trim().toLowerCase();

export async function dispatchable_(payload) {
  try {
    const depot = payload?.depot;
    const [vehicles, cases] = await Promise.all([store.listVehicles(), store.listCases()]);
    const open = cases.filter(isOpen);
    const inDepot = vehicles.filter((v) => depotMatch(v, depot));
    const safe = inDepot.filter((v) => dispatchable(v.status) && !open.some((c) => c.vin === v.vin));
    const blocked = inDepot.filter((v) => !safe.includes(v)).map((v) => ({
      vehicle: label(v),
      bodyType: v.decoded?.body || '',
      depot: v.depot,
      status: v.status,
      openRecalls: open.filter((c) => c.vin === v.vin).map((c) => ({
        request: c.issueKey,
        campaign: c.campaign,
        severity: LEVELS[c.level]?.label,
        appliesToThisVehicle: VERDICT_LABEL[c.verdict || 'likely'],
        due: c.due,
      })),
    }));
    return ok({
      date: isoDate(Date.now()),
      depot: depot || 'all depots',
      safeToDispatch: safe.map((v) => ({ vehicle: label(v), bodyType: v.decoded?.body || '', depot: v.depot })),
      notSafe: blocked,
      depots: [...new Set(vehicles.map((v) => v.depot).filter(Boolean))],
    });
  } catch (e) {
    return fail(e);
  }
}

export async function openRecalls(payload) {
  try {
    const depot = payload?.depot;
    const [vehicles, cases] = await Promise.all([store.listVehicles(), store.listCases()]);
    const byVin = new Map(vehicles.map((v) => [v.vin, v]));
    const today = isoDate(Date.now());
    const rows = cases
      .filter((c) => isOpen(c) && byVin.has(c.vin) && depotMatch(byVin.get(c.vin), depot))
      .map((c) => ({
        request: c.issueKey,
        campaign: c.campaign,
        campaignUrl: `https://www.nhtsa.gov/recalls?nhtsaId=${c.campaign}`,
        vehicle: label(byVin.get(c.vin)),
        depot: byVin.get(c.vin).depot,
        severity: LEVELS[c.level]?.label,
        appliesToThisVehicle: VERDICT_LABEL[c.verdict || 'likely'],
        why: (c.reasons || []).map((r) => r.text).join(' '),
        component: c.component,
        due: c.due,
        overdue: c.due < today,
        state: c.state,
      }));
    return ok({ depot: depot || 'all depots', count: rows.length, openRecalls: rows });
  } catch (e) {
    return fail(e);
  }
}

export async function markRemediedAction(payload, context) {
  try {
    const r = await svc.markRemedied({
      issueKey: String(payload?.issueKey || '').trim().toUpperCase(),
      ro: payload?.repairOrder,
      date: payload?.date || isoDate(Date.now()),
      odometer: payload?.odometer,
      accountId: context?.principal?.accountId,
    });
    return ok(r);
  } catch (e) {
    return fail(e);
  }
}

// Vehicle status rules and the fleet compliance numbers. Pure functions over plain objects.
//
// A remediation case is one campaign on one vehicle:
//   { campaign, vin, level, state: 'open' | 'scheduled' | 'remedied' | 'not-affected', opened, due, depot }
// "Open" below means open or scheduled (not yet fixed).

export const STATUS = {
  AVAILABLE: 'Available',
  IN_REPAIR: 'In repair',
  PARK_IT: 'Park It – do not drive',
  DO_NOT_RENT: 'Do not rent',
};
export const STATUSES = [STATUS.AVAILABLE, STATUS.IN_REPAIR, STATUS.PARK_IT, STATUS.DO_NOT_RENT];

export const isOpen = (c) => c.state === 'open' || c.state === 'scheduled';
export const isClosed = (c) => c.state === 'remedied' || c.state === 'not-affected';

/**
 * The status a vehicle should have given its open cases.
 * - Any open Park It case (or Park Outside, when the fleet policy grounds those too) -> "Park It – do not drive".
 * - Otherwise any open case -> "Do not rent" (49 U.S.C. 30120(i): a rental company may not rent a vehicle with an
 *   open recall), unless someone has put the vehicle "In repair", which we keep.
 * - No open cases: lift a restriction only if Roadworthy set it (appGrounded); never override a status people set.
 * Returns { status, appGrounded }.
 */
export function vehicleStatus({ current, appGrounded = false, openCases = [], parkOutsideGrounds = true }) {
  const grounding = openCases.some((c) => c.level === 'park-it' || (parkOutsideGrounds && c.level === 'park-outside'));
  if (grounding) return { status: STATUS.PARK_IT, appGrounded: current !== STATUS.PARK_IT || appGrounded };
  if (openCases.length) {
    if (current === STATUS.IN_REPAIR) return { status: STATUS.IN_REPAIR, appGrounded };
    if (current === STATUS.PARK_IT && !appGrounded) return { status: current, appGrounded: false };
    if (current === STATUS.DO_NOT_RENT) return { status: current, appGrounded: appGrounded || false };
    return { status: STATUS.DO_NOT_RENT, appGrounded: true };
  }
  if (appGrounded && (current === STATUS.PARK_IT || current === STATUS.DO_NOT_RENT)) {
    return { status: STATUS.AVAILABLE, appGrounded: false };
  }
  return { status: current || STATUS.AVAILABLE, appGrounded: false };
}

/** Can this vehicle be dispatched (driven / rented) today? */
export const dispatchable = (status) => !status || status === STATUS.AVAILABLE;

const pct = (n, d) => (d ? Math.round((100 * n) / d) : 100);

/**
 * Compliance numbers for the board.
 * vehicles: [{ vin, depot, status }]; cases: [case]; today: yyyy-mm-dd.
 */
export function fleetStats(vehicles, cases, today) {
  const depotOf = new Map(vehicles.map((v) => [v.vin, v.depot || 'Unassigned']));
  const known = cases.filter((c) => depotOf.has(c.vin));
  const open = known.filter(isOpen);
  const overdue = open.filter((c) => c.due && c.due < today);
  const blank = () => ({ vehicles: 0, affected: new Set(), open: 0, overdue: 0, closed: 0, total: 0, doNotDrive: 0, available: 0 });
  const depots = new Map();
  const row = (name) => {
    if (!depots.has(name)) depots.set(name, blank());
    return depots.get(name);
  };
  for (const v of vehicles) {
    const r = row(v.depot || 'Unassigned');
    r.vehicles++;
    if (v.status === STATUS.PARK_IT) r.doNotDrive++;
    if (dispatchable(v.status)) r.available++;
  }
  for (const c of known) {
    const r = row(depotOf.get(c.vin));
    r.total++;
    if (isOpen(c)) {
      r.open++;
      r.affected.add(c.vin);
      if (c.due && c.due < today) r.overdue++;
    } else if (isClosed(c)) r.closed++;
  }
  const byDepot = [...depots.entries()]
    .map(([depot, r]) => ({
      depot,
      vehicles: r.vehicles,
      affected: r.affected.size,
      open: r.open,
      overdue: r.overdue,
      doNotDrive: r.doNotDrive,
      available: r.available,
      pctRemedied: pct(r.closed, r.total),
    }))
    .sort((a, b) => a.depot.localeCompare(b.depot));
  const closed = known.filter(isClosed).length;
  return {
    vehicles: vehicles.length,
    openCampaigns: new Set(open.map((c) => c.campaign)).size,
    vehiclesAffected: new Set(open.map((c) => c.vin)).size,
    openCases: open.length,
    totalCases: known.length,
    pctRemedied: pct(closed, known.length),
    overdue: overdue.length,
    doNotDrive: vehicles.filter((v) => v.status === STATUS.PARK_IT).length,
    available: vehicles.filter((v) => dispatchable(v.status)).length,
    byDepot,
  };
}

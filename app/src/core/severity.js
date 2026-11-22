// Severity, Jira priority and due date for a recall campaign. The policy is deliberately simple and explained
// on every request ("why this due date"), so a fleet manager can see the rule that fired.

export const LEVELS = {
  'park-it': { label: 'Park It', priority: 'Highest', days: 0, rank: 0 },
  'park-outside': { label: 'Park outside', priority: 'Highest', days: 0, rank: 1 },
  high: { label: 'High', priority: 'High', days: 14, rank: 2 },
  medium: { label: 'Medium', priority: 'Medium', days: 30, rank: 3 },
  low: { label: 'Low', priority: 'Low', days: 60, rank: 4 },
};

// Systems where a failure takes away control of the vehicle or protection in a crash.
const CRITICAL_SYSTEMS = [
  'STEERING', 'SERVICE BRAKES', 'PARKING BRAKE', 'AIR BAGS', 'SEAT BELTS', 'SUSPENSION', 'WHEELS', 'TIRES',
  'FUEL SYSTEM', 'POWER TRAIN', 'ELECTRICAL SYSTEM:PROPULSION', 'ENGINE AND ENGINE COOLING', 'ENGINE',
  'STRUCTURE', 'LATCHES/LOCKS/LINKAGES', 'VEHICLE SPEED CONTROL',
];
const LOW_SYSTEMS = ['EQUIPMENT:OTHER:LABELS', 'EQUIPMENT ADAPTIVE/MOBILITY'];

const systemOf = (component) => String(component || '').toUpperCase().split(/[:,]/)[0].trim();

/**
 * Classify one campaign. Returns { level, label, priority, days, reason }.
 * `policy` may override the number of days per level, e.g. { high: 7 }.
 */
export function classify(c, policy = {}) {
  const component = String(c.component || '').toUpperCase();
  const text = `${c.consequence || ''} ${c.summary || ''}`.toLowerCase();
  const system = systemOf(component);
  const fire = /\bfire\b/.test(text);
  const crash = /\b(crash|injury|injuries|death)\b/.test(text);
  let level;
  let reason;
  if (c.parkIt) {
    level = 'park-it';
    reason = 'NHTSA "Park It": the manufacturer says not to drive this vehicle until it is repaired.';
  } else if (c.parkOutside) {
    level = 'park-outside';
    reason = 'NHTSA "Park Outside": fire risk; park outside and away from buildings until it is repaired.';
  } else if (LOW_SYSTEMS.some((s) => component.startsWith(s)) && !fire) {
    level = 'low';
    reason = `Low: ${component.toLowerCase()} (labels or adaptive equipment).`;
  } else if (fire || (crash && CRITICAL_SYSTEMS.some((s) => component.startsWith(s)))) {
    level = 'high';
    reason = fire ? `High: fire risk (${system.toLowerCase()}).` : `High: ${system.toLowerCase()} failure can cause a crash.`;
  } else if (crash) {
    level = 'medium';
    reason = `Medium: ${system.toLowerCase()} issue that increases the risk of a crash or injury.`;
  } else {
    level = 'low';
    reason = `Low: ${system.toLowerCase()} issue with no crash or fire risk stated.`;
  }
  const base = LEVELS[level];
  const days = Number.isFinite(policy[level]) ? policy[level] : base.days;
  return { level, label: base.label, priority: base.priority, days, reason };
}

const DAY = 864e5;
export const isoDate = (d) => new Date(d).toISOString().slice(0, 10);

/** Due date (yyyy-mm-dd) `days` after `from` (a date or ISO string). */
export const dueDate = (from, days) => isoDate(new Date(isoDate(from)).getTime() + days * DAY);

/** Whole days from `from` to `to` (both dates or ISO strings), never negative. */
export const daysBetween = (from, to) =>
  Math.max(0, Math.floor((new Date(isoDate(to)).getTime() - new Date(isoDate(from)).getTime()) / DAY));

export const isGrounding = (level) => level === 'park-it' || level === 'park-outside';
export const levelRank = (level) => LEVELS[level]?.rank ?? 9;

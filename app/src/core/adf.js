// Atlassian Document Format builders for the remediation request and its audit comments. Pure, unit-tested.
import { campaignUrl, vinLookupUrl } from './recalls.js';
import { LEVELS } from './severity.js';
import { VERDICT_LABEL } from './applicability.js';

export const txt = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
export const strong = (text) => txt(text, [{ type: 'strong' }]);
export const link = (text, href) => txt(text, [{ type: 'link', attrs: { href } }]);
export const para = (...nodes) => ({ type: 'paragraph', content: nodes.filter(Boolean) });
export const doc = (...content) => ({ type: 'doc', version: 1, content: content.flat().filter(Boolean) });
const panel = (panelType, ...content) => ({ type: 'panel', attrs: { panelType }, content: content.filter(Boolean) });
const heading = (level, text) => ({ type: 'heading', attrs: { level }, content: [txt(text)] });

const MARK = { match: '✓', mismatch: '✗', unknown: '?' };

export const vehicleLabel = (v) => [v.year, v.make, v.model].filter(Boolean).join(' ');

/** Request summary, e.g. "PARK IT · Recall 26V340000 · 2022 Ford Maverick · TRK-07". */
export function requestSummary(c, v, sev) {
  const tag = sev.level === 'park-it' ? 'PARK IT · ' : sev.level === 'park-outside' ? 'PARK OUTSIDE · ' : '';
  return `${tag}Recall ${c.id} · ${vehicleLabel(v)} · ${v.name || v.vin}`.slice(0, 250);
}

/**
 * Description of a remediation request. `assetUrl` links back to the vehicle in Assets (or null for the in-app
 * register). Text comes from NHTSA; nothing here is generated.
 */
export function requestDescription({ campaign: c, vehicle: v, severity: sev, due, assetUrl, assetKey, applicability: ap }) {
  const banner =
    sev.level === 'park-it'
      ? panel('error', para(strong('PARK IT – DO NOT DRIVE. '), txt('The manufacturer and NHTSA advise owners not to drive this vehicle until the recall repair is done. Arrange a tow to the dealer.')))
      : sev.level === 'park-outside'
        ? panel('warning', para(strong('PARK OUTSIDE – FIRE RISK. '), txt('Park this vehicle outside and away from buildings until the recall repair is done.')))
        : null;
  return doc(
    banner,
    para(strong('Vehicle: '), assetUrl ? link(assetKey ? `${v.name || v.vin} (${assetKey})` : v.name || v.vin, assetUrl) : txt(v.name || v.vin), txt(` · ${vehicleLabel(v)}`), v.plate ? txt(` · plate ${v.plate}`) : null, v.depot ? txt(` · depot ${v.depot}`) : null),
    assetUrl ? { type: 'paragraph', content: [{ type: 'inlineCard', attrs: { url: assetUrl } }] } : null,
    para(strong('VIN: '), txt(v.vin), txt(' · '), link('Confirm this VIN is in the campaign (NHTSA)', vinLookupUrl(v.vin))),
    para(strong('Campaign: '), link(`NHTSA ${c.id}`, campaignUrl(c.id)), txt(` · ${c.manufacturer || c.make}`), c.reported ? txt(` · reported ${c.reported}`) : null, c.ota ? txt(' · over-the-air remedy') : null),
    para(strong('Component: '), txt(c.component || 'Not stated')),
    para(strong('Due: '), txt(`${due} (${LEVELS[sev.level].label}). `), txt(sev.reason)),
    ap ? para(strong('Does it apply to this vehicle? '), txt(`${VERDICT_LABEL[ap.verdict]}.`)) : null,
    ap ? { type: 'bulletList', content: ap.reasons.map((r) => ({ type: 'listItem', content: [para(txt(`${MARK[r.result]} ${r.text}`))] })) } : null,
    heading(3, 'Summary'),
    para(txt(c.summary || 'Not stated by NHTSA.')),
    heading(3, 'Consequence'),
    para(txt(c.consequence || 'Not stated by NHTSA.')),
    heading(3, 'Remedy'),
    para(txt(c.remedy || 'Not stated by NHTSA.')),
    para(txt('Opened by Roadworthy from live NHTSA recall data. Campaigns are matched by make, model and model year; use the VIN link above to confirm this vehicle is included, then record the repair or "Not affected" in the Roadworthy panel.', [{ type: 'em' }])),
  );
}

/** Internal comment for an audit event, e.g. "Scheduled at Metro Ford for 2026-11-25". */
export const auditComment = (headline, lines = []) =>
  doc(para(strong('Roadworthy: '), txt(headline)), ...lines.filter(Boolean).map((l) => para(txt(l))));

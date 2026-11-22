// Per-vehicle applicability: is this VIN really in this campaign? NHTSA's public API matches recalls by make,
// model and model year only, so we read the recall's own scope ("equipped with 2.5L HEV engines", "Maverick Hybrid",
// "All Wheel Drive", "previously repaired under 21V-650", a converter's recall) and compare it with what vPIC decodes
// from the VIN and what the fleet recorded about the vehicle's equipment. Deterministic and explained:
//   likely    every limit the recall states matches this vehicle (or it states none)
//   possible  a limit can't be checked from the VIN (equipment, earlier repair): confirm with the NHTSA VIN lookup
//   unlikely  a stated limit contradicts this vehicle (different engine, drive, fuel, equipment or converter)

const MAKES = /\b(ford|lincoln|chevrolet|chevy|gmc|cadillac|buick|toyota|lexus|kia|hyundai|genesis|nissan|infiniti|honda|acura|ram|dodge|chrysler|jeep|mercedes-benz|freightliner|volkswagen|vw|audi|bmw|mini|subaru|mazda|mitsubishi|tesla|rivian|volvo|isuzu|hino)\b/gi;
const QUALIFIERS = {
  HYBRID: 'hybrid', HEV: 'hybrid', PHEV: 'plug-in hybrid', 'PLUG IN HYBRID': 'plug-in hybrid', 'HYBRID HEV': 'hybrid',
  'PLUG IN HYBRID PHEV': 'plug-in hybrid', ELECTRIC: 'electric', EV: 'electric', LIGHTNING: 'electric', DIESEL: 'diesel',
  AWD: 'awd', '4X4': '4wd', CARGO: 'cargo', 'CARGO VAN': 'cargo', PASSENGER: 'passenger', WAGON: 'passenger',
};
const STOP = new Set(['motor', 'motors', 'company', 'corporation', 'corp', 'inc', 'llc', 'america', 'americas', 'north', 'usa', 'us',
  'manufacturing', 'engineering', 'the', 'of', 'and', 'co', 'ltd', 'group', 'vehicles', 'vehicle', 'international', 'automotive', 'mexico', 'a.s.', 'as']);

// Brand families: a recall filed by the parent company covers its brands (GM → Chevrolet/GMC, Stellantis → Ram/Jeep).
const FAMILIES = [
  ['ford', 'lincoln', 'mercury'],
  ['general', 'gm', 'chevrolet', 'chevy', 'gmc', 'cadillac', 'buick', 'brightdrop'],
  ['stellantis', 'fca', 'chrysler', 'dodge', 'jeep', 'ram', 'fiat', 'alfa'],
  ['hyundai', 'kia', 'genesis'],
  ['toyota', 'lexus', 'scion', 'hino'],
  ['honda', 'acura'],
  ['nissan', 'infiniti'],
  ['volkswagen', 'vw', 'audi', 'porsche', 'bentley', 'scout'],
  ['mercedes', 'benz', 'daimler', 'freightliner', 'smart'],
  ['bmw', 'mini', 'rolls'],
  ['volvo', 'polestar'], ['tesla'], ['subaru'], ['mazda'], ['mitsubishi'], ['rivian'], ['jaguar', 'land', 'rover'],
  ['isuzu'], ['navistar', 'international'], ['paccar', 'peterbilt', 'kenworth'],
];
const familyOf = (toks) => FAMILIES.findIndex((f) => f.some((b) => toks.has(b)));

// Plant names in recall text → words in vPIC's plant city ("Kentucky Truck Plant" is in Louisville).
const PLANTS = [
  [/kentucky truck|louisville/i, ['louisville']], [/dearborn/i, ['dearborn']], [/kansas city|kcap|claycomo/i, ['kansas', 'claycomo']],
  [/ohio assembly|avon lake/i, ['avon']], [/chicago/i, ['chicago']], [/flat rock/i, ['flat']], [/michigan assembly|wayne/i, ['wayne']],
  [/hermosillo/i, ['hermosillo']], [/cuautitl/i, ['cuautitlan']], [/oakville/i, ['oakville']], [/wentzville/i, ['wentzville']],
  [/fort wayne/i, ['fort']], [/flint/i, ['flint']], [/arlington/i, ['arlington']], [/spring hill/i, ['spring']],
  [/orion/i, ['orion']], [/lansing|grand river|delta township/i, ['lansing']], [/georgetown|tmmk/i, ['georgetown']],
  [/princeton|tmmi/i, ['princeton']], [/san antonio|tmmtx/i, ['san']], [/smyrna/i, ['smyrna']], [/canton/i, ['canton']],
  [/montgomery|hmma/i, ['montgomery']], [/west point|kmmg/i, ['west']], [/marysville/i, ['marysville']],
  [/warren/i, ['warren']], [/sterling heights/i, ['sterling']], [/jefferson|mack|detroit/i, ['detroit']],
  [/belvidere/i, ['belvidere']], [/saltillo/i, ['saltillo']], [/windsor/i, ['windsor']], [/toledo/i, ['toledo']],
];

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const tokens = (s) => new Set(String(s || '').toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t.length >= 2 && !STOP.has(t)));
const sentences = (s) => String(s || '').split(/(?<=\.)\s+(?=[A-Z])/);
const campaignIdOf = (s) => {
  const m = String(s).match(/(\d{2})V[- ]?(\d{3})/i);
  return m ? `${m[1]}V${m[2]}000` : null;
};

/** The scope sentence split into the model list and the qualifying tail ("equipped with ..."). */
export function scopeOf(summary) {
  const all = sentences(summary);
  const scope = all.find((x) => /\brecalling\b/i.test(x)) || all[0] || '';
  const rest = all.filter((x) => x !== scope).join(' ');
  const m = scope.match(/recalling certain (.*?)\b(vehicles|vans|trucks|buses|motorcycles|chassis)\b(.*)$/i);
  if (!m) return { list: '', tail: scope, rest };
  return { list: m[1], tail: m[3].replace(/\.\s*$/, ''), rest };
}

/** Model-list items for this model: [] when the model isn't named; qualifier '' for a plain mention. */
export function modelItems(list, model) {
  const want = norm(model);
  if (!want) return [];
  const items = String(list).split(/,|;|\band\b/i).map((x) => norm(x.replace(/\b(19|20)\d{2}(\s*-\s*(19|20)\d{2})?\b/g, '').replace(MAKES, '')));
  const out = [];
  for (const it of items) {
    if (it === want) out.push({ item: it, qualifier: '' });
    else if (it.startsWith(want + ' ')) {
      const rest = it.slice(want.length + 1);
      if (QUALIFIERS[rest]) out.push({ item: it, qualifier: QUALIFIERS[rest] });
    }
  }
  return out;
}

const isHybrid = (d) => /HEV|PHEV|hybrid/i.test(`${d.electrification} ${d.engine}`) || (/gasoline/i.test(d.fuel) && /electric/i.test(d.fuel2));
const isPlugIn = (d) => /PHEV|plug/i.test(d.electrification);
const isElectric = (d) => /BEV|battery electric/i.test(d.electrification) || (/^electric$/i.test(d.fuel) && !d.fuel2);
const isDiesel = (d) => /diesel/i.test(d.fuel);
const driveOf = (d) => {
  const t = String(d.drive || '');
  if (/AWD|all[- ]wheel/i.test(t)) return 'awd';
  if (/4WD|4x4|four/i.test(t)) return '4wd';
  if (/FWD|RWD|4x2|2WD|front|rear/i.test(t)) return '2wd';
  return '';
};
const powertrain = (d) =>
  [d.displacement ? `${d.displacement}L` : '', isElectric(d) ? 'battery electric' : isPlugIn(d) ? 'plug-in hybrid' : isHybrid(d) ? 'hybrid' : isDiesel(d) ? 'diesel' : '', d.engine && !/hybrid/i.test(d.engine) ? d.engine.toLowerCase() : '']
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || 'unknown engine';

const FUEL_CHECK = {
  hybrid: [(d) => isHybrid(d), 'hybrid'],
  'plug-in hybrid': [(d) => isPlugIn(d), 'plug-in hybrid'],
  electric: [(d) => isElectric(d), 'battery electric'],
  diesel: [(d) => isDiesel(d), 'diesel'],
};

// Equipment the VIN can't tell us. `has` looks for it in the fleet's equipment notes; `no` for an explicit absence.
const EQUIPMENT = [
  { key: 'hitch', re: /hitch|tow(ing)? (package|harness)|trailer tow/i, has: /hitch|tow/i, label: 'a tow hitch or towing package' },
  { key: 'roof', re: /sunroof|moonroof|panoramic|roof glass|sky ?light/i, has: /sunroof|moonroof|panoramic|roof/i, label: 'a sunroof or glass roof' },
  { key: 'wheelchair', re: /wheelchair|mobility|lift|ramp/i, has: /wheelchair|mobility|lift|ramp/i, label: 'wheelchair or mobility equipment' },
  { key: 'key', re: /jackknife|flip[- ]key/i, has: /jackknife|flip/i, not: /push[- ]?button|smart key|intelligent key|proximity|keyless/i, label: 'a jackknife (flip) ignition key' },
  { key: 'scales', re: /onboard scales/i, has: /scales/i, label: 'the Onboard Scales feature' },
];

// The fleet saying a vehicle is unmodified ("factory cargo van, no conversions") is what lets us rule out
// converter and conversion-equipment recalls. Without it, those stay "possibly".
const NO_CONVERSIONS = /\bno (conversions?|upfits?|modifications?)\b|\b(factory|stock|unmodified)\b/i;

function equipmentCheck(phrase, v, d) {
  const eq = String(v.equipment || '').toLowerCase();
  const items = eq.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  // Screen sizes: "8-inch SYNC infotainment screens" vs "12-inch SYNC screen".
  const want = phrase.match(/(\d+(?:\.\d+)?)[- ]inch\b[^,;]*?(screen|display|radio|sync)/i);
  if (want) {
    const have = items.map((x) => x.match(/(\d+(?:\.\d+)?)[- ]?(inch|in\b|")[^,;]*?(screen|display|radio|sync)/i)).find(Boolean);
    if (have) {
      return Number(have[1]) === Number(want[1])
        ? { result: 'match', text: `Recall covers ${want[1]}-inch screens; this vehicle has a ${have[1]}-inch screen.` }
        : { result: 'mismatch', text: `Recall covers ${want[1]}-inch screens; this vehicle has a ${have[1]}-inch screen.` };
    }
    return { result: 'unknown', text: `Recall covers vehicles with ${want[1]}-inch screens; the VIN doesn't record screen size. Add it to the vehicle's Equipment.` };
  }
  for (const e of EQUIPMENT) {
    if (!e.re.test(phrase)) continue;
    if (e.key === 'wheelchair' && NO_CONVERSIONS.test(eq)) {
      return { result: 'mismatch', text: `Recall covers ${e.label}; this vehicle's equipment says it has no conversions.` };
    }
    if (items.some((x) => /^(no|without)\b/.test(x) && e.has.test(x))) return { result: 'mismatch', text: `Recall covers vehicles with ${e.label}; this vehicle's equipment says it has none.` };
    if (e.not && e.not.test(eq)) return { result: 'mismatch', text: `Recall covers vehicles with ${e.label}; this vehicle has ${items.find((x) => e.not.test(x)) || eq.match(e.not)[0]} instead.` };
    if (e.has.test(eq)) return { result: 'match', text: `Recall covers vehicles with ${e.label}; this vehicle has it.` };
    return { result: 'unknown', text: `Recall covers vehicles with ${e.label}; the VIN doesn't show this. Check the vehicle or record it in Equipment.` };
  }
  const short = phrase.replace(/\s+/g, ' ').trim().slice(0, 90);
  if (eq && tokens(short).size && [...tokens(short)].some((t) => t.length > 3 && eq.includes(t))) return { result: 'match', text: `Recall covers vehicles equipped with ${short}; this vehicle's equipment mentions it.` };
  return { result: 'unknown', text: `Recall covers vehicles equipped with ${short}; the VIN doesn't show this.` };
}

/**
 * Assess one campaign for one vehicle.
 * campaign: { id, summary, component, manufacturer }; vehicle: { make, model, equipment, decoded: {...} }
 * prior(campaignId) -> 'remedied' | 'unlikely' | 'likely' | 'possible' | null (the vehicle's history with an earlier campaign)
 * Returns { verdict, reasons: [{ check, result, text }] }.
 */
export function assess(campaign, vehicle, { prior = () => null } = {}) {
  const d = vehicle.decoded || {};
  const model = vehicle.model || d.model || '';
  const reasons = [];
  const add = (check, result, text) => reasons.push({ check, result, text });
  const { list, tail, rest } = scopeOf(campaign.summary);

  // 1. Who is recalling: a converter or equipment maker's campaign only covers vehicles it modified.
  const recaller = tokens(campaign.manufacturer);
  const builder = new Set([...tokens(vehicle.make), ...tokens(d.manufacturer), ...tokens(d.make)]);
  const recallerFamily = familyOf(recaller);
  const builderFamily = familyOf(builder);
  const sameMaker = [...recaller].some((t) => builder.has(t)) || (recallerFamily >= 0 && recallerFamily === builderFamily);
  if (recaller.size && builder.size && !sameMaker) {
    const eq = String(vehicle.equipment || '').toLowerCase();
    if (recallerFamily >= 0) {
      add('maker', 'unknown', `Recall is filed by ${campaign.manufacturer}, not this vehicle's maker; check whether this VIN is included.`);
    } else if ([...recaller].some((t) => t.length > 3 && eq.includes(t))) {
      add('converter', 'match', `Recall is by ${campaign.manufacturer}; this vehicle's equipment lists their conversion.`);
    } else if (NO_CONVERSIONS.test(eq)) {
      add('converter', 'mismatch', `Recall is by ${campaign.manufacturer}, a converter or equipment maker; this vehicle's equipment says it has no conversions.`);
    } else {
      add('converter', 'unknown', `Recall is by ${campaign.manufacturer}, a converter or equipment maker; it covers only vehicles they modified. Record conversions in Equipment ("no conversions" if none).`);
    }
  }

  // 2. The model as named in the recall: "Maverick Hybrid", "F-150 Lightning", "Transit Cargo".
  const items = modelItems(list, model);
  if (items.length && items.every((x) => x.qualifier)) {
    const q = items[0].qualifier;
    const check = FUEL_CHECK[q];
    if (check) {
      const ok = check[0](d);
      add('model', ok ? 'match' : d.fuel ? 'mismatch' : 'unknown', `Recall covers the ${items.map((x) => x.item.toLowerCase()).join(' / ')} only; this VIN decodes to ${powertrain(d)}.`);
    } else if (q === 'awd' || q === '4wd') {
      const have = driveOf(d);
      add('drive', !have ? 'unknown' : have === q || (q === '4wd' && have === 'awd') ? 'match' : 'mismatch', `Recall covers ${q.toUpperCase()} models; this VIN decodes to ${d.drive || 'an unknown drive type'}.`);
    } else if (q === 'cargo' || q === 'passenger') {
      const body = String(d.body || '');
      const isCargo = /cargo/i.test(body);
      add('body', !body ? 'unknown' : (q === 'cargo') === isCargo ? 'match' : 'mismatch', `Recall covers ${q} versions; this VIN decodes to ${body || 'an unknown body'}.`);
    }
  }

  // 3. The qualifying tail: engines, fuel, drive, equipment, earlier repairs.
  const t = tail || '';
  const disp = [...t.matchAll(/(\d\.\d)\s?-?L\b/gi)].map((m) => m[1]);
  if (disp.length) {
    const want = [...new Set(disp)];
    if (!d.displacement) add('engine', 'unknown', `Recall covers ${want.join('L or ')}L engines; vPIC didn't decode this VIN's engine size.`);
    else add('engine', want.includes(d.displacement) ? 'match' : 'mismatch', `Recall covers ${want.join('L or ')}L engines; this VIN decodes to ${powertrain(d)}.`);
  }
  const fuelWords = /\b(PHEV|HEV|hybrid)\b/i.test(t) ? 'hybrid' : /\bdiesel\b/i.test(t) ? 'diesel' : null;
  if (fuelWords && !reasons.some((r) => r.check === 'model')) {
    const ok = FUEL_CHECK[fuelWords][0](d);
    add('fuel', ok ? 'match' : d.fuel ? 'mismatch' : 'unknown', `Recall covers ${fuelWords} powertrains; this VIN decodes to ${powertrain(d)}.`);
  }
  const wantDrive = /all[- ]wheel drive|\bAWD\b/i.test(t) ? 'awd' : /four[- ]wheel drive|\b4WD\b|\b4x4\b/i.test(t) ? '4wd' : /two[- ]wheel drive|\b2WD\b|\b4x2\b|(front|rear)[- ]wheel drive/i.test(t) ? '2wd' : null;
  if (wantDrive) {
    const have = driveOf(d);
    const label = { awd: 'all-wheel drive', '4wd': 'four-wheel drive', '2wd': 'two-wheel drive' }[wantDrive];
    const result = !have ? 'unknown' : have === wantDrive ? 'match' : wantDrive === 'awd' && have === '4wd' ? 'unknown' : 'mismatch';
    add('drive', result, `Recall covers ${label} vehicles; this VIN decodes to ${d.drive || 'an unknown drive type'}.`);
  }
  const prev = t.match(/previously (?:repaired|remedied)(?: incorrectly)? under (?:nhtsa )?recall(?: number)? ([0-9]{2}V[- ]?[0-9]{3})/i);
  if (prev) {
    const id = campaignIdOf(prev[1]);
    const p = prior(id);
    if (p === 'remedied') add('history', 'match', `Recall covers vehicles repaired under ${prev[1]}; this vehicle's ${prev[1]} repair is on record.`);
    else if (p === 'unlikely') add('history', 'mismatch', `Recall covers vehicles repaired under ${prev[1]}, which doesn't apply to this vehicle.`);
    else add('history', 'unknown', `Recall covers vehicles repaired under ${prev[1]}; Roadworthy has no record of that repair for this vehicle.`);
  }
  const eqm = t.match(/equipped with (.*)$/i);
  if (eqm && !disp.length && !fuelWords && !wantDrive) add('equipment', ...Object.values(equipmentCheck(eqm[1], vehicle, d)));
  if (/ADAPTIVE\/MOBILITY/i.test(campaign.component) && !reasons.some((r) => r.check === 'equipment' || r.check === 'converter')) {
    add('equipment', ...Object.values(equipmentCheck('wheelchair', vehicle, d)));
  }
  const built = `${t} ${rest}`.match(/(?:built|manufactured|produced|assembled) (?:at|in) (?:the )?([A-Z][\w ]+?(?:Assembly(?: Plant)?|Plant|Truck(?: Plant)?|Factory))/);
  if (built) {
    const known = PLANTS.find(([re]) => re.test(built[1]));
    const city = tokens(d.plant);
    if (!known || !city.size) add('plant', 'unknown', `Recall covers vehicles built at ${built[1]}; Roadworthy can't match that plant to this VIN${d.plant ? ` (built in ${d.plant})` : ''}.`);
    else add('plant', known[1].some((w) => city.has(w)) ? 'match' : 'mismatch', `Recall covers vehicles built at ${built[1]}; this VIN was built in ${d.plant}.`);
  }

  // 4. A weak cue: the defect is in a hybrid part, but the scope didn't say so.
  if (!reasons.some((r) => ['model', 'fuel', 'engine'].includes(r.check)) && /\bhybrid\b/i.test(rest) && d.fuel && !isHybrid(d) && !isElectric(d)) {
    add('fuel', 'unknown', `The defect is in a hybrid component; this VIN decodes to ${powertrain(d)}. Confirm with the VIN lookup.`);
  }

  if (!reasons.length) add('scope', 'match', `Recall covers ${model || 'this model'} vehicles of this model year with no engine, drive or equipment limits stated.`);
  // Without a vPIC decode we can't be sure of anything about this VIN: never rule a recall out.
  if (!d.make) {
    for (const r of reasons) if (r.result === 'mismatch') r.result = 'unknown';
    reasons.unshift({ check: 'decode', result: 'unknown', text: "NHTSA vPIC couldn't decode this VIN, so Roadworthy won't rule this recall out. Check the VIN and use the NHTSA VIN lookup." });
  }
  const verdict = reasons.some((r) => r.result === 'mismatch') ? 'unlikely' : reasons.some((r) => r.result === 'unknown') ? 'possible' : 'likely';
  return { verdict, reasons };
}

export const VERDICT_LABEL = { likely: 'Likely affected', possible: 'Possibly affected', unlikely: 'Unlikely' };

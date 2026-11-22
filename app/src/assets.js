// JSM Assets REST API through Forge: requestJira(route`/jsm/assets/workspace/{id}/v1/...`).
// Assets accepts user context; app context is refused on several endpoints (ECO-1808), so callers pass `who` and the
// scan falls back to queueing changes when no user is present.
import { asApp, asUser, route } from '@forge/api';
import { checked } from './errors.js';
import { STATUSES } from './core/fleet.js';

const as = (who) => (who === 'app' ? asApp() : asUser());
const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

const call = async (who, r, what, method = 'GET', body) =>
  checked(
    await as(who).requestJira(r, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) }),
    what,
    'Assets',
  );

/** The site's Assets workspace id, or null when Assets is not available on this site. */
export async function workspaceId(who = 'user') {
  try {
    const r = await call(who, route`/rest/servicedeskapi/assets/workspace`, 'Finding the Assets workspace');
    return r?.values?.[0]?.workspaceId || null;
  } catch (e) {
    if ([401, 403, 404].includes(e.status)) return null;
    throw e;
  }
}

// The Vehicle object type. `Name` is created by Assets as the label; we use it for the unit number.
// defaultTypeId: 0 Text, 1 Integer, 4 Date, 6 DateTime, 7 URL, 10 Select.
export const VEHICLE_ATTRS = [
  { name: 'VIN', defaultTypeId: 0, description: '17-character vehicle identification number', uniqueAttribute: true },
  { name: 'Make', defaultTypeId: 0, description: 'Decoded by NHTSA vPIC' },
  { name: 'Model', defaultTypeId: 0, description: 'Decoded by NHTSA vPIC' },
  { name: 'Model year', defaultTypeId: 1, description: 'Decoded by NHTSA vPIC' },
  { name: 'Plate', defaultTypeId: 0 },
  { name: 'Depot', defaultTypeId: 0 },
  { name: 'Status', defaultTypeId: 10, options: STATUSES.join(','), description: 'Set by Roadworthy from open recalls' },
  { name: 'Driver', defaultTypeId: 0 },
  { name: 'Last recall check', defaultTypeId: 6, description: 'When Roadworthy last checked NHTSA for this vehicle' },
  { name: 'Recalls verified to', defaultTypeId: 4, description: 'Campaigns reported up to this date were already checked at a dealer' },
  { name: 'Open recalls', defaultTypeId: 1, description: 'Open Roadworthy remediation requests' },
  { name: 'Equipment', defaultTypeId: 0, description: 'What the VIN does not show, e.g. "8-inch SYNC screen, tow hitch, push-button start". Used to rule recalls in or out.' },
];
export const SCHEMA_VERSION = 2;

// Attribute name -> field on our vehicle objects.
export const FIELD_OF = {
  Name: 'name', VIN: 'vin', Make: 'make', Model: 'model', 'Model year': 'year', Plate: 'plate', Depot: 'depot',
  Status: 'status', Driver: 'driver', 'Last recall check': 'lastCheck', 'Recalls verified to': 'verifiedTo', 'Open recalls': 'openRecalls',
  Equipment: 'equipment',
};


export async function listSchemas(ws, who = 'user') {
  const r = await call(who, route`/jsm/assets/workspace/${ws}/v1/objectschema/list?maxResults=100`, 'Listing Assets schemas');
  return (r?.values || []).map((s) => ({ id: s.id, name: s.name, key: s.objectSchemaKey, objectCount: s.objectCount }));
}

export async function createSchema(ws, { name, key, description }, who = 'user') {
  return call(who, route`/jsm/assets/workspace/${ws}/v1/objectschema/create`, 'Creating the Fleet schema in Assets', 'POST', {
    name, objectSchemaKey: key, description,
  });
}

export async function listTypes(ws, schemaId, who = 'user') {
  const r = await call(who, route`/jsm/assets/workspace/${ws}/v1/objectschema/${schemaId}/objecttypes/flat`, 'Listing Assets object types');
  return (Array.isArray(r) ? r : r?.values || []).map((t) => ({ id: t.id, name: t.name, objectCount: t.objectCount }));
}

async function pickIcon(ws, who) {
  const icons = await call(who, route`/jsm/assets/workspace/${ws}/v1/icon/global`, 'Listing Assets icons').catch(() => []);
  const list = Array.isArray(icons) ? icons : [];
  // The global icon set has no vehicle icon on current sites; prefer one if Atlassian adds it.
  const pref = [/truck|van|\bcar\b|vehicle/i, /delivery|transport|automatic/i];
  for (const re of pref) {
    const i = list.find((x) => re.test(x.name));
    if (i) return i.id;
  }
  return list[0]?.id;
}

export async function createType(ws, schemaId, { name, description }, who = 'user') {
  const iconId = await pickIcon(ws, who);
  return call(who, route`/jsm/assets/workspace/${ws}/v1/objecttype/create`, `Creating the ${name} object type`, 'POST', {
    name, description, iconId: iconId ? String(iconId) : undefined, objectSchemaId: String(schemaId),
  });
}

export async function listAttributes(ws, typeId, who = 'user') {
  const r = await call(who, route`/jsm/assets/workspace/${ws}/v1/objecttype/${typeId}/attributes`, 'Reading Vehicle attributes');
  return (Array.isArray(r) ? r : r?.values || []).map((a) => ({ id: a.id, name: a.name, label: a.label, defaultTypeId: a.defaultType?.id, options: a.options }));
}

export async function createAttribute(ws, typeId, a, who = 'user') {
  return call(who, route`/jsm/assets/workspace/${ws}/v1/objecttypeattribute/${typeId}`, `Adding the ${a.name} attribute`, 'POST', {
    name: a.name,
    type: 0,
    defaultTypeId: a.defaultTypeId,
    description: a.description || '',
    options: a.options || '',
    uniqueAttribute: Boolean(a.uniqueAttribute),
    minimumCardinality: 0,
    maximumCardinality: 1,
  });
}

/**
 * Find or create the Fleet schema, the Vehicle type and its attributes. Returns the Assets part of the settings:
 * { workspaceId, schemaId, schemaName, typeId, attrs: { [name]: id } }.
 */
export async function ensureFleetSchema(ws, { schemaId, who = 'user' } = {}) {
  let schema;
  const schemas = await listSchemas(ws, who);
  if (schemaId) schema = schemas.find((s) => String(s.id) === String(schemaId));
  if (!schema) schema = schemas.find((s) => /^fleet$/i.test(s.name));
  if (!schema) {
    const taken = new Set(schemas.map((s) => s.key));
    const key = ['FLEET', 'FLEETRW', 'RWFLEET', 'FLEET2'].find((k) => !taken.has(k)) || `FLEET${Date.now() % 1000}`;
    const created = await createSchema(ws, { name: 'Fleet', key, description: 'Vehicles tracked by Roadworthy for safety recalls.' }, who);
    schema = { id: created.id, name: created.name, key: created.objectSchemaKey };
  }
  const types = await listTypes(ws, schema.id, who);
  let type = types.find((t) => /^vehicles?$/i.test(t.name));
  if (!type) {
    const created = await createType(ws, schema.id, { name: 'Vehicle', description: 'A fleet vehicle, checked daily against NHTSA recalls.' }, who);
    type = { id: created.id, name: created.name };
  }
  const have = await listAttributes(ws, type.id, who);
  const attrs = Object.fromEntries(have.map((a) => [a.name, a.id]));
  for (const a of VEHICLE_ATTRS) {
    if (attrs[a.name]) continue;
    const created = await createAttribute(ws, type.id, a, who);
    attrs[a.name] = created.id;
  }
  return { workspaceId: ws, schemaId: String(schema.id), schemaName: schema.name, schemaKey: schema.key, typeId: String(type.id), attrs, version: SCHEMA_VERSION };
}

// ---- Objects --------------------------------------------------------------------------------------------
const valueOf = (attr) => {
  const v = attr?.objectAttributeValues?.[0];
  return v ? (v.value ?? v.displayValue ?? '') : '';
};

/** An Assets object -> our vehicle shape. */
export function toVehicle(obj, attrs) {
  const nameOf = Object.fromEntries(Object.entries(attrs).map(([name, id]) => [String(id), name]));
  const v = { objectId: String(obj.id), objectKey: obj.objectKey, name: obj.label || '' };
  for (const a of obj.attributes || []) {
    const field = FIELD_OF[nameOf[String(a.objectTypeAttributeId)]];
    if (field) v[field] = valueOf(a);
  }
  v.vin = String(v.vin || '').toUpperCase();
  v.year = Number(v.year) || null;
  v.openRecalls = Number(v.openRecalls) || 0;
  if (v.verifiedTo) v.verifiedTo = String(v.verifiedTo).slice(0, 10);
  return v;
}

/** Vehicle fields -> the Assets attributes payload. Only fields present in `fields` are sent. */
export function toAttributes(fields, attrs) {
  const out = [];
  for (const [name, field] of Object.entries(FIELD_OF)) {
    if (!(field in fields) || !attrs[name]) continue;
    const raw = fields[field];
    const values = raw === null || raw === undefined || raw === '' ? [] : [{ value: String(raw) }];
    out.push({ objectTypeAttributeId: String(attrs[name]), objectAttributeValues: values });
  }
  return out;
}

export async function listObjects(a, who = 'user') {
  const out = [];
  let startAt = 0;
  for (let page = 0; page < 50; page++) {
    const r = await call(
      who,
      route`/jsm/assets/workspace/${a.workspaceId}/v1/object/aql?startAt=${startAt}&maxResults=100&includeAttributes=true`,
      'Reading vehicles from Assets',
      'POST',
      { qlQuery: `objectTypeId = ${a.typeId}` },
    );
    const values = r?.values || [];
    out.push(...values.map((o) => toVehicle(o, a.attrs)));
    if (r?.isLast || values.length < 100) break;
    startAt += values.length;
  }
  return out;
}

export async function createObject(a, fields, who = 'user') {
  const r = await call(who, route`/jsm/assets/workspace/${a.workspaceId}/v1/object/create`, `Adding ${fields.name || fields.vin} to Assets`, 'POST', {
    objectTypeId: String(a.typeId),
    attributes: toAttributes(fields, a.attrs),
  });
  return { objectId: String(r.id), objectKey: r.objectKey };
}

export async function updateObject(a, objectId, fields, who = 'user') {
  return call(who, route`/jsm/assets/workspace/${a.workspaceId}/v1/object/${objectId}`, `Updating ${fields.name || 'a vehicle'} in Assets`, 'PUT', {
    objectTypeId: String(a.typeId),
    attributes: toAttributes(fields, a.attrs),
  });
}

export const deleteObject = async (a, objectId, who = 'user') =>
  call(who, route`/jsm/assets/workspace/${a.workspaceId}/v1/object/${objectId}`, 'Removing a vehicle from Assets', 'DELETE');

/** Link to the vehicle in the Assets UI (the /jira/servicedesk/assets/... form redirects here). */
export const objectUrl = (site, a, objectId) =>
  site && a && objectId ? `${site}/jira/assets/object-schema/${a.schemaId}?typeId=${a.typeId}&objectId=${objectId}` : null;

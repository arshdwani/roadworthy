// An in-memory Jira + JSM + Assets + NHTSA, enough to run Roadworthy's real backend code offline.
// Assets refuses app-context calls with 401, as Forge does today (ECO-1808).
import fs from 'node:fs';

const fx = (name) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
const RECALL_FIXTURES = {
  'FORD|TRANSIT|2020': 'recalls_ford_transit_2020',
  'FORD|TRANSIT CONNECT|2019': 'recalls_ford_transit-connect_2019',
  'CHEVROLET|EXPRESS|2020': 'recalls_chevrolet_express_2020',
  'FORD|F-150|2021': 'recalls_ford_f-150_2021',
  'FORD|MAVERICK|2022': 'recalls_ford_maverick_2022',
  'FORD|BRONCO SPORT|2022': 'recalls_ford_bronco-sport_2022',
  'TOYOTA|CAMRY|2021': 'recalls_toyota_camry_2021',
  'NISSAN|ROGUE|2020': 'recalls_nissan_rogue_2020',
  'HYUNDAI|TUCSON|2021': 'recalls_hyundai_tucson_2021',
  'KIA|SPORTAGE|2020': 'recalls_kia_sportage_2020',
  'CHEVROLET|BOLT EV|2020': 'recalls_chevrolet_bolt-ev_2020',
};

export function createSite({ assets = true } = {}) {
  const kv = new Map();
  const s = {
    kv,
    issues: new Map(),
    objects: new Map(),
    schemas: [{ id: '1', name: 'Hardware', objectSchemaKey: 'HW' }],
    types: [],
    attrs: new Map(),
    calls: [],
    nhtsaCalls: [],
    next: { issue: 1, obj: 100, attr: 500, type: 10, schema: 2 },
  };

  const res = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  });

  s.requestJira = (who) => async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    const url = String(path);
    s.calls.push({ who, method, url });
    const p = url.split('?')[0];
    let m;
    if (p === '/rest/api/3/mypermissions') return res(200, { permissions: { ADMINISTER: { havePermission: true } } });
    if (p === '/rest/api/3/serverInfo') return res(200, { baseUrl: 'https://fleet.example.net' });
    if (p === '/rest/api/3/priority/search') return res(200, { values: ['Highest', 'High', 'Medium', 'Low', 'Lowest'].map((n, i) => ({ id: String(i + 1), name: n })) });
    if (p === '/rest/servicedeskapi/servicedesk') return res(200, { values: [{ id: '3', projectId: '10003', projectKey: 'FLEET', projectName: 'Fleet Service' }] });
    if (p === '/rest/servicedeskapi/servicedesk/3/requesttype') return res(200, { values: [{ id: '30', name: 'Get IT help', issueTypeId: '10010' }, { id: '31', name: 'Report a vehicle problem', issueTypeId: '10010' }] });
    if (p === '/rest/servicedeskapi/assets/workspace') return assets ? res(200, { values: [{ workspaceId: 'ws-1' }] }) : res(404, { errorMessage: 'Assets is not enabled' });
    if ((m = p.match(/^\/rest\/servicedeskapi\/servicedesk\/3\/requesttype\/(\d+)\/field$/))) {
      return res(200, { requestTypeFields: m[1] === '30'
        ? [{ fieldId: 'summary', name: 'Summary', required: true }, { fieldId: 'customfield_10050', name: 'Asset tag', required: true }]
        : [{ fieldId: 'summary', name: 'Summary', required: true }, { fieldId: 'description', name: 'Description', required: false }] });
    }
    if (p === '/rest/api/3/project/search') return res(200, { values: [{ id: '10100', key: 'OPS', name: 'Fleet Ops', projectTypeKey: 'business' }] });
    if (p === '/rest/api/3/issue/createmeta/10100/issuetypes') return res(200, { issueTypes: [{ id: '10001', name: 'Task', subtask: false }] });
    if (p === '/rest/api/3/issue' && method === 'POST') {
      const key = `OPS-${s.next.issue++}`;
      s.issues.set(key, { key, id: String(9000 + s.issues.size), fields: { ...body.fields }, comments: [], props: {}, status: 'To Do', by: who });
      return res(201, { key, id: s.issues.get(key).id });
    }
    if (p === '/rest/servicedeskapi/request' && method === 'POST') {
      const key = `FLEET-${s.next.issue++}`;
      s.issues.set(key, { key, id: String(9000 + s.issues.size), fields: { ...body.requestFieldValues, requestTypeId: body.requestTypeId }, comments: [], props: {}, status: 'Waiting for support', by: who });
      return res(201, { issueKey: key, issueId: s.issues.get(key).id });
    }
    if (p === '/rest/api/3/field') return res(200, [{ id: 'customfield_10900', name: 'Affected vehicle', schema: { custom: 'com.atlassian.jira.plugins.cmdb:cmdb-object-cftype' } }, { id: 'summary', name: 'Summary', schema: {} }]);
    if ((m = p.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/))) {
      const i = s.issues.get(m[1]);
      if (method === 'DELETE') { s.issues.delete(m[1]); return res(204); }
      if (method === 'PUT') { Object.assign(i.fields, body.fields); return res(204); }
      return res(200, { key: i.key, id: i.id, fields: { summary: i.fields.summary, status: { name: i.status } } });
    }
    if ((m = p.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/properties\/(\w+)$/))) { s.issues.get(m[1]).props[m[2]] = body; return res(200, {}); }
    if ((m = p.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment$/))) { s.issues.get(m[1]).comments.push(body); return res(201, { id: '1' }); }
    if ((m = p.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/))) {
      // Like the dev site's JSM workflow: no direct To Do -> Done step.
      const st = s.issues.get(m[1]).status;
      if (method === 'GET') return res(200, { transitions: st === 'In progress' ? [
        { id: '21', name: 'Resolve', to: { name: 'Resolved', statusCategory: { key: 'done' } } },
      ] : [
        { id: '11', name: 'Start progress', to: { name: 'In progress', statusCategory: { key: 'indeterminate' } } },
        { id: '12', name: 'In review', to: { name: 'Pending', statusCategory: { key: 'indeterminate' } } },
      ] });
      s.issues.get(m[1]).status = body.transition.id === '21' ? 'Resolved' : 'In progress';
      return res(204);
    }
    // ---- Assets
    if ((m = p.match(/^\/jsm\/assets\/workspace\/ws-1\/v1\/(.*)$/))) {
      if (who === 'app') return res(401, { message: 'Unauthorized' });
      const a = m[1];
      if (a === 'objectschema/list') return res(200, { values: s.schemas, isLast: true });
      if (a === 'objectschema/create') { const sc = { id: String(s.next.schema++), name: body.name, objectSchemaKey: body.objectSchemaKey }; s.schemas.push(sc); return res(201, sc); }
      if ((m = a.match(/^objectschema\/(\d+)\/objecttypes\/flat$/))) return res(200, s.types.filter((t) => t.schemaId === m[1]));
      if (a === 'icon/global') return res(200, [{ id: '7', name: 'Box' }, { id: '12', name: 'Truck' }]);
      if (a === 'objecttype/create') { const t = { id: String(s.next.type++), name: body.name, schemaId: body.objectSchemaId, iconId: body.iconId }; s.types.push(t); s.attrs.set(t.id, [{ id: String(s.next.attr++), name: 'Key' }, { id: String(s.next.attr++), name: 'Name', label: true }]); return res(201, t); }
      if ((m = a.match(/^objecttype\/(\d+)\/attributes$/))) return res(200, s.attrs.get(m[1]) || []);
      if ((m = a.match(/^objecttypeattribute\/(\d+)$/))) { const at = { id: String(s.next.attr++), ...body }; s.attrs.get(m[1]).push(at); return res(201, at); }
      const nameAttr = (typeId) => (s.attrs.get(typeId) || []).find((x) => x.name === 'Name')?.id;
      if (a === 'object/create') {
        const id = String(s.next.obj++);
        const o = { id, objectKey: `FLEET-${id}`, typeId: body.objectTypeId, attributes: body.attributes };
        o.label = body.attributes.find((x) => x.objectTypeAttributeId === nameAttr(body.objectTypeId))?.objectAttributeValues[0]?.value || id;
        s.objects.set(id, o);
        return res(201, { id, objectKey: o.objectKey, label: o.label });
      }
      if (a.startsWith('object/aql')) {
        const typeId = body.qlQuery.match(/objectTypeId = (\d+)/)[1];
        const vals = [...s.objects.values()].filter((o) => o.typeId === typeId);
        return res(200, { values: vals, isLast: true, total: vals.length });
      }
      if ((m = a.match(/^object\/(\d+)$/)) && method === 'DELETE') { s.objects.delete(m[1]); return res(204); }
      if ((m = a.match(/^object\/(\d+)$/)) && method === 'PUT') {
        const o = s.objects.get(m[1]);
        for (const at of body.attributes) {
          const i = o.attributes.findIndex((x) => x.objectTypeAttributeId === at.objectTypeAttributeId);
          if (i >= 0) o.attributes[i] = at; else o.attributes.push(at);
        }
        return res(200, o);
      }
    }
    return res(404, { errorMessages: [`fake site: no route ${method} ${url}`] });
  };

  s.fetch = async (url, opts = {}) => {
    s.nhtsaCalls.push(String(url).split('?')[0]);
    if (String(url).startsWith('https://vpic.nhtsa.dot.gov/')) {
      const vins = new URLSearchParams(opts.body).get('data').split(';');
      const all = fx('vpic_batch').Results;
      return res(200, { Results: vins.map((v) => all.find((r) => r.VIN === v) || { VIN: v, ErrorCode: '1', ErrorText: '1 - Check Digit (9th position) does not calculate properly', Make: '', Model: '', ModelYear: '' }) });
    }
    const u = new URL(url);
    if (u.pathname === '/recalls/recallsByVehicle') {
      const k = `${u.searchParams.get('make').toUpperCase()}|${u.searchParams.get('model').toUpperCase()}|${u.searchParams.get('modelYear')}`;
      return RECALL_FIXTURES[k] ? res(200, fx(RECALL_FIXTURES[k])) : res(400, fx('recalls_empty_400'));
    }
    if (u.pathname === '/products/vehicle/models') return res(200, { results: [] });
    return res(404, {});
  };
  return s;
}

/** Fake @forge/kvs over a Map, including FAIL_IF_EXISTS and prefix queries with cursors. */
export function fakeKvs(map) {
  const query = () => {
    const q = { prefix: '', n: 100, c: 0 };
    const api = {
      where: (_k, cond) => { q.prefix = cond.prefix; return api; },
      limit: (n) => { q.n = n; return api; },
      cursor: (c) => { q.c = Number(c); return api; },
      getMany: async () => {
        const keys = [...map.keys()].filter((k) => k.startsWith(q.prefix)).sort();
        const page = keys.slice(q.c, q.c + q.n);
        return { results: page.map((key) => ({ key, value: structuredClone(map.get(key)) })), nextCursor: q.c + q.n < keys.length ? String(q.c + q.n) : undefined };
      },
    };
    return api;
  };
  return {
    kvs: {
      get: async (k) => (map.has(k) ? structuredClone(map.get(k)) : undefined),
      set: async (k, v, o) => {
        if (!/^[A-Za-z0-9:._#\s-]+$/.test(k)) throw new Error(`bad key ${k}`);
        if (o?.keyPolicy === 'FAIL_IF_EXISTS' && map.has(k)) throw new Error('KEY_ALREADY_EXISTS');
        map.set(k, structuredClone(v));
      },
      delete: async (k) => { map.delete(k); },
      query,
    },
    WhereConditions: { beginsWith: (prefix) => ({ prefix }) },
  };
}

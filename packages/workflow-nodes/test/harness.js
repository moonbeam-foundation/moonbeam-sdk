// The request the node sends for one operation and the items it answers, from the BUILT node description and nothing else.
//
// The node is declarative: the routing engine turns `routing.request` on the chosen operation, `routing.send` on every visible
// parameter (query fields, preSend hooks) and the credential's authenticate() into one HTTP request, and runs `postReceive`
// on the answer. This replays exactly that subset, so a test compares the node's request with the one the SDK sends.
'use strict';
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist');
const load = () => {
	const { Moonbeam } = require(path.join(DIST, 'nodes/Moonbeam/Moonbeam.node.js'));
	const { MoonbeamApi } = require(path.join(DIST, 'credentials/MoonbeamApi.credentials.js'));
	return { d: new Moonbeam().description, cred: new MoonbeamApi() };
};

/** An expression `={{ … }}` over $value, $parameter and $credentials. */
function evaluate(v, ctx) {
	if (typeof v !== 'string' || !v.startsWith('=')) return v;
	const run = (expr) => new Function('$value', '$parameter', '$credentials', `return (${expr});`)(ctx.$value, ctx.$parameter, ctx.$credentials);
	const whole = v.slice(1).match(/^\s*\{\{([\s\S]*)\}\}\s*$/);
	if (whole && !whole[1].includes('}}')) return run(whole[1]);
	return v.slice(1).replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => String(run(e)));
}

const matches = (cond, params) => Object.entries(cond).every(([k, list]) => list.includes(params[k]));
const visible = (p, params) => {
	const s = p.displayOptions?.show; const h = p.displayOptions?.hide;
	if (s && !matches(s, params)) return false;
	if (h && Object.entries(h).some(([k, list]) => list.includes(params[k]))) return false;
	return true;
};

/** Every operation shipped: resource, operation, display name, the request as written. */
function operations() {
	const { d } = load();
	const out = [];
	for (const p of d.properties) {
		if (p.name !== 'operation') continue;
		for (const o of p.options) out.push({ resource: p.displayOptions.show.resource[0], operation: o.value, name: o.name, action: o.action, description: o.description, routing: o.routing });
	}
	return out;
}

function paramsFor(d, resource, operation, given) {
	const params = { resource, operation, ...given };
	for (let pass = 0; pass < 2; pass++)
		for (const p of d.properties) if (!(p.name in params) && p.name !== 'operation' && visible(p, params)) params[p.name] = p.default;
	return params;
}

/** The context a preSend or postReceive hook runs in. */
function context(params, credentials) {
	return {
		getNodeParameter: (name, fallback) => (name in params ? params[name] : fallback),
		getCredentials: async () => { if (!credentials) throw new Error('no credentials'); return credentials; },
		getNode: () => ({ id: 'test', name: 'Moonbeam', type: 'moonbeam', typeVersion: 1, position: [0, 0], parameters: params }),
	};
}

const opOf = (d, resource, operation) => {
	const p = d.properties.find((x) => x.name === 'operation' && x.displayOptions.show.resource[0] === resource);
	const o = p && p.options.find((x) => x.value === operation);
	if (!o) throw new Error(`no operation ${resource}/${operation}`);
	return o;
};

/**
 * The request the node sends: { method, url (absolute, with its query), headers, body }.
 * `given` holds the parameters a user sets (collections as objects); `credentials` is { endpoint, apiKey }.
 */
async function buildRequest(resource, operation, given = {}, credentials = { endpoint: 'https://endpoint.example/v1', apiKey: '' }) {
	const { d, cred } = load();
	const params = paramsFor(d, resource, operation, given);
	const op = opOf(d, resource, operation);
	const ctx = { $parameter: params, $credentials: credentials };
	const base = { ...d.requestDefaults, ...op.routing.request };
	const req = {
		method: base.method,
		baseURL: evaluate(base.baseURL, ctx),
		url: evaluate(base.url, ctx),
		headers: { ...(d.requestDefaults.headers ?? {}), ...(op.routing.request.headers ?? {}) },
		qs: { ...(op.routing.request.qs ?? {}) },
		body: op.routing.request.body ? JSON.parse(JSON.stringify(op.routing.request.body)) : undefined,
	};
	const hooks = [...(op.routing.send?.preSend ?? [])];
	const send = (p, value) => {
		const s = p.routing?.send; if (!s) return;
		if (s.preSend) hooks.push(...s.preSend);
		if (!s.type) return;
		const v = evaluate(s.value ?? '={{ $value }}', { ...ctx, $value: value });
		if (v === undefined) return;
		if (s.type === 'query') req.qs[s.property] = v;
		else if (s.type === 'body') { req.body = req.body ?? {}; req.body[s.property] = v; }
	};
	for (const p of d.properties) {
		if (p.name === 'operation' || p.name === 'resource' || !visible(p, params)) continue;
		if (p.type === 'collection') { for (const o of p.options) if (params[p.name] && o.name in params[p.name]) send(o, params[p.name][o.name]); }
		else send(p, params[p.name]);
	}
	const hookCtx = context(params, credentials);
	let r = req;
	for (const h of hooks) r = await h.call(hookCtx, r);
	r = await cred.authenticate(credentials, r);
	const u = new URL(`${r.baseURL}${r.url}`);
	for (const [k, v] of Object.entries(r.qs ?? {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
	return { method: r.method, url: u.toString(), headers: r.headers ?? {}, body: r.body };
}

/** The items the node answers for one response: { statusCode, body }. */
async function respond(resource, operation, given, response, credentials = { endpoint: 'https://endpoint.example/v1', apiKey: 'k' }) {
	const { d } = load();
	const params = paramsFor(d, resource, operation, given);
	const op = opOf(d, resource, operation);
	let items = [{ json: response.body }];
	for (const f of op.routing.output?.postReceive ?? []) items = await f.call(context(params, credentials), items, { statusCode: response.statusCode, headers: {}, body: response.body });
	return items.map((i) => i.json);
}

module.exports = { load, operations, buildRequest, respond, evaluate };

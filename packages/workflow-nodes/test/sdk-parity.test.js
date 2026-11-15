// The node sends what @moonbeam-foundation/sdk sends. Each operation's request (method, path, query, body, key header) is built
// by the node's own description and compared with the request the SDK function makes through a recording transport; the answers
// the SDK and the node give for the same body are compared where both shape it. The fixtures are recorded answers (2026-11-15);
// the journey's own endpoint host in them is written as endpoint.example.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildRequest, respond } = require('./harness');

const BASE = 'https://endpoint.example/v1';
const KEY = 'plan-key-for-tests';
const JOURNEY = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/journey-8453-1170141.json'), 'utf8'));
const sdk = () => import('@moonbeam-foundation/sdk/market');

/** A transport that records the one request the SDK makes and answers `answer`. */
function recorder(answer = { ok: true }, status = 200, apiKey = KEY) {
	const seen = [];
	const t = {
		base: BASE,
		apiKey,
		fetch: async (url, init = {}) => {
			seen.push({ url, method: init.method, headers: init.headers ?? {}, body: init.body === undefined ? undefined : JSON.parse(init.body) });
			return new Response(JSON.stringify(answer), { status, headers: { 'content-type': 'application/json' } });
		},
	};
	return { t, seen };
}
/** One request, comparable: method, path, query as a sorted list, body, the key header. */
const shape = (r) => {
	const u = new URL(r.url);
	const h = Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
	return { method: r.method, path: u.origin + u.pathname, query: [...u.searchParams.entries()].sort(), body: r.body ?? null, key: h['x-api-key'] ?? null };
};
const same = async (label, nodeReq, sdkCall, answer) => {
	const { t, seen } = recorder(answer);
	await sdkCall(t);
	assert.strictEqual(seen.length, 1, `${label}: the SDK makes one request`);
	const n = shape(await nodeReq);
	const s = shape(seen[0]);
	// the SDK sends no body on a GET, the node none either
	if (s.method === 'GET') s.body = null;
	assert.deepStrictEqual(n, s, `${label}: the node sends what the SDK sends`);
};
const cred = { endpoint: `${BASE}/`, apiKey: KEY };

test('the SDK the node is built on is 0.13.0 or a later 0.x', () => {
	const v = require('@moonbeam-foundation/sdk/package.json').version;
	const [major, minor] = v.split('.').map(Number);
	assert.ok(major === 0 && minor >= 13, `found ${v}`);
	assert.strictEqual(require('../dist/nodes/Moonbeam/sdk.generated.js').SDK_VERSION, v, 'sdk.generated.ts was made from this SDK (npm run gen)');
});

test('Agent Standing → Get Journey is journey(t, ref)', async () => {
	const m = await sdk();
	await same('journey', buildRequest('standing', 'journey', { agent: '8453:1170141' }, cred), (t) => m.journey(t, '8453:1170141'), JOURNEY);
});

test('Get Journey takes the refs journey() takes, and refuses the ones it refuses', async () => {
	const m = await sdk();
	const refs = ['8453:1170141', 'erc8004:8453:1', 'x402:0123456789ab', 'x402:host:api.example.com', 'virtuals:0123456789ab', 'near:abcdefabcdef', '1:2',
		'8453:', 'x402:0123', 'x402:host:A', 'virtuals:XYZ', 'hello', '', '8453:1170141 trailing', 'olas:0123456789abc'];
	for (const ref of refs) {
		const { t } = recorder(JOURNEY);
		const sdkOk = await m.journey(t, ref).then(() => true, (e) => (e instanceof RangeError ? false : true));
		const nodeOk = await buildRequest('standing', 'journey', { agent: ref }, cred).then(() => true, () => false);
		assert.strictEqual(nodeOk, sdkOk, `ref "${ref}": node ${nodeOk}, SDK ${sdkOk}`);
	}
});

test('Get Journey answers what journeyOf() reads: every venue by id, in the SDK\'s order', async () => {
	const m = await sdk();
	const j = m.journeyOf(JOURNEY);
	const [whole] = await respond('standing', 'journey', { agent: '8453:1170141' }, { statusCode: 200, body: JOURNEY });
	assert.deepStrictEqual(whole, j.body);
	const rows = await respond('standing', 'journey', { agent: '8453:1170141', output: 'venues' }, { statusCode: 200, body: JOURNEY });
	assert.deepStrictEqual(rows.map((r) => r.venue_id), [...m.VENUE_IDS]);
	for (const r of rows) {
		const { agent, read_at, ...venue } = r;
		assert.strictEqual(agent, '8453:1170141');
		assert.strictEqual(read_at, j.read_at);
		assert.deepStrictEqual(venue, j.venues[r.venue_id]);
	}
	const [one] = await respond('standing', 'journey', { agent: '8453:1170141', output: 'venue', venue: 'workflow-nodes' }, { statusCode: 200, body: JOURNEY });
	assert.deepStrictEqual(one.leds, j.venues['workflow-nodes'].leds);
});

test('Get Journey refuses an answer journeyOf() refuses', async () => {
	const m = await sdk();
	const broken = [{ ...JOURNEY, schema: 'other' }, { ...JOURNEY, venues: JOURNEY.venues.slice(1) }, { ...JOURNEY, checks: undefined }];
	for (const body of broken) {
		assert.throws(() => m.journeyOf(body));
		await assert.rejects(respond('standing', 'journey', { agent: '8453:1170141' }, { statusCode: 200, body }));
	}
});

test('Agent Standing → Get List Status is listStatus(t, ref), with the id derived the SDK\'s way', async () => {
	const m = await sdk();
	const { listIdOf } = require('../dist/nodes/Moonbeam/descriptions/shared.js');
	for (const ref of ['8453:1', '8453:1170141', '8453:1176098', '8453:999999999999']) assert.strictEqual(listIdOf(ref), await m.listIdOf(ref), ref);
	const answer = { list: { id: await m.listIdOf('8453:1170141'), agent: { ref: '8453:1170141' }, markets: { erc8004: { state: 'listed' } } } };
	await same('listStatus', buildRequest('standing', 'listStatus', { listAgent: '8453:1170141' }, cred), (t) => m.listStatus(t, '8453:1170141'), answer);
	const [out] = await respond('standing', 'listStatus', { listAgent: '8453:1170141' }, { statusCode: 200, body: answer });
	assert.deepStrictEqual(out.list, answer.list);
	// never listed: the SDK answers null, the node list: null
	const { t } = recorder({ ok: false, code: 'not_found' }, 404);
	assert.strictEqual(await m.listStatus(t, '8453:1170141'), null);
	const [none] = await respond('standing', 'listStatus', { listAgent: '8453:1170141' }, { statusCode: 404, body: { ok: false, code: 'not_found' } });
	assert.deepStrictEqual(none, { agent: '8453:1170141', list: null });
});

test('Listing → List on Markets is listOn(t, ref, markets)', async () => {
	const m = await sdk();
	const answer = { list: { id: 'lst_x', agent: {}, markets: {} } };
	await same('listOn all', buildRequest('listing', 'listOn', { listOnAgent: '8453:1170141' }, cred), (t) => m.listOn(t, '8453:1170141'), answer);
	await same('listOn one', buildRequest('listing', 'listOn', { listOnAgent: '8453:1170141', markets: ['mcp_registry'] }, cred), (t) => m.listOn(t, '8453:1170141', ['mcp_registry']), answer);
	await assert.rejects(buildRequest('listing', 'listOn', { listOnAgent: '8453:1', markets: [] }, cred));
	await assert.rejects(buildRequest('listing', 'listOn', { listOnAgent: '1:1' }, cred));
});

test('Listing → Pause, Go Live and Delist are pauseListing, resumeListing and delistListing', async () => {
	const m = await sdk();
	const id = 'al_0123456789abcdef';
	const answer = { listing: { id, status: 'paused' }, export: {}, probe: [] };
	await same('pause', buildRequest('listing', 'pause', { listingId: id }, cred), (t) => m.pauseListing(t, id), answer);
	await same('resume', buildRequest('listing', 'resume', { listingId: id }, cred), (t) => m.resumeListing(t, id), answer);
	await same('delist', buildRequest('listing', 'delist', { listingId: id, confirm: id }, cred), (t) => m.delistListing(t, id, { confirm: id }), answer);
	await assert.rejects(buildRequest('listing', 'delist', { listingId: id, confirm: 'al_ffffffffffffffff' }, cred), /repeat the listing id/);
	await assert.rejects(buildRequest('listing', 'pause', { listingId: 'lst_0123' }, cred), /al_ and 16 hex/);
});

test('Hire → Search Sellers is searchSellers(t, { tag, venue, side, priceCap, limit })', async () => {
	const m = await sdk();
	await same('search plain', buildRequest('hire', 'searchSellers', { tag: 'text.summarize' }, cred), (t) => m.searchSellers(t, { tag: 'text.summarize' }), { hits: [] });
	await same('search filtered', buildRequest('hire', 'searchSellers', { tag: 'mcp.digest', searchFilters: { venue: 'x402-base', side: 'seller', priceCap: '0.05', limit: 5 } }, cred),
		(t) => m.searchSellers(t, { tag: 'mcp.digest', venue: 'x402-base', side: 'seller', priceCap: '0.05', limit: 5 }), { hits: [] });
	const hits = [{ venue: 'x402-base' }, { venue: 'mcp' }];
	assert.deepStrictEqual(await respond('hire', 'searchSellers', { tag: 'x.y' }, { statusCode: 200, body: { hits, n: 2 } }), hits);
});

test('Hire → Plan Hire is hirePlan(t, terms): the same terms, nothing signed', async () => {
	const m = await sdk();
	const buyer = '0x0000000000000000000000000000000000000001';
	const seller = '0x0000000000000000000000000000000000000002';
	const answer = { calls: [{ action: 'fund-job', signer: 'buyer' }] };
	await same('plan minimal', buildRequest('hire', 'plan', { buyer, seller, price: '1000000', deadline: 1900000000 }, cred),
		(t) => m.hirePlan(t, { chainId: 8453, buyer, seller, price: '1000000', deadline: 1900000000 }), answer);
	await same('plan with ref', buildRequest('hire', 'plan', { buyer, seller, price: '25', deadline: 1900000000, planOptions: { evidence: '0xab', refId: 'order-1', note: 'n' } }, cred),
		(t) => m.hirePlan(t, { chainId: 8453, buyer, seller, price: '25', deadline: 1900000000, evidence: '0xab', ref: { id: 'order-1', note: 'n' } }), answer);
	const [out] = await respond('hire', 'plan', {}, { statusCode: 200, body: answer });
	assert.deepStrictEqual(out.calls, (await m.hirePlan(recorder(answer).t, { chainId: 8453, buyer, seller, price: '1', deadline: 1 })).calls);
	assert.strictEqual(out.sent, false);
	await assert.rejects(buildRequest('hire', 'plan', { buyer: '0x1', seller, price: '1' }, cred), /0x addresses/);
	await assert.rejects(buildRequest('hire', 'plan', { buyer, seller, price: '1.5' }, cred), /whole number/);
});

test('Key → Get Standing and Get Usage are keyStanding(t) and usage(t, { window, scope })', async () => {
	const m = await sdk();
	await same('keyStanding', buildRequest('key', 'standing', {}, cred), (t) => m.keyStanding(t), { plan: null });
	await same('usage default', buildRequest('key', 'usage', {}, cred), (t) => m.usage(t), {});
	await same('usage 7d key', buildRequest('key', 'usage', { window: '7d', scope: 'key' }, cred), (t) => m.usage(t, { window: '7d', scope: 'key' }), {});
});

test('the plan actions need the plan key, as the SDK\'s needKey does; the free reads send no key header at all', async () => {
	const m = await sdk();
	const noKey = { endpoint: BASE, apiKey: '' };
	const id = 'al_0123456789abcdef';
	const buyer = '0x0000000000000000000000000000000000000001';
	const keyed = [
		[['listing', 'listOn', { listOnAgent: '8453:1' }], (t) => m.listOn(t, '8453:1')],
		[['listing', 'pause', { listingId: id }], (t) => m.pauseListing(t, id)],
		[['listing', 'resume', { listingId: id }], (t) => m.resumeListing(t, id)],
		[['listing', 'delist', { listingId: id, confirm: id }], (t) => m.delistListing(t, id, { confirm: id })],
		[['hire', 'plan', { buyer, seller: buyer, price: '1', deadline: 1 }], (t) => m.hirePlan(t, { chainId: 8453, buyer, seller: buyer, price: '1', deadline: 1 })],
		[['key', 'standing', {}], (t) => m.keyStanding(t)],
		[['key', 'usage', {}], (t) => m.usage(t)],
	];
	for (const [[r, o, g], call] of keyed) {
		const { t, seen } = recorder({}, 200, '');
		await assert.rejects(call(t), (e) => e.status === 401, `${r}/${o}: the SDK refuses without a key`);
		assert.strictEqual(seen.length, 0);
		await assert.rejects(buildRequest(r, o, g, noKey), /plan key/, `${r}/${o}: the node refuses without a key`);
	}
	for (const [r, o, g] of [['standing', 'journey', { agent: '8453:1' }], ['standing', 'listStatus', { listAgent: '8453:1' }], ['hire', 'searchSellers', { tag: 'a.b' }]]) {
		const req = await buildRequest(r, o, g, noKey);
		assert.ok(!Object.keys(req.headers).some((h) => h.toLowerCase() === 'x-api-key'), `${r}/${o}: no empty key header`);
	}
});

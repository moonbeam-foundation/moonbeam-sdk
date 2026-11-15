// With no credential (or one without an Endpoint) every free read runs on Moonbeam's own host, through its relays on
// next.moonbeam.network, and the plan actions refuse before anything is sent. The relay answers are recorded from next (2026-11-15).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildRequest, respond, operations } = require('./harness');

const fixture = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));
const LIST = fixture('relay-list-8453-1170141.json');
const MARKET = fixture('relay-jobs-market-mcp.digest.json');
const BATCH = fixture('relay-journeys-8453-1170141.json');
const KEYS = ['offer', 'hire', 'list', 'read_back', 'paid'];
const none = null; // no credential at all
const keyOnly = { endpoint: '', apiKey: 'plan-key-for-tests' };
const url = (r) => { const u = new URL(r.url); return { at: u.origin + u.pathname, q: Object.fromEntries(u.searchParams) }; };

test('every free read has a relay on Moonbeam\'s own host; the paid-calls server is there already', async () => {
	const free = operations().filter((o) => / Free\.$/.test(o.description));
	const given = { journey: { agent: '8453:1170141' }, listStatus: { listAgent: '8453:1170141' }, searchSellers: { tag: 'mcp.digest' }, listTools: {}, whereListed: { whereAgent: '8453:1170141' } };
	const at = {};
	for (const o of free) at[o.operation] = url(await buildRequest(o.resource, o.operation, given[o.operation], none));
	assert.deepStrictEqual(at, {
		journey: { at: 'https://next.moonbeam.network/api/acp/agents/journeys', q: { refs: '8453:1170141' } },
		listStatus: { at: 'https://next.moonbeam.network/api/acp/list', q: { ref: '8453:1170141' } },
		searchSellers: { at: 'https://next.moonbeam.network/api/acp/jobs/market', q: { q: 'mcp.digest' } },
		listTools: { at: 'https://next.moonbeam.network/api/acp/x402/mcp', q: {} },
		whereListed: { at: 'https://next.moonbeam.network/api/acp/x402/mcp', q: {} },
	});
	// a key without an endpoint changes nothing for the free reads
	assert.deepStrictEqual(url(await buildRequest('standing', 'journey', { agent: '8453:1' }, keyOnly)).at, 'https://next.moonbeam.network/api/acp/agents/journeys');
});

test('Get Journey on the relay: every venue the SDK knows, each light by name; unread where the relay has none', async () => {
	const body = BATCH;
	const rows = await respond('standing', 'journey', { agent: '8453:1170141', output: 'venues' }, { statusCode: 200, body }, none);
	assert.deepStrictEqual(rows.map((r) => r.venue_id), require('../dist/nodes/Moonbeam/sdk.generated.js').VENUES.map((v) => v.id), 'the SDK\'s venues, in its order');
	for (const r of rows) {
		const read = body.agents['8453:1170141'][r.venue_id];
		assert.strictEqual(r.standing, read ? read.standing : 'unread');
		KEYS.forEach((k, i) => assert.strictEqual(r.leds[k].state, read ? read.leds[i] : 'unread', `${r.venue_id} ${k}`));
	}
	const [one] = await respond('standing', 'journey', { agent: '8453:1170141', output: 'venue', venue: 'workflow-nodes' }, { statusCode: 200, body }, none);
	assert.deepStrictEqual(one.leds.list, { state: 'off' });
	// a venue the relay has not read is unread, never off
	const less = { ...body, agents: { '8453:1170141': { ...body.agents['8453:1170141'] } } }; delete less.agents['8453:1170141']['mcp'];
	const [mcp] = await respond('standing', 'journey', { agent: '8453:1170141', output: 'venue', venue: 'mcp' }, { statusCode: 200, body: less }, none);
	assert.strictEqual(mcp.standing, 'unread');
	const [whole] = await respond('standing', 'journey', { agent: '8453:1170141' }, { statusCode: 200, body }, none);
	assert.strictEqual(whole.pending, false);
	assert.strictEqual(whole.venues.length, 10);
	const [later] = await respond('standing', 'journey', { agent: '8453:9' }, { statusCode: 200, body: { ok: true, agents: {}, missing: ['8453:9'] } }, none);
	assert.strictEqual(later.pending, true);
	assert.ok(later.venues.every((v) => v.standing === 'unread'));
	await assert.rejects(respond('standing', 'journey', { agent: '8453:1' }, { statusCode: 404, body: '<html>' }, none));
});

test('Get List Status on the relay answers the list step, or list: null', async () => {
	const [out] = await respond('standing', 'listStatus', { listAgent: '8453:1170141' }, { statusCode: 200, body: LIST }, none);
	assert.strictEqual(out.list.id, 'lst_8339b4f9b0f5e5ab');
	assert.strictEqual(out.list.id, require('../dist/nodes/Moonbeam/descriptions/shared.js').listIdOf('8453:1170141'), 'the relay\'s id is the SDK\'s derivation');
	assert.deepStrictEqual(await respond('standing', 'listStatus', { listAgent: '8453:1176098' }, { statusCode: 200, body: { ok: true, list: null } }, none), [{ agent: '8453:1176098', list: null }]);
	await assert.rejects(respond('standing', 'listStatus', { listAgent: '8453:1' }, { statusCode: 503, body: { ok: false, code: 'unavailable', why: 'the read did not answer in time' } }, none), /did not answer in time/);
});

test('Search Sellers on the relay: the class\'s sellers, with the venue, price cap and limit filters applied', async () => {
	const all = await respond('hire', 'searchSellers', { tag: 'mcp.digest' }, { statusCode: 200, body: MARKET }, none);
	assert.strictEqual(all.length, MARKET.search.sellers.rows.length);
	assert.ok(all.every((r) => r.class === 'mcp.digest' && r.market && r.ref));
	assert.strictEqual((await respond('hire', 'searchSellers', { tag: 'mcp.digest', searchFilters: { limit: 2 } }, { statusCode: 200, body: MARKET }, none)).length, 2);
	assert.deepStrictEqual((await respond('hire', 'searchSellers', { tag: 'mcp.digest', searchFilters: { priceCap: '0.001' } }, { statusCode: 200, body: MARKET }, none)).map((r) => r.price_usd), [0.001]);
	assert.strictEqual((await respond('hire', 'searchSellers', { tag: 'mcp.digest', searchFilters: { venue: 'mcp' } }, { statusCode: 200, body: MARKET }, none)).length, 0);
});

test('the plan actions refuse without the endpoint that comes with the key, and send nothing', async () => {
	const id = 'al_0123456789abcdef';
	const buyer = '0x0000000000000000000000000000000000000001';
	for (const [r, o, g] of [['listing', 'listOn', { listOnAgent: '8453:1' }], ['listing', 'pause', { listingId: id }], ['hire', 'plan', { buyer, seller: buyer, price: '1', deadline: 1 }], ['key', 'standing', {}], ['key', 'usage', {}]]) {
		await assert.rejects(buildRequest(r, o, g, keyOnly), /Endpoint/, `${r}/${o} with a key and no endpoint`);
		await assert.rejects(buildRequest(r, o, g, none), /plan key/, `${r}/${o} with no credential`);
	}
});

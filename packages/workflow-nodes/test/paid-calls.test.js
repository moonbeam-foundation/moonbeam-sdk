// Paid Call → List Tools and Where Listed: one JSON-RPC request each to Moonbeam's paid-calls server (the MCP Registry's
// network.moonbeam.next/paid-calls), answered from a recorded tools/list of that server.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildRequest, respond } = require('./harness');

const TOOLS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paid-calls-tools-list.json'), 'utf8'));
const cred = { endpoint: 'https://endpoint.example/v1', apiKey: '' };

test('List Tools posts tools/list to Moonbeam\'s paid-calls server, not to the endpoint', async () => {
	const r = await buildRequest('paidCalls', 'listTools', {}, cred);
	assert.strictEqual(r.method, 'POST');
	assert.strictEqual(r.url, 'https://next.moonbeam.network/api/acp/x402/mcp');
	assert.deepStrictEqual(r.body, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
	assert.match(r.headers.Accept, /text\/event-stream/);
});

test('List Tools answers one item per tool, the free where-listed tool among them', async () => {
	const items = await respond('paidCalls', 'listTools', {}, { statusCode: 200, body: TOOLS });
	assert.deepStrictEqual(items.map((t) => t.name), TOOLS.result.tools.map((t) => t.name));
	assert.ok(items.some((t) => t.name === 'moonbeam_where_listed'));
	for (const t of items) assert.ok(t.inputSchema && t.description, t.name);
});

test('Where Listed calls moonbeam_where_listed with the agent, and answers its structured content and its words', async () => {
	const r = await buildRequest('paidCalls', 'whereListed', { whereAgent: '8453:1176098' }, cred);
	assert.deepStrictEqual(r.body, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'moonbeam_where_listed', arguments: { ref: '8453:1176098' } } });
	const body = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Moonbeam has not listed 8453:1176098 anywhere yet.' }], structuredContent: { ref: '8453:1176098', list: null } } };
	assert.deepStrictEqual(await respond('paidCalls', 'whereListed', { whereAgent: '8453:1176098' }, { statusCode: 200, body }),
		[{ ref: '8453:1176098', list: null, says: 'Moonbeam has not listed 8453:1176098 anywhere yet.' }]);
	await assert.rejects(buildRequest('paidCalls', 'whereListed', { whereAgent: 'x402:host:a.b' }, cred), /8453:/);
});

test('a JSON-RPC error, a tool error or an HTTP error is a node error with the server\'s words', async () => {
	await assert.rejects(respond('paidCalls', 'listTools', {}, { statusCode: 200, body: { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } } }), /Method not found/);
	await assert.rejects(respond('paidCalls', 'whereListed', { whereAgent: '8453:1' }, { statusCode: 200, body: { result: { isError: true, content: [{ type: 'text', text: 'bad ref' }] } } }), /bad ref/);
	await assert.rejects(respond('paidCalls', 'listTools', {}, { statusCode: 503, body: { error: 'down for a moment' } }), /down for a moment/);
});

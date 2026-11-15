// The package the directory takes, and its words. The directory lists a package whose name starts n8n-nodes- (scoped is
// allowed) and whose keywords hold n8n-community-node-package, with no run-time dependency, strict mode on, a reachable
// author mailbox and every node and credential it names built. Every file it ships speaks in Moonbeam's words: the
// platform's own tokens are the only place the workflow tool's name appears.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { load, operations } = require('./harness');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');

test('the directory\'s rules: name, keyword, no run-time dependency, strict, author mailbox, built files', () => {
	assert.match(pkg.name, /^(@[a-z0-9-]+\/)?n8n-nodes-[a-z0-9-]+$/);
	assert.strictEqual(pkg.name, '@moonbeam-foundation/n8n-nodes-moonbeam');
	assert.ok(pkg.keywords.includes('n8n-community-node-package'));
	assert.deepStrictEqual(Object.keys(pkg.dependencies ?? {}), [], 'no run-time dependency');
	assert.strictEqual(pkg.n8n.strict, true);
	assert.strictEqual(pkg.n8n.n8nNodesApiVersion, 1);
	assert.match(pkg.author.email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
	assert.strictEqual(pkg.license, 'MIT');
	assert.strictEqual(pkg.repository.url, 'git+https://github.com/moonbeam-foundation/moonbeam-sdk.git', 'provenance names this repository');
	assert.strictEqual(pkg.repository.directory, 'packages/workflow-nodes');
	for (const f of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) assert.ok(fs.existsSync(path.join(root, f)), `${f} is built`);
	assert.strictEqual(pkg.publishConfig.access, 'public');
});

test('the node reads no environment and no file system, and imports only the platform\'s own module', () => {
	const files = execFileSync('git', ['ls-files', '--others', '--cached', '--exclude-standard', 'nodes', 'credentials'], { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.ts'));
	assert.ok(files.length >= 7);
	for (const f of files) {
		const src = fs.readFileSync(path.join(root, f), 'utf8');
		assert.doesNotMatch(src, /process\.env|child_process|from ['"](node:)?fs['"]|require\(/, f);
		for (const [, from] of src.matchAll(/from '([^']+)'/g)) assert.ok(from === 'n8n-workflow' || from.startsWith('.'), `${f} imports ${from}`);
	}
});

test('the client header carries the package version', () => {
	const { d } = load();
	assert.strictEqual(d.requestDefaults.headers['X-Moonbeam-Client'], `workflow-nodes/${pkg.version}`);
});

test('every operation is named, has an action and a description, and says whether it is free or on a plan key', () => {
	const ops = operations();
	assert.deepStrictEqual(ops.map((o) => `${o.resource}/${o.operation}`).sort(), [
		'hire/plan', 'hire/searchSellers', 'key/standing', 'key/usage', 'listing/delist', 'listing/listOn', 'listing/pause', 'listing/resume',
		'paidCalls/listTools', 'paidCalls/whereListed', 'standing/journey', 'standing/listStatus',
	]);
	for (const o of ops) {
		assert.ok(o.name && o.action && o.description, `${o.resource}/${o.operation}`);
		assert.match(o.description, /(Free|Plan key)\.$/, `${o.resource}/${o.operation} says Free or Plan key`);
		const keyed = (o.routing.send?.preSend ?? []).some((f) => f.name === 'needKey');
		assert.strictEqual(keyed, /Plan key\.$/.test(o.description), `${o.resource}/${o.operation}: needs the key exactly when it says so`);
	}
});

test('field conventions: placeholders start with "e.g.", options sorted, the credential is the one Moonbeam API', () => {
	const { d, cred } = load();
	const all = d.properties.flatMap((p) => (p.type === 'collection' ? [p, ...p.options] : [p]));
	for (const p of all) if (p.placeholder && p.type !== 'collection') assert.match(p.placeholder, /^e\.g\. /, p.name);
	for (const p of d.properties) {
		if (p.name === 'operation' || !Array.isArray(p.options) || p.type === 'collection') continue;
		if (p.name === 'resource' || p.name === 'output' || p.name === 'chainId' || p.name === 'scope' || p.name === 'window') continue;
		const names = p.options.map((o) => o.name);
		assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)), `${p.name} options sorted`);
	}
	assert.deepStrictEqual(d.credentials, [{ name: 'moonbeamApi', required: false }], 'the free reads need no credential');
	assert.strictEqual(d.requestDefaults.baseURL, 'https://next.moonbeam.network');
	assert.notStrictEqual(cred.properties.find((p) => p.name === 'endpoint').required, true, 'the endpoint is an optional override');
	assert.strictEqual(cred.name, 'moonbeamApi');
	assert.deepStrictEqual(cred.properties.map((p) => p.name), ['endpoint', 'apiKey']);
	assert.strictEqual(cred.properties.find((p) => p.name === 'apiKey').typeOptions.password, true);
});

test('the Venue picker offers every venue the SDK knows, and Workflow nodes is the default', async () => {
	const { d } = load();
	const m = await import('@moonbeam-foundation/sdk/market');
	const v = d.properties.find((p) => p.name === 'venue' && p.displayOptions.show.resource[0] === 'standing');
	assert.deepStrictEqual(v.options.map((o) => o.value).sort(), [...m.VENUE_IDS].sort());
	assert.strictEqual(v.default, 'workflow-nodes');
});

test('the credential sends the key only when it is set, in x-api-key, and tests on a free read', async () => {
	const { cred } = load();
	assert.deepStrictEqual(await cred.authenticate({ endpoint: 'https://e/v1', apiKey: '' }, { url: '/x', headers: { a: '1' } }), { url: '/x', headers: { a: '1' } });
	assert.deepStrictEqual((await cred.authenticate({ endpoint: 'https://e/v1', apiKey: ' k ' }, { url: '/x' })).headers, { 'x-api-key': 'k' });
	const { evaluate } = require('./harness');
	const t = (endpoint) => { const c = { $credentials: { endpoint } }; return evaluate(cred.test.request.baseURL, c) + evaluate(cred.test.request.url, c); };
	assert.strictEqual(t(''), 'https://next.moonbeam.network/api/acp/plans', 'no endpoint: a free read on Moonbeam');
	assert.strictEqual(t(' https://e.example/v1/ '), 'https://e.example/v1/classes', 'an endpoint: a free read there');
});

test('sdk.generated.ts is what the SDK says now (npm run gen:check)', () => {
	const r = spawnSync(process.execPath, ['scripts/gen-sdk.mjs', '--check'], { cwd: root, encoding: 'utf8' });
	assert.strictEqual(r.status, 0, r.stderr);
});

// ── words ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const FORBIDDEN = {
	'the operator\'s name': /taifoon/gi,
	'the workflow tool': /n8n/gi,
	'the layer': /\bthe layer\b/gi,
	'a markup': /\bmark-?ups?\b|\bprice\s*\+\s*\d+(?:[.,]\d+)?\s*%|\+\s?\d+(?:[.,]\d+)?\s?%|\bresold at\b|(?:×|\bx)\s?1\.\d+\b/gi,
	'checked before you pay': /checked before you pay/gi,
};
/** The platform's own tokens, cut before the scan: the package name, the directory keyword, the package.json key, its module and tool. */
const PLATFORM = [
	/@moonbeam-foundation\/n8n-nodes-moonbeam/g,
	/\bn8n-community-node-package\b/g,
	/"n8n":/g,
	/\bn8nNodesApiVersion\b/g,
	/\bn8n-workflow\b/g,
	/\bn8n_workflow_\d+\b/g, // the compiled import of that module
	/\bIN8nHttpFullResponse\b/g, // a type that module names
	/@n8n\/node-cli/g,
	/\bn8n-node (?:build|dev|lint|release|prerelease)\b/g,
];
const found = (text) => {
	let t = text; for (const w of PLATFORM) t = t.replace(w, '');
	const n = {};
	for (const [k, r] of Object.entries(FORBIDDEN)) { const c = (t.match(r) ?? []).length; if (c) n[k] = c; }
	return n;
};

test('every shipped file, the README and the CHANGELOG speak in Moonbeam\'s words', () => {
	const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	const files = JSON.parse(out)[0].files.map((f) => f.path);
	assert.ok(files.includes('README.md') && files.includes('CHANGELOG.md') && files.includes('dist/nodes/Moonbeam/Moonbeam.node.js'), files.join(', '));
	const bad = [];
	for (const f of files) {
		if (!/\.(?:js|ts|json|md|svg)$/.test(f)) continue;
		const n = found(fs.readFileSync(path.join(root, f), 'utf8'));
		for (const [k, c] of Object.entries(n)) bad.push(`${f}: ${c} × ${k}`);
	}
	assert.deepStrictEqual(bad, []);
});

test('the source a reviewer reads speaks in Moonbeam\'s words too', () => {
	const files = execFileSync('git', ['ls-files', '--others', '--cached', '--exclude-standard', 'nodes', 'credentials', 'README.md', 'CHANGELOG.md'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
	const bad = [];
	for (const f of files) for (const [k, c] of Object.entries(found(fs.readFileSync(path.join(root, f), 'utf8')))) bad.push(`${f}: ${c} × ${k}`);
	assert.deepStrictEqual(bad, []);
});

test('the word scan catches each phrase and lets the platform tokens through', () => {
	assert.deepStrictEqual(found('Taifoon; n8n; the layer holds it; checked before you pay; a markup'),
		{ 'the operator\'s name': 1, 'the workflow tool': 1, 'the layer': 1, 'a markup': 1, 'checked before you pay': 1 });
	for (const s of ['the buyer pays the price + 20 %', 'listed at +20%', 'resold at a premium', 'seller price ×1.2']) assert.deepStrictEqual(found(s), { 'a markup': 1 }, s);
	assert.deepStrictEqual(found('"name": "@moonbeam-foundation/n8n-nodes-moonbeam", "keywords": ["n8n-community-node-package"], "n8n": {}, require("n8n-workflow")'), {});
});

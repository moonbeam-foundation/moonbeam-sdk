#!/usr/bin/env node
// _COORD_IO_COVERAGE_v1_: record the fixtures of test/io/op-map.json by running the SDK's own function (from dist/: npm run build
// first) through a recording transport. The SDK makes the request; the transport answers it by the row's source:
//   live           a plain public GET through scripts/io-live.mjs (no key, <= 150 calls in all, >= 1 s apart, 401/402/429 stops)
//   devnet-ledger  built from test/fixtures/economy/36927-v5.1-economy.ledger.json (the devnet run of every ending)
//   contract       the answer test/io/calls.mjs writes for the call, checked against coord's declared fields before it is kept
// A live answer is kept as served, less any treasury-like field and the keyless get_key offer (each dropped and named).
//   node scripts/io-record.mjs --coord <path> [--only <call>] [--force] [--seed <dir>] [--remask]
//   <key on stdin> | node scripts/io-record.mjs --coord <path> --key-stdin [--only <call>]   (_IO_RECORDER_KEY_v1_)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expandRows, fixturesOnDisk, loadCoord, pathRe, shapeIssues } from './io-coverage-lib.mjs';
import { liveGet } from './io-live.mjs';
import { assertNoSecret, readRecorderKey } from './io-key.mjs';
import { collect, mask } from './io-mask.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const coordPath = arg('--coord');
if (!coordPath) { console.error('usage: io-record.mjs --coord <path> [--only <call>] [--force]'); process.exit(2); }
const only = arg('--only');
if (process.argv.includes('--key-stdin')) await readRecorderKey();
const force = process.argv.includes('--force');
const c = loadCoord(resolve(coordPath), { sha: arg('--sha') });
const map = JSON.parse(readFileSync(join(root, 'test/io/op-map.json'), 'utf8'));
const { CALLS, sdkOf } = await import(pathToFileURL(join(root, 'test/io/calls.mjs')).href);
const dist = (p) => import(pathToFileURL(join(root, 'dist', p)).href);
const s = sdkOf([await dist('market/index.js'), await dist('playground/index.js'), await dist('jobs/index.js')]);
const ledger = JSON.parse(readFileSync(join(root, 'test/fixtures/economy/36927-v5.1-economy.ledger.json'), 'utf8'));
const LIVE_BASE = 'https://coord.taifoon.dev/v1';

// ── answers by source ─────────────────────────────────────────────────────────────────────────────────────────────────
const liveCache = new Map();
for (const fx of fixturesOnDisk(root).values()) if (fx.source === 'live') liveCache.set(keyOf(fx.request), { status: fx.response.status, body: fx.response.body, read_at: fx.read_at, cached: true });
// --seed <dir>: raw answers of calls already made through scripts/io-live.mjs (each { path, status, body, read_at }): no new call
const seedDir = arg('--seed');
if (seedDir) for (const f of readdirSync(seedDir).filter((n) => n.endsWith('.json'))) {
  const r = JSON.parse(readFileSync(join(seedDir, f), 'utf8'));
  collect(r.body);
  if (!r.path || r.status !== 200) continue;
  const u = new URL(`${LIVE_BASE}${r.path}`);
  liveCache.set(keyOf({ method: 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams) }), { status: r.status, body: r.body, read_at: r.read_at, fresh: true });
}
for (const v of liveCache.values()) collect(v.body);
function keyOf(r) { const q = new URLSearchParams(r.query ?? {}).toString(); return `${r.method} ${r.path}${q ? `?${q}` : ''}`; }

function ledgerAnswer(req) {
  const m = /^\/v1\/chain\/36927\/tx\/(0x[0-9a-fA-F]{64})$/.exec(req.path);
  if (!m) return null;
  const evs = ledger.ledger.flatMap((j) => j.events).filter((e) => e.tx.toLowerCase() === m[1].toLowerCase());
  if (!evs.length) return null;
  // only the fields coord's answer declares (tx.block_number, tx.events[].event, tx.events[].args); the ledger keeps no status
  return { status: 200, body: { tx: { block_number: evs[0].block, events: evs.map(({ event, tx: _t, block: _b, ...args }) => ({ event, args })) } } };
}

function transport(source, def, x, recs) {
  return {
    base: LIVE_BASE,
    ...(def.key ? { apiKey: 'io-replay-key' } : {}),
    fetch: async (url, init) => {
      const u = new URL(url);
      const req = { method: init?.method ?? 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), ...(init?.body ? { body: JSON.parse(init.body) } : {}) };
      let ans = null, read_at = null;
      if (source === 'live') {
        if (req.method !== 'GET' || def.key) throw new Error(`live is GET without a key only: ${req.method} ${req.path}`);
        const k = keyOf(req);
        let got = liveCache.get(k);
        if (!got || (force && !got.fresh)) {
          const r = await liveGet(root, `${u.pathname.replace(/^\/v1/, '')}${u.search}`);
          collect(r.body);
          got = { status: r.status, body: r.body, read_at: r.read_at, refused: r.refused, fresh: true };
          liveCache.set(k, got);
        }
        ans = { status: got.status, body: got.body }; read_at = got.read_at;
        if (got.refused) recs.refused = `${got.status} on ${req.path}`;
      } else if (source === 'devnet-ledger') ans = ledgerAnswer(req);
      else ans = typeof def.contract === 'function' ? def.contract(x, req) : null;
      if (!ans) ans = { status: 404, body: { ok: false, code: 'no_fixture_answer' } };
      recs.push({ req, ans, read_at });
      return { ok: ans.status >= 200 && ans.status < 300, status: ans.status, headers: new Headers(), json: async () => structuredClone(ans.body), text: async () => JSON.stringify(ans.body) };
    },
  };
}

// --remask: apply the masking above to every live fixture on disk again (no call): a field it drops now is dropped and named
if (process.argv.includes('--remask')) {
  for (const [p, fx] of fixturesOnDisk(root)) {
    if (fx.source !== 'live') continue;
    const notes = { dropped: [...(fx.notes?.dropped ?? [])], trimmed: [...(fx.notes?.trimmed ?? [])] };
    const n = notes.dropped.length;
    fx.response.body = mask(fx.response.body, '', notes);
    if (notes.dropped.length === n) continue;
    fx.notes = { ...(fx.notes ?? {}), dropped: [...new Set(notes.dropped.map((d) => d.replace(/\[\d+\]/g, '[]')))], ...(notes.trimmed.length ? { trimmed: [...new Set(notes.trimmed)] } : {}) };
    const text = JSON.stringify(fx, null, 1) + '\n';
    assertNoSecret(text, p);
    writeFileSync(join(root, p), text);
    console.log(`remasked ${p}`);
  }
  process.exit(0);
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const rows = expandRows(map).filter((r) => r.call && (!only || r.call === only));
const done = new Set();
let wrote = 0;
const problems = [];
for (const row of rows) {
  const def = CALLS[row.call];
  if (!def) { problems.push(`${row.fixture}: no call ${row.call} in test/io/calls.mjs`); continue; }
  const group = row.flow ? rows.filter((r) => r.flow === row.flow && r.market === row.market) : [row];
  const gkey = row.flow ? `flow:${row.flow}:${row.market}` : row.fixture;
  if (done.has(gkey)) continue;
  done.add(gkey);
  if (!force && group.every((r) => existsSync(join(root, r.fixture)))) continue;
  const x = { market: row.market, stage: row.stage, op: row.op };
  if (def.args && !def.needs) x.args = def.args();
  if (def.needs) {
    const dep = expandRows(map).find((r) => r.call === def.needs && r.market === row.market && r.fixture && existsSync(join(root, r.fixture)));
    if (!dep) { problems.push(`${row.fixture}: needs ${def.needs} recorded first`); continue; }
    x.args = def.args(JSON.parse(readFileSync(join(root, dep.fixture), 'utf8')));
    if (Object.values(x.args).some((v) => v === undefined || v === null)) { problems.push(`${row.fixture}: ${def.needs} answered no ${Object.keys(x.args).join(', ')}`); continue; }
  }
  const recs = [];
  let error = null;
  try { await def.run(s, transport(row.source, def, x, recs), x); } catch (e) { error = e; }
  if (recs.refused) { problems.push(`REFUSED ${row.fixture}: ${recs.refused} (make the row a gap)`); continue; }
  for (const r of group) {
    const name = r.op.replace(/^(GET|POST)\s+/, '');
    const rec = recs.find((q) => q.req.method === r.op.split(' ')[0] && pathRe(name).test(q.req.path));
    if (!rec) { problems.push(`${r.fixture}: the SDK made no ${r.op} request (${recs.map((q) => `${q.req.method} ${q.req.path}`).join(', ') || 'none'}${error ? `; threw ${error.message}` : ''})`); continue; }
    const notes = { dropped: [], trimmed: [] };
    const body = r.source === 'live' ? mask(rec.ans.body, '', notes) : rec.ans.body;
    const fx = {
      op: r.op, market: r.market, stage: r.stage, dir: r.dir, sdk: def.fn, source: r.source,
      request: rec.req, response: { status: rec.ans.status, body },
      coord_sha: c.sha, read_at: rec.read_at ?? new Date().toISOString(),
      ...(x.args ? { args: x.args } : {}),
      ...(notes.dropped.length || notes.trimmed.length ? { notes: { ...(notes.dropped.length ? { dropped: [...new Set(notes.dropped.map((d) => d.replace(/\[\d+\]/g, '[]')))] } : {}), ...(notes.trimmed.length ? { trimmed: notes.trimmed } : {}) } } : {}),
    };
    const issues = shapeIssues(c, fx).filter((i) => !(r.accept ?? []).includes(i));
    if (issues.length && r.source !== 'live') { problems.push(`NOT KEPT ${r.fixture}: ${issues.join(', ')} (a ${r.source} fixture carries only what coord declares)`); continue; }
    if (issues.length) problems.push(`shape ${r.fixture}: ${issues.join(', ')}`);
    mkdirSync(dirname(join(root, r.fixture)), { recursive: true });
    const text = JSON.stringify(fx, null, 1) + '\n';
    assertNoSecret(text, r.fixture);
    writeFileSync(join(root, r.fixture), text);
    wrote++;
  }
}
console.log(`wrote ${wrote} fixture(s)`);
for (const p of problems) console.log(`  ${p}`);

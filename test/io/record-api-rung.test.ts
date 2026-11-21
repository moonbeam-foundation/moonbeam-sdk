// _ACCEPTANCE_TESTS_v1_: the api-rung recorder (scripts/record-api-rung.mjs), over an injected fetch only: no network, no key of ours.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error: a plain ES module
import { liveRunOf, liveWalks, planLive, planWalk, recordApiRung, resolveRead, sdkCallOf, stageOf } from '../../scripts/record-api-rung.mjs';
// @ts-expect-error: a plain ES module shared with the recorder
import { isWallAnswer } from '../../scripts/io-live.mjs';
// @ts-expect-error: a plain ES module
import { mask } from '../../scripts/io-mask.mjs';
// @ts-expect-error: a plain ES module
import { CALLS, sdkOf } from './calls.mjs';
import * as marketSdk from '../../src/market/index.js';
// @ts-expect-error: a plain ES module
import { holdKeyForTest } from '../../scripts/io-key.mjs';

const REAL = join(__dirname, '..', '..');
const map = JSON.parse(readFileSync(join(REAL, 'test/io/op-map.json'), 'utf8'));
const paths = JSON.parse(readFileSync(join(REAL, 'src/market/venue-paths.json'), 'utf8'));
const KEY = `tfr_${'k'.repeat(24)}`;

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'api-rung-')); mkdirSync(join(root, 'test/io'), { recursive: true }); holdKeyForTest(KEY); });
afterEach(() => { holdKeyForTest(null); rmSync(root, { recursive: true, force: true }); });

type Call = { url: string; headers: Record<string, string>; method: string };
function fakeFetch(answer: (u: URL) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = async (url: URL | string, init: { method: string; headers: Record<string, string> }) => {
    const u = new URL(String(url)); calls.push({ url: u.toString(), headers: init.headers, method: init.method });
    const a = answer(u);
    return { status: a.status, text: async () => JSON.stringify(a.body) };
  };
  return { fetchImpl, calls };
}
const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)).map((f) => join(e.name, f)) : [e.name]));
const sell = paths.rows.find((r: { op: string; steps: Array<{ read?: string }> }) => r.op === 'sell' && r.steps.length > 1 && r.steps.every((s) => s.read));
const { market } = sell;

describe('_ACCEPTANCE_TESTS_v1_ api-rung recorder', () => {
  it('fills a read\'s placeholders, and names the ones it lacks', () => {
    expect(resolveRead('GET /v1/a/{id}?x={tx}&y=1', { id: 'q 1', tx: '0xab' })).toEqual({ method: 'GET', path: '/v1/a/q%201', query: { x: '0xab', y: '1' }, missing: [] });
    expect(resolveRead('GET /v1/a/{id}', {}).missing).toEqual(['id']);
    // a query value is kept as it is: the URL encodes it once, when the read is asked
    expect(resolveRead('GET /v1/a?name={name}', { name: 'a.b/c d' }).query).toEqual({ name: 'a.b/c d' });
    expect(() => resolveRead('POST /v1/a', {})).toThrow(/not a GET/);
    expect(() => resolveRead('GET https://elsewhere.example/x', {})).toThrow(/not a GET \/v1/);
  });

  it('plans the read steps of the path, in order, with the stage of each', () => {
    const w = planWalk(paths, map, market, 'sell');
    expect(w.steps.map((x: { step: { id: string } }) => x.step.id)).toEqual(sell.steps.map((s: { id: string }) => s.id));
    for (const x of w.steps) expect(map.stages).toContain(x.stage);
    expect(stageOf({ features: [{ stage: 'paid' }] }, { id: 'nope' }, map)).toBe('paid');
    expect(() => planWalk(paths, map, market, 'nothing')).toThrow(/no path/);
  });

  it('records each answered step as a fixture, masked, with the key only as a request header', async () => {
    const params: Record<string, string> = {};
    for (const s of sell.steps) for (const m of s.read.matchAll(/\{(\w+)\}/g)) params[m[1]] = 'p1';
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { ok: true, payTo: `0x${'a'.repeat(40)}`, rows: [{ n: 1 }] } }));
    const r = await recordApiRung({ root, paths, map, market, op: 'sell', params, fetchImpl, gapMs: 0, now: () => '2026-01-01T00:00:00.000Z' });
    expect(r.stopped).toBeNull();
    expect(r.wrote).toHaveLength(sell.steps.length);
    expect(calls).toHaveLength(sell.steps.length);
    for (const c of calls) { expect(c.method).toBe('GET'); expect(c.headers['x-api-key']).toBe(KEY); expect(new URL(c.url).origin).toBe('https://coord.taifoon.dev'); }
    for (const f of r.wrote) {
      const text = readFileSync(join(root, f), 'utf8');
      const fx = JSON.parse(text);
      expect(f).toMatch(/\.api-sell-[a-z]+\.json$/);
      expect(Object.keys(fx)).toEqual(expect.arrayContaining(['op', 'market', 'stage', 'dir', 'source', 'request', 'response', 'coord_sha', 'read_at']));
      expect(fx.coord_sha).toBe(paths.coord.sha);
      expect(fx.response.body.payTo).toBeUndefined();
      expect(fx.notes.dropped[0]).toMatch(/^payTo/);
      expect(text).not.toContain(KEY);
    }
    expect(readFileSync(join(root, 'test/io/live-log.json'), 'utf8')).not.toContain(KEY);
    // recorded once: a second walk keeps what is there
    const again = await recordApiRung({ root, paths, map, market, op: 'sell', params, fetchImpl, gapMs: 0 });
    expect(again.wrote).toEqual([]);
    expect(again.skipped.every((s: string) => /is recorded/.test(s))).toBe(true);
  });

  it('lists a step without its placeholder values and asks nothing for it', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: {} }));
    const r = await recordApiRung({ root, paths, map, market, op: 'sell', params: {}, fetchImpl, gapMs: 0 });
    const needing = sell.steps.filter((s: { read: string }) => /\{/.test(s.read)).length;
    expect(r.skipped.filter((s: string) => /needs --param/.test(s))).toHaveLength(needing);
    expect(calls).toHaveLength(sell.steps.length - needing);
  });

  it('stops at a 402 or 429 and keeps nothing after it', async () => {
    const params: Record<string, string> = {};
    for (const s of sell.steps) for (const m of s.read.matchAll(/\{(\w+)\}/g)) params[m[1]] = 'p1';
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 429, body: { ok: false } }));
    const r = await recordApiRung({ root, paths, map, market, op: 'sell', params, fetchImpl, gapMs: 0 });
    expect(r.stopped).toMatch(/^429 on /);
    expect(r.wrote).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(existsSync(join(root, 'test/io/fixtures'))).toBe(false);
  });

  it('refuses an answer that echoes the key, before anything is kept', async () => {
    const params: Record<string, string> = {};
    for (const s of sell.steps) for (const m of s.read.matchAll(/\{(\w+)\}/g)) params[m[1]] = 'p1';
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: { echo: KEY } }));
    await expect(recordApiRung({ root, paths, map, market, op: 'sell', params, fetchImpl, gapMs: 0 })).rejects.toThrow(/refused to write/);
    expect(files(root).filter((f) => f.includes('fixtures'))).toEqual([]);
  });
});

// _MAINNET_IO_v1_: --rung live records a mainnet run: the steps it covers, with its own public ids, without a key
describe('_MAINNET_IO_v1_ mainnet-run recorder', () => {
  const SHA = 'b'.repeat(40);
  const REF = 'live:m/list@2026-11-06';
  const livePaths = (needs: string[] = []) => ({ coord: { sha: SHA }, markets: ['m'], rows: [{ market: 'm', op: 'list', cohorts: ['moonbeam'],
    steps: [{ id: 'listed', leaves: 'an entry', read: 'GET /v1/mcp/registry/server?name={name}' }, { id: 'paid', leaves: 'a payout', read: 'GET /v1/chain/tx?hashes={tx}' }, { id: 'shown', leaves: 'a page', read: 'GET /v1/catalog?kind={venue}' }],
    features: [{ feature: 'list', stage: 'listed', fixture: null, run: null, live: { fixture: 'test/io/fixtures/m/listed/run-live-list.json', run: { rung: 'live', on: '2026-11-06', ref: REF }, steps: ['listed', 'shown', ...(needs.length ? ['paid'] : [])], ids: { name: 'a.b/c-d' }, needs } }] }] });
  const liveMap = { ...map, markets: ['m'], rows: [{ op: 'GET mcp/registry/server', markets: ['m'], stage: 'listed', dir: 'read', sdk: 'market.mcpServer', gap: { reason: 'needs_payment', why: 'a gap of the matrix' } }] };
  beforeEach(() => holdKeyForTest(null));

  it('reads the run from the paths: its ref, the steps it covers, its ids; a path with no mainnet run has none', () => {
    expect(liveRunOf(livePaths(), 'm', 'list')).toEqual({ ref: REF, covers: ['listed', 'shown'], ids: { name: 'a.b/c-d' }, needs: [] });
    expect(liveRunOf(livePaths(), 'm', 'sell')).toBeNull();
    expect(liveWalks(livePaths())).toEqual([{ market: 'm', op: 'list' }]);
    expect(() => planLive(livePaths(), liveMap, 'm', 'sell')).toThrow(/no mainnet run/);
    // the snapshot's own mainnet runs are each a path of the snapshot
    for (const w of liveWalks(paths)) expect(paths.rows.some((r: { market: string; op: string }) => r.market === w.market && r.op === w.op)).toBe(true);
  });

  it('plans only the covered steps, with the run\'s ids and the market\'s own id as {venue}', () => {
    const w = planLive(livePaths(), liveMap, 'm', 'list');
    expect(w.steps.map((x: { step: { id: string }; path: string; query: unknown; missing: string[] }) => [x.step.id, x.path, x.query, x.missing])).toEqual([
      ['listed', '/v1/mcp/registry/server', { name: 'a.b/c-d' }, []], ['shown', '/v1/catalog', { kind: 'm' }, []]]);
  });

  it('records each covered step without a key, with the run\'s ref and step, masked; a name the run needs comes by --param', async () => {
    const { fetchImpl, calls } = fakeFetch((u) => ({ status: 200, body: { ok: true, name: u.searchParams.get('name'), owner: `0x${'c'.repeat(40)}`, payTo: `0x${'a'.repeat(40)}` } }));
    const sdkCall = sdkCallOf(sdkOf([marketSdk]), CALLS, liveMap);
    const short = await recordApiRung({ root, paths: livePaths(['tx']), map: liveMap, market: 'm', op: 'list', rung: 'live', fetchImpl, gapMs: 0, sdkCall });
    expect(short.skipped).toEqual(['paid: needs --param tx=…']);
    expect(short.wrote.map((f: string) => f.split('/').pop())).toEqual(['read-mcp-registry-server.live-list-listed.json', 'read-catalog.live-list-shown.json']);
    for (const c of calls) { expect(c.method).toBe('GET'); expect(c.headers['x-api-key']).toBeUndefined(); }
    expect(new URL(calls[0]!.url).searchParams.get('name')).toBe('a.b/c-d');
    const fx = JSON.parse(readFileSync(join(root, short.wrote[0]), 'utf8'));
    expect(fx).toMatchObject({ op: 'GET mcp/registry/server', market: 'm', stage: 'listed', source: 'live', rung: 'live', run: REF, path: { op: 'list', step: 'listed' }, coord_sha: SHA,
      request: { method: 'GET', path: '/v1/mcp/registry/server', query: { name: 'a.b/c-d' } }, sdk: 'market.mcpServer', args: { name: 'a.b/c-d' } });
    expect(fx.response.body).toEqual({ ok: true, name: 'a.b/c-d' });
    expect(fx.notes.dropped).toEqual(['owner (the address that owns the record)', 'payTo (a payee, requester, signer or treasury-like address field)']);
    // a read no SDK call makes is kept without one
    expect(JSON.parse(readFileSync(join(root, short.wrote[1]), 'utf8')).sdk).toBeUndefined();
    const given = await recordApiRung({ root, paths: livePaths(['tx']), map: liveMap, market: 'm', op: 'list', rung: 'live', params: { tx: '0xab' }, fetchImpl, gapMs: 0 });
    expect(given.wrote.map((f: string) => f.split('/').pop())).toEqual(['read-chain-tx.live-list-paid.json']);
  });

  it('stops at a 402 and keeps nothing; the route stays closed that day and may be asked once on a later day', async () => {
    const refuse = fakeFetch(() => ({ status: 402, body: { ok: false } }));
    const r = await recordApiRung({ root, paths: livePaths(), map: liveMap, market: 'm', op: 'list', rung: 'live', fetchImpl: refuse.fetchImpl, gapMs: 0 });
    expect(r.stopped).toMatch(/^402 on /); expect(r.wrote).toEqual([]); expect(refuse.calls).toHaveLength(1);
    const ok = fakeFetch(() => ({ status: 200, body: { ok: true } }));
    const same = await recordApiRung({ root, paths: livePaths(), map: liveMap, market: 'm', op: 'list', rung: 'live', fetchImpl: ok.fetchImpl, gapMs: 0 });
    expect(same.stopped).toMatch(/^402 on /); expect(ok.calls).toHaveLength(0);
    // the refusal was yesterday's: the free rate is counted per day
    const log = join(root, 'test/io/live-log.json'); const l = JSON.parse(readFileSync(log, 'utf8'));
    l.calls[0].at = new Date(Date.now() - 36 * 3600_000).toISOString(); writeFileSync(log, JSON.stringify(l));
    const next = await recordApiRung({ root, paths: livePaths(), map: liveMap, market: 'm', op: 'list', rung: 'live', fetchImpl: ok.fetchImpl, gapMs: 0 });
    expect(next.stopped).toBeNull(); expect(next.wrote).toHaveLength(2);
    // the api rung keeps the old rule: a refused route stays closed
    writeFileSync(log, JSON.stringify(l));
    const api = await recordApiRung({ root, paths: livePaths(), map: liveMap, market: 'm', op: 'list', params: { name: 'a.b/c-d' }, fetchImpl: ok.fetchImpl, gapMs: 0 });
    expect(api.stopped).toMatch(/^402 on /);
  });

  it('_WALL_IS_THE_PROOF_v1_: a priced door keeps its 402 with terms as the step, a bare 402 there still stops, and the wall never closes the route', async () => {
    const doorPaths = () => { const p = livePaths(); p.rows[0]!.steps = [{ id: 'listed', leaves: 'a priced door', read: 'GET /v1/x402/class/{name}' }, { id: 'shown', leaves: 'a page', read: 'GET /v1/catalog?kind={venue}' }]; return p; };
    const terms = { ok: false, code: 'payment_required', accepts: [{ scheme: 'exact', network: 'eip155:8453', maxAmountRequired: '1714' }] };
    const door = fakeFetch((u: URL) => (String(u).includes('/x402/class/') ? { status: 402, body: terms } : { status: 200, body: { ok: true } }));
    const r = await recordApiRung({ root, paths: doorPaths(), map: liveMap, market: 'm', op: 'list', rung: 'live', fetchImpl: door.fetchImpl, gapMs: 0 });
    expect(r.stopped).toBeNull(); expect(r.wrote).toHaveLength(2);
    const fx = JSON.parse(readFileSync(join(root, r.wrote[0]), 'utf8'));
    expect(fx.response.status).toBe(402); expect(fx.response.body.accepts).toHaveLength(1); expect(fx.path).toEqual({ op: 'list', step: 'listed' });
    const log = JSON.parse(readFileSync(join(root, 'test/io/live-log.json'), 'utf8'));
    expect(log.calls[0]).toMatchObject({ status: 402, wall: true }); expect(log.calls[0].refused).toBeUndefined();
    // the same door asked again is not closed by its own wall
    const again = await recordApiRung({ root, paths: doorPaths(), map: liveMap, market: 'm', op: 'list', rung: 'live', force: true, fetchImpl: door.fetchImpl, gapMs: 0 });
    expect(again.stopped).toBeNull();
    // the terms may sit under x402, as the door serves them
    expect(isWallAnswer(402, { code: 'payment_required', x402: { accepts: [{ scheme: 'exact' }] } })).toBe(true);
    expect(isWallAnswer(402, { reason: 'past_free_rate' })).toBe(false); expect(isWallAnswer(200, terms)).toBe(false);
    // a 402 with no terms is a refusal, at a door too
    const bare = fakeFetch(() => ({ status: 402, body: { ok: false, reason: 'past_free_rate' } }));
    const root2 = mkdtempSync(join(tmpdir(), 'io-wall-')); cpSync(root, root2, { recursive: true }); writeFileSync(join(root2, 'test/io/live-log.json'), JSON.stringify({ calls: [] }));
    const refused = await recordApiRung({ root: root2, paths: doorPaths(), map: liveMap, market: 'm', op: 'list', rung: 'live', force: true, fetchImpl: bare.fetchImpl, gapMs: 0 });
    expect(refused.stopped).toMatch(/^402 on /); expect(refused.wrote).toEqual([]);
  });

  it('refuses a rung it does not know', async () => {
    await expect(recordApiRung({ root, paths: livePaths(), map: liveMap, market: 'm', op: 'list', rung: 'fork', gapMs: 0 })).rejects.toThrow(/no rung fork/);
  });

  it('the mask drops an owner address and every address the mask file names, wherever it recurs', () => {
    const notes = { dropped: [] as string[], trimmed: [] as string[] };
    expect(mask({ owner: `0x${'c'.repeat(40)}`, rows: [{ owner: 'a name', n: 1 }] }, '', notes)).toEqual({ rows: [{ owner: 'a name', n: 1 }] });
    const file = join(root, 'own.txt'); const own = `0x${'d'.repeat(40)}`; writeFileSync(file, `${own}\n`);
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `import { mask } from ${JSON.stringify(join(REAL, 'scripts/io-mask.mjs'))}; const n = { dropped: [], trimmed: [] }; console.log(JSON.stringify(mask({ a: { wallet: ${JSON.stringify(own)} }, b: 1 }, '', n)));`],
      { encoding: 'utf8', env: { ...process.env, IO_MASK_FILE: file } });
    expect(JSON.parse(out)).toEqual({ a: {}, b: 1 });
  });
});

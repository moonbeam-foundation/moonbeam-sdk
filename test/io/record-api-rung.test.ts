// _ACCEPTANCE_TESTS_v1_: the api-rung recorder (scripts/record-api-rung.mjs), over an injected fetch only: no network, no key of ours.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error: a plain ES module
import { planWalk, recordApiRung, resolveRead, stageOf } from '../../scripts/record-api-rung.mjs';
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

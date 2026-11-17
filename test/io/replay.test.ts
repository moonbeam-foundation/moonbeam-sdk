// _COORD_IO_COVERAGE_v1_: every recorded coord I/O fixture (test/io/fixtures, mapped by test/io/op-map.json) fed back through
// the SDK function that makes or consumes that call, over a fake transport that answers only what the fixture recorded:
//   1. the SDK function behind the fixture exists (a fixture with none fails, naming the function: no silent skip);
//   2. the SDK sends exactly the recorded request: method, path, query and body;
//   3. the SDK makes of the recorded answer the result or light the fixture's stage expects (test/io/calls.mjs checks).
// Flows (one sign request: sign/status, pipe/send, the inbox, pipe/ack) replay their fixtures together, each request checked.
// Gap rows that name an SDK function: the function exists and asks the op's path. No request leaves the process.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as market from '../../src/market/index.js';
import * as playground from '../../src/playground/index.js';
import * as jobs from '../../src/jobs/index.js';
// @ts-expect-error: a plain ES module shared with the recorder
import { CALLS, sdkOf } from './calls.mjs';
// @ts-expect-error: a plain ES module shared with the generator
import { expandRows, fixturesOnDisk, pathRe } from '../../scripts/io-coverage-lib.mjs';

type Req = { method: string; path: string; query: Record<string, string>; body?: unknown };
type Fx = { op: string; market: string; stage: string; dir: string; sdk: string; source: string; request: Req; response: { status: number; body: unknown }; coord_sha: string; read_at: string; args?: Record<string, unknown> };
type Row = { market: string; stage: string; dir: string; op: string | null; call?: string; source?: string; flow?: string; fixture?: string; gap?: { reason: string; why: string }; sdk?: string };
type CallDef = { fn: string; key?: boolean; run: (s: unknown, t: unknown, x: unknown) => Promise<unknown>; args?: () => Record<string, unknown>; needs?: string;
  check?: (a: { result: unknown; error: unknown; x: unknown; expect: typeof expect; s: unknown }) => void };

const root = join(__dirname, '..', '..');
const map = JSON.parse(readFileSync(join(root, 'test/io/op-map.json'), 'utf8'));
const rows: Row[] = expandRows(map);
const fixtures: Map<string, Fx> = fixturesOnDisk(root);
const calls = CALLS as Record<string, CallDef>;
const s = sdkOf([market, playground, jobs]) as Record<string, unknown>;
const BASE = 'https://coord.example/v1';

/** a transport that answers only the fixtures given, and logs every request the SDK makes */
function replayTransport(fxs: Fx[], key: boolean) {
  const log: Req[] = [];
  const t = {
    base: BASE, ...(key ? { apiKey: 'io-replay-key' } : {}),
    fetch: async (url: string, init?: { method?: string; body?: string }) => {
      const u = new URL(url);
      const req: Req = { method: init?.method ?? 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), ...(init?.body ? { body: JSON.parse(init.body) } : {}) };
      log.push(req);
      const fx = fxs.find((f) => f.request.method === req.method && f.request.path === req.path && JSON.stringify(f.request.query ?? {}) === JSON.stringify(req.query));
      const status = fx ? fx.response.status : 599;
      const body = fx ? structuredClone(fx.response.body) : { ok: false, code: 'no_fixture', error: `no fixture answers ${req.method} ${req.path}` };
      return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) };
    },
  };
  return { t, log };
}

const fnOf = (def: CallDef) => def.fn.split('.')[1]!;
const fixtureRows = rows.filter((r) => r.call);

describe('_COORD_IO_COVERAGE_v1_ replay: every fixture through the SDK', () => {
  it('there are fixtures to replay, one per mapped row', () => {
    expect(fixtureRows.length).toBeGreaterThan(100);
    for (const r of fixtureRows) expect(fixtures.has(r.fixture!), `${r.fixture} is recorded`).toBe(true);
  });

  for (const r of fixtureRows) {
    it(`${r.market} · ${r.stage} · ${r.dir} · ${r.op} (${r.source})`, async () => {
      const def = calls[r.call!]!;
      expect(def, `test/io/calls.mjs has no call ${r.call}`).toBeTruthy();
      expect(typeof s[fnOf(def)], `SDK function ${def.fn} is missing: ${r.fixture} has no SDK function behind it`).toBe('function');
      const fx = fixtures.get(r.fixture!)!;
      const group = r.flow ? rows.filter((q) => q.flow === r.flow && q.market === r.market).map((q) => fixtures.get(q.fixture!)!).filter(Boolean) : [fx];
      const { t, log } = replayTransport(group, def.key === true);
      const x = { market: r.market, stage: r.stage, op: r.op, fx, ...(fx.args ? { args: fx.args } : {}) };
      let result: unknown = null, error: unknown = null;
      try { result = await def.run(s, t, x); } catch (e) { error = e; }
      // exactly the recorded request
      const name = r.op!.replace(/^(GET|POST)\s+/, '');
      const mine = log.filter((q) => q.method === r.op!.split(' ')[0] && pathRe(name).test(q.path));
      expect(mine, `the SDK asks ${r.op} once`).toHaveLength(1);
      expect(mine[0]).toEqual(fx.request);
      if (!r.flow) expect(log, 'and nothing else').toHaveLength(1);
      // the right result or light
      if (def.check) def.check({ result, error, x, expect, s });
      else if (error) throw error;
    });
  }
});

describe('_COORD_IO_COVERAGE_v1_ gap rows that name an SDK function', () => {
  const named = rows.filter((r) => r.gap && r.sdk);
  it('there are some', () => expect(named.length).toBeGreaterThan(0));
  for (const r of named) {
    it(`${r.sdk} asks ${r.op} (${r.gap!.reason})`, async () => {
      const def = Object.values(calls).find((d) => d.fn === r.sdk)!;
      expect(def, `test/io/calls.mjs names ${r.sdk}`).toBeTruthy();
      expect(typeof s[fnOf(def)], `SDK function ${r.sdk} is missing`).toBe('function');
      const log: Req[] = [];
      const t = { base: BASE, fetch: async (url: string, init?: { method?: string }) => {
        const u = new URL(url); log.push({ method: init?.method ?? 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams) });
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({}), text: async () => '{}' };
      } };
      const args = def.needs ? { id: `0x${'ab'.repeat(32)}` } : def.args?.();
      await def.run(s, t, { market: r.market, stage: r.stage, op: r.op, ...(args ? { args } : {}) }).catch(() => null);
      expect(log.map((q) => `${q.method} ${q.path}`)).toEqual([expect.stringMatching(new RegExp(`^${r.op!.split(' ')[0]} ${pathRe(r.op!.replace(/^(GET|POST)\s+/, '')).source.slice(1, -1)}$`))]);
    });
  }
});

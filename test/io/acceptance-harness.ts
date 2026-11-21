// _ACCEPTANCE_TESTS_v1_: what the generated tests (test/io/generated/<market>/<stage>.test.ts) call. Nothing about a fixture is
// typed here: each generated call names its fixture file, the fixture's hash and, for a schema or a machine, what the generator
// derived from it. A fixture that changed since the tests were generated fails here until `npm run gen:acceptance` runs again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import * as market from '../../src/market/index.js';
import * as playground from '../../src/playground/index.js';
import * as jobs from '../../src/jobs/index.js';
// @ts-expect-error: a plain ES module shared with the recorder
import { CALLS, sdkOf } from './calls.mjs';
// @ts-expect-error: a plain ES module shared with the generator
import { expandRows, pathRe } from '../../scripts/io-coverage-lib.mjs';
// @ts-expect-error: a plain ES module shared with the generator
import { conforms, sha12 } from '../../scripts/acceptance-lib.mjs';

type Req = { method: string; path: string; query: Record<string, string>; body?: unknown };
type Fx = { request: Req; response: { status: number; body: unknown }; args?: Record<string, unknown> };
type Row = { market: string; stage: string; op: string; call?: string; flow?: string; fixture?: string };
type Def = { fn: string; key?: boolean; run: (s: unknown, t: unknown, x: unknown) => Promise<unknown>;
  check?: (a: { result: unknown; error: unknown; x: unknown; expect: typeof expect; s: unknown }) => void };

const root = join(__dirname, '..', '..');
const text = (p: string) => readFileSync(join(root, p), 'utf8');
const rows: Row[] = expandRows(JSON.parse(text('test/io/op-map.json')));
const paths = JSON.parse(text('src/market/venue-paths.json')) as { rows: Array<{ market: string; op: string; steps: Array<{ id: string; read?: string | null }> }> };
const calls = CALLS as Record<string, Def>;
const s = sdkOf([market, playground, jobs]) as Record<string, unknown>;
const BASE = 'https://coord.example/v1';

/** the fixture, once its hash is the one the tests were generated from */
function pinned(file: string, sha: string): Fx {
  const t = text(file);
  expect(sha12(t), `${file} changed since the tests were generated: npm run gen:acceptance`).toBe(sha);
  return JSON.parse(t) as Fx;
}

/** a transport that answers only the recorded fixtures, and logs every request the SDK makes */
function transport(fxs: Fx[], key: boolean) {
  const log: Req[] = [];
  const t = {
    base: BASE, ...(key ? { apiKey: 'io-replay-key' } : {}),
    fetch: async (url: string, init?: { method?: string; body?: string }) => {
      const u = new URL(url);
      const req: Req = { method: init?.method ?? 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), ...(init?.body ? { body: JSON.parse(init.body) } : {}) };
      log.push(req);
      const fx = fxs.find((f) => f.request.method === req.method && f.request.path === req.path && JSON.stringify(f.request.query ?? {}) === JSON.stringify(req.query));
      const status = fx ? fx.response.status : 599;
      const body = fx ? structuredClone(fx.response.body) : { ok: false, code: 'no_fixture' };
      return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) };
    },
  };
  return { t, log };
}

/** the recorded request, through the SDK call the op-map pairs with it, over a fetch that returns the recorded answer */
export async function replayFixture(file: string, sha: string): Promise<void> {
  const fx = pinned(file, sha);
  const r = rows.find((q) => q.fixture === file);
  expect(r?.call, `${file} has no SDK call in the op-map`).toBeTruthy();
  const def = calls[r!.call!];
  expect(def, `test/io/calls.mjs has no call ${r!.call}`).toBeTruthy();
  const group = r!.flow ? rows.filter((q) => q.flow === r!.flow && q.market === r!.market).map((q) => JSON.parse(text(q.fixture!)) as Fx) : [fx];
  const { t, log } = transport(group, def!.key === true);
  const x = { market: r!.market, stage: r!.stage, op: r!.op, fx, ...(fx.args ? { args: fx.args } : {}) };
  let result: unknown = null, error: unknown = null;
  try { result = await def!.run(s, t, x); } catch (e) { error = e; }
  const name = r!.op.replace(/^(GET|POST)\s+/, '');
  const mine = log.filter((q) => q.method === r!.op.split(' ')[0] && pathRe(name).test(q.path));
  expect(mine, `the SDK asks ${r!.op} once`).toHaveLength(1);
  expect(mine[0]).toEqual(fx.request);
  if (def!.check) def!.check({ result, error, x, expect, s });
  else if (error) throw error;
}

/**
 * _MAINNET_IO_v1_: one recorded read of a mainnet run. Its run file is beside the path's feature and names this run; the step is one
 * the run covers; the request is that step's read with the run's own ids (and the market's id as {venue}), every other name given by
 * hand at the recording. Where the fixture names an SDK call, that call over the recorded answer asks exactly the recorded request.
 */
export async function replayStep(file: string, sha: string, expected: { run: string; path: { op: string; step: string } }): Promise<void> {
  const fx = pinned(file, sha) as Fx & { market: string; stage: string; op: string; rung: string; run: string; path: { op: string; step: string }; sdk?: string };
  expect([fx.rung, fx.run, fx.path]).toEqual(['live', expected.run, expected.path]);
  expect(fx.response.status, 'a mainnet read is kept only when it answered').toBe(200);
  const row = paths.rows.find((r) => r.market === fx.market && r.op === fx.path.op) as undefined | { features?: Array<{ live?: { fixture: string; steps: string[]; ids: Record<string, string>; run: { ref: string } } | null }>; steps: Array<{ id: string; read?: string | null }> };
  const live = row?.features?.map((f) => f.live).find((l) => l && l.run.ref === fx.run && l.steps.includes(fx.path.step));
  expect(live, `no mainnet run ${fx.run} of ${fx.market} ${fx.path.op} covers ${fx.path.step}`).toBeTruthy();
  const run = JSON.parse(text(live!.fixture)) as { run: { ref: string; rung: string }; covers: string[]; ids: Record<string, string> };
  expect([run.run.rung, run.run.ref]).toEqual(['live', fx.run]);
  expect(run.covers).toContain(fx.path.step);
  // the request is the step's read: the same route, and each {name} the run's own id (a name the run does not hold was given by hand)
  const read = row!.steps.find((st) => st.id === fx.path.step)!.read!;
  const ids: Record<string, string> = { venue: fx.market, ...run.ids };
  const [route, qs = ''] = read.replace(/^GET /, '').split('?');
  const fill = (t: string, enc: boolean) => t.replace(/\{([A-Za-z_]+)\}/g, (m0, n: string) => (ids[n] === undefined ? m0 : enc ? encodeURIComponent(ids[n]!) : ids[n]!));
  const hole = /\{[A-Za-z_]+\}/;
  expect(fx.request.method).toBe('GET');
  expect(fx.request.path).toMatch(new RegExp(`^${fill(route!, true).split(hole).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+')}$`));
  for (const kv of qs.split('&').filter(Boolean)) {
    const [k, v = ''] = kv.split('=');
    if (hole.test(fill(v, false))) expect(fx.request.query[k!], `${k} was given at the recording`).toBeTruthy();
    else expect(fx.request.query[k!]).toBe(fill(v, false));
  }
  if (!fx.sdk) return;
  const def = Object.values(calls).find((d) => d.fn === fx.sdk && !d.key);
  expect(def, `test/io/calls.mjs has no call for ${fx.sdk}`).toBeTruthy();
  const { t, log } = transport([fx], false);
  const x = { market: fx.market, stage: fx.stage, op: fx.op, fx, ...(fx.args ? { args: fx.args } : {}) };
  let result: unknown = null, error: unknown = null;
  try { result = await def!.run(s, t, x); } catch (e) { error = e; }
  expect(log, `${fx.sdk} asks once`).toHaveLength(1);
  expect(log[0]).toEqual(fx.request);
  if (def!.check) def!.check({ result, error, x, expect, s });
  else if (error) throw error;
}

/** the recorded answer keeps the status, keys and value types the fixture showed when the tests were generated */
export function schemaFixture(file: string, sha: string, schema: { status: number; body: unknown }): void {
  const fx = pinned(file, sha);
  expect(fx.response.status).toBe(schema.status);
  expect(conforms(schema.body, fx.response.body)).toEqual([]);
}

/** a run file: its steps are those of the path in src/market/venue-paths.json, in order, each read a GET /v1 route the path names */
export function machineRun(file: string, sha: string, expected: { op: string; steps: Array<{ id: string; read: string | null }> }): void {
  const run = JSON.parse((pinned(file, sha), text(file))) as { market: string; op: string; stage: string; steps: Array<{ id: string; read: string | null }> };
  const [, , , mkt, stage] = file.split('/');
  expect([run.market, run.stage, run.op]).toEqual([mkt, stage, expected.op]);
  const row = paths.rows.find((r) => r.market === run.market && r.op === run.op);
  expect(row, `no path ${run.market} ${run.op} in src/market/venue-paths.json`).toBeTruthy();
  expect(run.steps.map((st) => st.id), 'the steps, in the order of the path').toEqual(row!.steps.map((st) => st.id));
  expect(run.steps.map((st) => st.id)).toEqual(expected.steps.map((st) => st.id));
  for (const [i, st] of run.steps.entries()) {
    expect(st.read, `step ${st.id} names a GET /v1 read`).toMatch(/^GET \/v1\/\S+$/);
    expect(st.read, `step ${st.id} reads what the path says`).toBe(row!.steps[i]!.read);
    expect(st.read).toBe(expected.steps[i]!.read);
  }
}

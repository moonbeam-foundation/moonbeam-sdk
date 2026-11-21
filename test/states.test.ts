// _STATE_TABLE_v1_: the state table is the vendored machine's, read by one typed call per state. Nothing is typed here: counts, ids and
// reads come from scripts/coord-lang/commerce-machine.public.json; a recorded answer comes from test/io/fixtures, or the mechanics are
// shown over an answer that carries no data.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOVES, STATES, readState, stateOf, statePath } from '../src/market/index.js';
import type { OnboardTransport } from '../src/onboard/index.js';
// @ts-expect-error: a plain ES module shared with the generator
import { buildStates, readOf } from '../scripts/states-lib.mjs';

const root = join(__dirname, '..');
const machine = JSON.parse(readFileSync(join(root, 'scripts/coord-lang/commerce-machine.public.json'), 'utf8')) as { states: unknown[]; moves: unknown[] };

type Fx = { request: { method: string; path: string; query?: Record<string, string> }; response: { status: number; body: unknown } };
const fixtures = (): Array<{ file: string; fx: Fx }> => {
  const out: Array<{ file: string; fx: Fx }> = [];
  const walk = (d: string) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.startsWith('read-') && f.endsWith('.json')) out.push({ file: p, fx: JSON.parse(readFileSync(p, 'utf8')) }); } };
  walk(join(root, 'test/io/fixtures'));
  return out;
};
const reRead = (path: string) => new RegExp(`^${path.replace(/:[A-Za-z_]+/g, '[^/]+')}$`);
/** a recorded call that answers this state's route (same method, a path its template fits) */
const recorded = (s: { read: { method: string; path: string } }) => fixtures().find(({ fx }) => fx.request.method === s.read.method && reRead(s.read.path).test(fx.request.path) && fx.response.status === 200);

const transport = (answer: (path: string) => [number, unknown]) => {
  const seen: Array<{ url: string; method: string }> = [];
  const t: OnboardTransport = { base: 'https://coord.example/v1', fetch: async (url, init) => {
    seen.push({ url, method: init?.method ?? 'GET' });
    const [status, body] = answer(new URL(url).pathname);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  } };
  return { t, seen };
};

describe('states: the table is the machine\'s', () => {
  it('has one state per machine state and one move per machine move', () => {
    expect(STATES.length).toBe(machine.states.length);
    expect(MOVES.length).toBe(machine.moves.length);
    expect(new Set(STATES.map((s) => s.id)).size).toBe(STATES.length);
    expect(STATES).toEqual(buildStates(machine).states);
  });
  it('every state reads with one GET /v1 route', () => {
    for (const s of STATES) { expect(s.read.method).toBe('GET'); expect(s.read.path).toMatch(/^\/v1\//); }
  });
  it('every move joins two states of the table', () => {
    for (const m of MOVES) { expect(() => stateOf(m.from)).not.toThrow(); expect(() => stateOf(m.to)).not.toThrow(); }
  });
  it('the published table carries no text but id, step, kind, led, label, read', () => {
    for (const s of STATES) expect(Object.keys(s).sort()).toEqual(['id', 'kind', 'label', 'led', 'read', 'step']);
    for (const m of MOVES) expect(Object.keys(m).sort()).toEqual(['from', 'to']);
  });
  it('a read that is not a GET /v1 route is refused at generation', () => {
    expect(() => readOf('POST /v1/agent-listings')).toThrow();
    expect(() => readOf(undefined)).toThrow();
  });
});

describe('readState', () => {
  it('fills the placeholders and GETs the state\'s route', async () => {
    const s = STATES.find((x) => x.read.path.includes(':'))!;
    const params = Object.fromEntries([...s.read.path.matchAll(/:([A-Za-z_]+)/g)].map((m) => [m[1]!, `v/${m[1]}`]));
    const { t, seen } = transport(() => [200, { ok: true }]);
    const r = await readState(t, s.id, params);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe('GET');
    expect(seen[0]!.url).toBe(`https://coord.example${statePath(s, params)}`);
    expect(new URL(seen[0]!.url).pathname).not.toContain(':');
    expect(seen[0]!.url).toContain('v%2F');
    expect(r).toEqual({ state: s, status: 200, body: { ok: true } });
  });
  it('a state without placeholders needs no params', async () => {
    const s = STATES.find((x) => !x.read.path.includes(':'))!;
    const { t, seen } = transport(() => [200, { ok: true }]);
    await readState(t, s.id);
    expect(seen[0]!.url).toBe(`https://coord.example${s.read.path}`);
  });
  it('answers a refusal as its status and body', async () => {
    const s = STATES.find((x) => !x.read.path.includes(':'))!;
    const { t } = transport(() => [404, { ok: false, code: 'not_found', error: 'no' }]);
    const r = await readState(t, s.id);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ ok: false, code: 'not_found', error: 'no' });
  });
  it('throws for a missing placeholder param, without calling', async () => {
    const s = STATES.find((x) => x.read.path.includes(':'))!;
    const { t, seen } = transport(() => [200, {}]);
    await expect(readState(t, s.id, {})).rejects.toThrow(/missing param/);
    expect(seen).toHaveLength(0);
  });
  it('throws for an unknown id', async () => {
    const { t } = transport(() => [200, {}]);
    await expect(readState(t, 'no_such_state')).rejects.toThrow(/unknown state/);
    expect(() => stateOf('no_such_state')).toThrow(/unknown state/);
  });
  it('over a recorded answer: each state whose route has a fixture returns the recorded body', async () => {
    for (const s of STATES) {
      const hit = recorded(s);
      if (!hit) continue;
      const params: Record<string, string> = {};
      const names = [...s.read.path.matchAll(/:([A-Za-z_]+)/g)].map((m) => m[1]!);
      const tpl = s.read.path.split('/'), real = hit.fx.request.path.split('/');
      tpl.forEach((seg, i) => { if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(real[i]!); });
      expect(Object.keys(params).sort()).toEqual([...names].sort());
      const { t } = transport((p) => (p === hit.fx.request.path ? [hit.fx.response.status, structuredClone(hit.fx.response.body)] : [599, { ok: false }]));
      expect(await readState(t, s.id, params)).toEqual({ state: s, status: hit.fx.response.status, body: hit.fx.response.body });
    }
  });
});

describe('gen-states', () => {
  it('--check passes on the committed table and fails on a tampered one', () => {
    const run = (cwd: string) => { try { execFileSync('node', ['scripts/gen-states.mjs', '--check'], { cwd, stdio: 'pipe' }); return 0; } catch (e) { return (e as { status: number }).status; } };
    expect(run(root)).toBe(0);
    const tmp = mkdtempSync(join(tmpdir(), 'states-'));
    mkdirSync(join(tmp, 'scripts'), { recursive: true }); mkdirSync(join(tmp, 'src/market'), { recursive: true });
    cpSync(join(root, 'scripts/gen-states.mjs'), join(tmp, 'scripts/gen-states.mjs'));
    cpSync(join(root, 'scripts/states-lib.mjs'), join(tmp, 'scripts/states-lib.mjs'));
    cpSync(join(root, 'scripts/coord-lang'), join(tmp, 'scripts/coord-lang'), { recursive: true });
    for (const f of ['states.json', 'states-data.ts']) cpSync(join(root, 'src/market', f), join(tmp, 'src/market', f));
    expect(run(tmp)).toBe(0);
    const p = join(tmp, 'src/market/states.json');
    writeFileSync(p, readFileSync(p, 'utf8').replace('"read"', '"reads"'));
    expect(run(tmp)).toBe(1);
  });
});

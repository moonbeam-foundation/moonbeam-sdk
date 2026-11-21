// _VENUE_PATHS_v1_: coord's venue paths for Moonbeam's kept markets (src/market/venue-paths.json), the run file of each feature a run
// covers (test/io/fixtures/<market>/<stage>/run-<rung>-<op>.json) and the tested cells of VENUES that stand on them.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import register from '../../src/market/venues-register.json';
// @ts-expect-error: a plain ES module shared with the generator
import { isRunFile, isRungFile, mainnetProofs, moonbeamPaths, renderMainnet, renderPaths, runFiles, runPath } from '../../scripts/paths-lib.mjs';
// @ts-expect-error: a plain ES module shared with the generator
import { fixturesOnDisk } from '../../scripts/io-coverage-lib.mjs';

const root = join(__dirname, '..', '..');
const paths = JSON.parse(readFileSync(join(root, 'src/market/venue-paths.json'), 'utf8'));
const SHA = 'a'.repeat(40);
const row = (market: string, op: string, cohorts: string[], features: unknown[] = []) => ({ market, op, cohorts, steps: [{ id: 's', leaves: 'x', read: 'GET /v1/x' }], rungs: {}, features, tx: {} });
const pub = (rows: unknown[]) => ({ rule: 'VENUE_PATHS_v1', kept: { moonbeam: ['b', 'a'] }, order: ['a', 'c', 'b'], rows, gaps: [{ market: 'c', op: 'buy', step: 's', why: 'w' }] });

describe('_VENUE_PATHS_v1_ Moonbeam paths from coord', () => {
  it('keeps only Moonbeam markets, in coord order, and its rows', () => {
    const p = moonbeamPaths(pub([row('b', 'sell', ['moonbeam']), row('c', 'list', ['operator']), row('a', 'list', ['operator', 'moonbeam']), row('a', 'buy', ['operator'])]), SHA);
    expect(p.markets).toEqual(['a', 'b']);
    expect(p.rows.map((r: { market: string; op: string }) => `${r.market}.${r.op}`)).toEqual(['a.list', 'b.sell']);
    expect(p.gaps).toEqual([]);
    expect(p.coord.sha).toBe(SHA);
  });

  it('keeps a step\'s stream row without how it is signed', () => {
    const r = { ...row('a', 'list', ['moonbeam']), steps: [{ id: 's', leaves: 'x', stream: { row: 'r', signer: 'operator-only' } }] };
    const p = moonbeamPaths(pub([r]), SHA);
    expect(p.rows[0].steps[0].stream).toEqual({ row: 'r' });
    expect(JSON.stringify(p)).not.toContain('operator-only');
  });

  it('refuses a file that is not coord venue paths, or no sha', () => {
    expect(() => moonbeamPaths({ rows: [] }, SHA)).toThrow(/VENUE_PATHS_v1/);
    expect(() => moonbeamPaths(pub([]), 'main')).toThrow(/sha/);
  });

  it('one run file per fixture, at the SDK path, with its run', () => {
    const f = (feature: string, stage: string) => ({ feature, stage, fixture: runPath('a', stage, 'fork', 'sell'), run: { rung: 'fork', on: '2026-11-19', ref: 'fork:a/sell@2026-11-19#1:x' } });
    const files = runFiles(moonbeamPaths(pub([row('a', 'sell', ['moonbeam'], [f('jobs_received', 'bought'), f('deliver', 'delivered')])]), SHA));
    expect([...files.keys()]).toEqual(['test/io/fixtures/a/bought/run-fork-sell.json', 'test/io/fixtures/a/delivered/run-fork-sell.json']);
    expect(files.get('test/io/fixtures/a/bought/run-fork-sell.json')).toMatchObject({ market: 'a', op: 'sell', stage: 'bought', features: ['jobs_received'], coord_sha: SHA });
  });

  it('refuses a fixture coord names elsewhere, or one without its run', () => {
    const bad = { feature: 'deliver', stage: 'delivered', fixture: 'test/io/fixtures/a/paid/run-fork-sell.json', run: { rung: 'fork', on: 'd', ref: 'r' } };
    expect(() => runFiles(moonbeamPaths(pub([row('a', 'sell', ['moonbeam'], [bad])]), SHA))).toThrow(/keeps this run at/);
    expect(() => runFiles(moonbeamPaths(pub([row('a', 'sell', ['moonbeam'], [{ ...bad, run: null }])]), SHA))).toThrow(/without its run/);
  });

  it('the snapshot is Moonbeam\'s: its kept markets only, no address', () => {
    expect(paths.rule).toMatch(/^_VENUE_PATHS_v1_/);
    expect(paths.markets.length).toBeGreaterThan(0);
    for (const r of paths.rows) { expect(paths.markets).toContain(r.market); expect(r.cohorts).toContain('moonbeam'); }
    expect(JSON.stringify(paths)).not.toMatch(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/);
    for (const r of paths.rows) for (const st of r.steps ?? []) { expect(st.stream?.signer).toBeUndefined(); expect(st.sign?.key).toBeUndefined(); }
  });

  it('keeps which purpose signs a step without the key behind it', () => {
    const r = { ...row('a', 'list', ['moonbeam']), steps: [{ id: 's', leaves: 'x', sign: { purpose: 'p.q', mode: 'armed', key: 'a-key-name' } }] };
    const p = moonbeamPaths(pub([r]), SHA);
    expect(p.rows[0].steps[0].sign).toEqual({ purpose: 'p.q', mode: 'armed' });
    expect(JSON.stringify(p)).not.toContain('a-key-name');
  });

  it('every run file of the snapshot is on disk as generated, and is not counted as a recorded call', () => {
    const files = runFiles(paths);
    const calls = fixturesOnDisk(root);
    for (const [p, o] of files) {
      expect(existsSync(join(root, p)), p).toBe(true);
      expect(JSON.parse(readFileSync(join(root, p), 'utf8'))).toEqual(o);
      expect(isRunFile(p.split('/').pop())).toBe(true);
      expect(calls.has(p), `${p} is a run, not a recorded call`).toBe(false);
    }
  });

  it('every tested cell of VENUES names a run file that covers its feature', () => {
    type Cell = { mark: string; fixture?: string };
    const files = runFiles(paths);
    for (const m of register.markets as Array<{ id: string; cohorts?: Record<string, { features?: Record<string, Cell> } | unknown> }>) {
      for (const c of Object.values(m.cohorts ?? {}) as Array<{ features?: Record<string, Cell> }>) {
        for (const [feature, cell] of Object.entries(c?.features ?? {})) {
          if (cell.mark !== 'tested') continue;
          const run = files.get(cell.fixture!);
          expect(run, `${m.id}.${feature} is tested on ${cell.fixture}, which no run of the paths names`).toBeTruthy();
          expect(run.market).toBe(m.id);
          expect(run.features).toContain(feature);
        }
      }
    }
  });

  it('docs/PATHS.md is rendered from the snapshot', () => {
    const doc = readFileSync(join(root, 'docs/PATHS.md'), 'utf8');
    expect(doc).toContain(paths.coord.sha.slice(0, 9));
    expect(renderPaths(paths).split('\n').filter((l: string) => l.startsWith('| ') && !l.startsWith('| Path')).length)
      .toBe(paths.rows.length);
  });
});

// _MAINNET_IO_v1_ (owner 2026-11-21): a public live stands on a mainnet run kept here with the recorded read of every step it covers
describe('_MAINNET_IO_v1_ mainnet runs and their recorded reads', () => {
  const REF = 'live:a/list@2026-11-06';
  const live = (o: Record<string, unknown> = {}) => ({ fixture: runPath('a', 'listed', 'live', 'list'), run: { rung: 'live', on: '2026-11-06', ref: REF }, steps: ['s'], ids: { operator: { name: 'theirs' }, moonbeam: { name: 'ours' } }, needs: { operator: [], moonbeam: ['tx'] }, ...o });
  const feature = (l: unknown, fork = false) => ({ feature: 'list', stage: 'listed', fixture: fork ? runPath('a', 'listed', 'fork', 'list') : null, run: fork ? { rung: 'fork', on: '2026-11-07', ref: 'fork:a/list@2026-11-07#1:x' } : null, live: l });
  const read = (o: Record<string, unknown> = {}) => ({ market: 'a', rung: 'live', run: REF, path: { op: 'list', step: 's' }, response: { status: 200, body: {} }, ...o });
  const FILE = 'test/io/fixtures/a/listed/read-x.live-list-s.json';

  it('a mainnet run carries Moonbeam\'s own ids only, and is written beside the run coord made itself', () => {
    const p = moonbeamPaths(pub([row('a', 'list', ['operator', 'moonbeam'], [feature(live(), true)])]), SHA);
    expect(p.rows[0].features[0].live).toMatchObject({ ids: { name: 'ours' }, needs: ['tx'] });
    expect(JSON.stringify(p)).not.toContain('theirs');
    const files = runFiles(p);
    expect([...files.keys()]).toEqual(['test/io/fixtures/a/listed/run-fork-list.json', 'test/io/fixtures/a/listed/run-live-list.json']);
    expect(files.get('test/io/fixtures/a/listed/run-live-list.json')).toMatchObject({ market: 'a', op: 'list', stage: 'listed', features: ['list'], run: { rung: 'live', ref: REF }, covers: ['s'], ids: { name: 'ours' }, needs: ['tx'], coord_sha: SHA });
    expect(files.get('test/io/fixtures/a/listed/run-fork-list.json').covers).toBeUndefined();
  });

  it('refuses a mainnet run on another rung, at another path, or covering a step the path does not have', () => {
    const files = (l: unknown) => () => runFiles(moonbeamPaths(pub([row('a', 'list', ['moonbeam'], [feature(l)])]), SHA));
    expect(files(live({ run: { rung: 'fork', on: 'd', ref: 'r' } }))).toThrow(/not live/);
    expect(files(live({ fixture: runPath('a', 'paid', 'live', 'list') }))).toThrow(/keeps this run at/);
    expect(files(live({ steps: ['nope'] }))).toThrow(/no step of the path/);
  });

  it('a step is kept only by a read of that very run that answered 200; proven needs every covered step', () => {
    const p = moonbeamPaths(pub([row('a', 'list', ['moonbeam'], [feature(live())])]), SHA);
    const of = (m: Map<string, unknown>) => mainnetProofs(p, m).a.list;
    expect(of(new Map([[FILE, read()]]))).toEqual({ op: 'list', ref: REF, on: '2026-11-06', run: runPath('a', 'listed', 'live', 'list'), steps: { s: FILE }, proven: true });
    expect(of(new Map())).toMatchObject({ steps: { s: null }, proven: false });
    for (const bad of [read({ run: 'live:a/list@2026-01-01' }), read({ rung: 'api' }), read({ market: 'b' }), read({ path: { op: 'list', step: 't' } }), read({ path: { op: 'sell', step: 's' } }), read({ response: { status: 402, body: {} } })])
      expect(of(new Map([[FILE, bad]])), JSON.stringify(bad)).toMatchObject({ steps: { s: null }, proven: false });
    // a feature with no mainnet run has no entry at all
    expect(mainnetProofs(moonbeamPaths(pub([row('a', 'list', ['moonbeam'], [feature(null, true)])]), SHA), new Map([[FILE, read()]]))).toEqual({});
  });

  it('src/market/venue-mainnet-data.ts is what the snapshot and the recorded reads on disk produce', () => {
    const recorded = new Map<string, unknown>();
    const walk = (d: string) => { for (const f of readdirSync(d).sort()) { const q = join(d, f); if (statSync(q).isDirectory()) walk(q); else if (isRungFile(f)) recorded.set(q.slice(root.length + 1), JSON.parse(readFileSync(q, 'utf8'))); } };
    walk(join(root, 'test/io/fixtures'));
    expect(readFileSync(join(root, 'src/market/venue-mainnet-data.ts'), 'utf8')).toBe(renderMainnet(mainnetProofs(paths, recorded)));
    // a recorded read is no cell of the coverage matrix, and holds no address of a wallet behind it
    const calls = fixturesOnDisk(root);
    for (const [p, fx] of recorded as Map<string, { response: { body: Record<string, unknown> } }>) { expect(calls.has(p), p).toBe(false); expect(Object.keys(fx.response.body), p).not.toContain('owner'); }
  });

  it('every mainnet run of the snapshot names steps of its path, and ids for every name it does not list as needed', () => {
    let n = 0;
    for (const r of paths.rows) for (const f of r.features ?? []) {
      if (!f.live) continue; n += 1;
      const covered = r.steps.filter((st: { id: string }) => f.live.steps.includes(st.id));
      expect(covered.length, `${r.market}.${r.op}.${f.feature}`).toBe(f.live.steps.length);
      const names = [...new Set(covered.flatMap((st: { read: string }) => [...st.read.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1])))].filter((x) => x !== 'venue');
      expect([...Object.keys(f.live.ids), ...f.live.needs].sort(), `${r.market}.${r.op}.${f.feature}`).toEqual(names.sort());
      expect(JSON.stringify(f.live.ids)).not.toMatch(/0x[0-9a-fA-F]{40}/);
    }
    expect(n).toBeGreaterThan(0);
  });
});

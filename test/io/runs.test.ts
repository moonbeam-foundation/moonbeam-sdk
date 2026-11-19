// _VENUE_PATHS_v1_: coord's venue paths for Moonbeam's kept markets (src/market/venue-paths.json), the run file of each feature a run
// covers (test/io/fixtures/<market>/<stage>/run-<rung>-<op>.json) and the tested cells of VENUES that stand on them.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import register from '../../src/market/venues-register.json';
// @ts-expect-error: a plain ES module shared with the generator
import { isRunFile, moonbeamPaths, renderPaths, runFiles, runPath } from '../../scripts/paths-lib.mjs';
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

// _ACCEPTANCE_TESTS_v1_: the generated I/O tests (test/io/generated) are exactly what the fixtures produce, and the pure parts that
// make them hold: the schema derived from a fixture, the skip list, the rendered file. Regenerate with `npm run gen:acceptance`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain ES module shared with the generator
import { conforms, drift, fixtureFiles, generatedOnDisk, infer, merge, plan, renderFiles, schemaOf, testCount } from '../../scripts/acceptance-lib.mjs';

const root = join(__dirname, '..', '..');
const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const map = read('test/io/op-map.json');
const paths = read('src/market/venue-paths.json');

describe('_ACCEPTANCE_TESTS_v1_ the generated tests are the fixtures\'', () => {
  it('test/io/generated is exactly what the fixtures produce (npm run gen:acceptance)', () => {
    const { items } = plan(fixtureFiles(root), map, paths);
    expect(drift(renderFiles(items), generatedOnDisk(root))).toEqual([]);
  });

  it('every generated file says it is generated, names its source, and every fixture is a test or a listed gap', () => {
    const files = fixtureFiles(root);
    const { items, skipped } = plan(files, map, paths);
    expect(items.length + skipped.length).toBe(files.size);
    expect(items.length).toBeGreaterThan(0);
    for (const [p, t] of generatedOnDisk(root)) {
      expect(t, p).toMatch(/^\/\/ generated: do not edit\./);
      expect(t, p).toContain('test/io/fixtures/');
    }
    for (const sk of skipped) expect(sk.why, sk.file).toMatch(/no row in op-map|names no SDK call|no path/);
  });

  it('a run file becomes a machine test, a recorded call a replay and a schema test', () => {
    const { items } = plan(fixtureFiles(root), map, paths);
    const runs = items.filter((i: { kind: string }) => i.kind === 'run');
    expect(runs.length).toBe(fixtureFiles(root).size - [...fixtureFiles(root).keys()].filter((p) => !/\/run-[a-z]+-[a-z]+\.json$/.test(p)).length);
    expect(testCount(items)).toBe(items.length + items.filter((i: { kind: string }) => i.kind === 'call').length);
  });
});

describe('_ACCEPTANCE_TESTS_v1_ schema derived from a fixture', () => {
  const fx = { response: { status: 200, body: { ok: true, n: 1, rows: [{ a: 'x', b: null }, { a: 'y' }], meta: {} } } };
  it('holds the keys and types the fixture shows', () => {
    const sch = schemaOf(fx);
    expect(conforms(sch.body, fx.response.body)).toEqual([]);
    expect(sch.status).toBe(200);
  });
  it('an element key missing from some elements is optional; a null beside a string is both', () => {
    const rows = infer(fx.response.body).keys.rows.of;
    expect(rows.optional).toEqual(['b']);
    expect(rows.keys.b.types).toEqual(['null']);
    expect(merge(infer('x'), infer(null)).types).toEqual(['null', 'string']);
  });
  it('names a missing key, an extra key and a value of another type', () => {
    const sch = schemaOf(fx).body;
    expect(conforms(sch, { ok: true, rows: [], meta: {} })).toEqual(['$.n: missing']);
    expect(conforms(sch, { ...fx.response.body, extra: 1 })).toEqual(['$.extra: a key the fixture does not show']);
    expect(conforms(sch, { ...fx.response.body, n: '1' })).toEqual(['$.n: string, the fixture shows number']);
    expect(conforms(sch, { ...fx.response.body, rows: [{ a: 3 }] })).toEqual(['$.rows[0].a: number, the fixture shows string']);
  });
});

describe('_ACCEPTANCE_TESTS_v1_ plan and render', () => {
  const m = { markets: ['m'], stages: ['listed'], dirs: ['read'], groups: {}, rows: [{ op: 'GET x/:id', markets: ['m'], stage: 'listed', dir: 'read', call: 'c', source: 'live' }, { op: 'GET y', markets: ['m'], stage: 'listed', dir: 'read', sdk: 'f', gap: { reason: 'needs_key', why: 'w' } }] };
  const p = { rows: [{ market: 'm', op: 'sell', steps: [{ id: 'a', read: 'GET /v1/a' }, { id: 'b', read: 'GET /v1/b' }] }] };
  const call = JSON.stringify({ response: { status: 200, body: { ok: true } } });
  const run = JSON.stringify({ market: 'm', op: 'sell', stage: 'listed' });
  const files = new Map([['test/io/fixtures/m/listed/read-x-id.json', call], ['test/io/fixtures/m/listed/read-z.json', call], ['test/io/fixtures/m/listed/run-fork-sell.json', run], ['test/io/fixtures/m/listed/run-fork-buy.json', run.replace('sell', 'buy')]]);
  it('a fixture with no SDK call in the op-map, or no path, is skipped with why', () => {
    const { items, skipped } = plan(files, m, p);
    expect(items.map((i: { file: string }) => i.file)).toEqual(['test/io/fixtures/m/listed/read-x-id.json', 'test/io/fixtures/m/listed/run-fork-sell.json']);
    expect(skipped.map((s: { file: string; why: string }) => `${s.file.split('/').pop()}: ${s.why}`)).toEqual([
      'read-z.json: no row in op-map.json, so no SDK call', 'run-fork-buy.json: no path m buy in venue-paths.json']);
  });
  it('renders one file per market and stage, with replay, schema and machine tests, and flags drift', () => {
    const out = renderFiles(plan(files, m, p).items);
    expect([...out.keys()]).toEqual(['test/io/generated/m/listed.test.ts']);
    const t = out.get('test/io/generated/m/listed.test.ts')!;
    expect(t).toContain('// generated: do not edit.');
    expect(t).toMatch(/replayFixture\("test\/io\/fixtures\/m\/listed\/read-x-id.json"/);
    expect(t).toMatch(/schemaFixture\(/);
    expect(t).toMatch(/machineRun\("test\/io\/fixtures\/m\/listed\/run-fork-sell.json".*"a".*"b"/);
    expect(drift(out, new Map(out))).toEqual([]);
    expect(drift(out, new Map([['test/io/generated/m/listed.test.ts', 'x'], ['test/io/generated/m/old.test.ts', '']]))).toEqual([
      { file: 'test/io/generated/m/listed.test.ts', why: 'differs' }, { file: 'test/io/generated/m/old.test.ts', why: 'stale' }]);
  });
});

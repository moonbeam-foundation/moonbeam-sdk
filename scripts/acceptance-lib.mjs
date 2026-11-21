// _ACCEPTANCE_TESTS_v1_: the pure parts of the generated I/O tests, shared by scripts/gen-acceptance-tests.mjs (write and check)
// and test/io/acceptance.test.ts (the pin). Every fixture under test/io/fixtures/<market>/<stage>/ becomes tests, never by hand:
//   a recorded coord call  -> a replay test (the SDK call test/io/op-map.json pairs with it, over a fetch that answers the recorded
//                             response) and a schema test (the keys and value types the fixture shows, derived from the fixture);
//   a run file (run-<rung>-<op>.json) -> a machine test (its steps are the path's, in order, each read a GET /v1 route);
//   a mainnet run's recorded read (read-<route>.live-<op>-<step>.json, _MAINNET_IO_v1_) -> a replay test (its request is the step's read
//                             filled with the run's own ids; through the SDK call it names, the recorded answer comes back) and a schema test.
// A recorded call whose op has no SDK call in the op-map is a gap: it is listed, not tested. Nothing here is typed by hand: the
// markets, stages, ops and routes are read from the fixtures' folders, the op-map and src/market/venue-paths.json.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isRunFile, isRungFile } from './paths-lib.mjs';
import { expandRows } from './io-coverage-lib.mjs';

export const RULE = '_ACCEPTANCE_TESTS_v1_';
export const FIXTURES = 'test/io/fixtures';
export const OUT = 'test/io/generated';
export const sha12 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);

// ── schema, derived from a fixture ────────────────────────────────────────────────────────────────────────────────────
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** the schema node of one value: its type, and for an object its keys, for an array its element node (null when empty) */
export function infer(v) {
  const t = typeOf(v);
  if (t === 'object') return { types: ['object'], keys: Object.fromEntries(Object.keys(v).sort().map((k) => [k, infer(v[k])])), optional: [] };
  if (t === 'array') return { types: ['array'], of: v.reduce((acc, x) => (acc ? merge(acc, infer(x)) : infer(x)), null) };
  return { types: [t] };
}

/** two nodes seen for the same place: the union of their types; a key missing from one side becomes optional */
export function merge(a, b) {
  const out = { types: [...new Set([...a.types, ...b.types])].sort() };
  if (a.keys || b.keys) {
    const ka = a.keys ?? {}, kb = b.keys ?? {};
    out.keys = {}; out.optional = [];
    for (const k of [...new Set([...Object.keys(ka), ...Object.keys(kb)])].sort()) {
      out.keys[k] = ka[k] && kb[k] ? merge(ka[k], kb[k]) : (ka[k] ?? kb[k]);
      if (!ka[k] || !kb[k] || (a.optional ?? []).includes(k) || (b.optional ?? []).includes(k)) out.optional.push(k);
    }
  }
  if (a.of !== undefined || b.of !== undefined) out.of = a.of && b.of ? merge(a.of, b.of) : (a.of ?? b.of ?? null);
  return out;
}

/** what `value` breaks of `schema`: a missing key, a key the fixture never showed, a value of another type. [] when it conforms. */
export function conforms(schema, value, at = '$') {
  const t = typeOf(value);
  if (!schema.types.includes(t)) return [`${at}: ${t}, the fixture shows ${schema.types.join(' | ')}`];
  const issues = [];
  if (t === 'object' && schema.keys) {
    for (const k of Object.keys(schema.keys)) {
      if (!(k in value)) { if (!(schema.optional ?? []).includes(k)) issues.push(`${at}.${k}: missing`); continue; }
      issues.push(...conforms(schema.keys[k], value[k], `${at}.${k}`));
    }
    for (const k of Object.keys(value)) if (!(k in schema.keys)) issues.push(`${at}.${k}: a key the fixture does not show`);
  }
  if (t === 'array' && schema.of) value.forEach((x, i) => issues.push(...conforms(schema.of, x, `${at}[${i}]`)));
  return issues;
}

/** the schema of a recorded answer: its status and the keys and value types of its body */
export const schemaOf = (fx) => ({ status: fx.response.status, body: infer(fx.response.body) });

// ── the plan ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** every fixture file under test/io/fixtures, by repo-relative path (recorded calls and run files), with its text */
export function fixtureFiles(root) {
  const out = new Map();
  const walk = (d) => { if (!existsSync(d)) return; for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.json')) out.set(relative(root, p), readFileSync(p, 'utf8')); } };
  walk(join(root, FIXTURES));
  return out;
}

/**
 * What the fixtures produce. `files` is fixtureFiles(); `map` is test/io/op-map.json; `paths` is src/market/venue-paths.json.
 * -> { items: [{ kind, market, stage, file, sha, ... }], skipped: [{ file, why }] }
 */
export function plan(files, map, paths) {
  const rows = expandRows(map);
  const byFixture = new Map(rows.filter((r) => r.fixture).map((r) => [r.fixture, r]));
  const items = [], skipped = [];
  for (const [file, text] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [, , , market, stage] = file.split('/');
    const name = file.split('/').pop();
    const json = JSON.parse(text);
    if (isRunFile(name)) {
      const row = paths.rows.find((r) => r.market === json.market && r.op === json.op);
      if (!row) { skipped.push({ file, why: `no path ${json.market} ${json.op} in venue-paths.json` }); continue; }
      items.push({ kind: 'run', market, stage, file, sha: sha12(text), op: json.op, steps: row.steps.map((s) => ({ id: s.id, read: s.read ?? null })) });
      continue;
    }
    if (isRungFile(name) && json.rung === 'live') {
      const row = paths.rows.find((r) => r.market === json.market && r.op === json.path?.op);
      const step = row?.steps.find((x) => x.id === json.path?.step);
      if (!step) { skipped.push({ file, why: `no step ${json.path?.op} ${json.path?.step} of ${json.market} in venue-paths.json` }); continue; }
      items.push({ kind: 'step', market, stage, file, sha: sha12(text), op: json.op, path: json.path, run: json.run, schema: schemaOf(json) });
      continue;
    }
    const row = byFixture.get(file);
    if (!row) { skipped.push({ file, why: 'no row in op-map.json, so no SDK call' }); continue; }
    if (!row.call) { skipped.push({ file, why: `op-map row ${row.op} names no SDK call` }); continue; }
    items.push({ kind: 'call', market, stage, file, sha: sha12(text), op: row.op, call: row.call, source: row.source, schema: schemaOf(json) });
  }
  return { items, skipped };
}

/** tests per item: replay + schema for a call, machine for a run */
export const testCount = (items) => items.reduce((n, i) => n + (i.kind === 'run' ? 1 : 2), 0);

// ── the files ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// a value as source text of a generated test: JSON, with the characters that could end a script or a line escaped
const UNSAFE = { '<': '\\u003C', '>': '\\u003E', '\u2028': '\\u2028', '\u2029': '\\u2029' };
const q = (s) => JSON.stringify(s).replace(/[<>\u2028\u2029]/g, (c) => UNSAFE[c]);

function renderItem(i) {
  const file = i.file.split('/').pop();
  if (i.kind === 'run') {
    return [
      `  describe(${q(`${file} (run, ${i.op})`)}, () => {`,
      `    it(${q('machine: the steps are the path in order, each read a GET /v1 route')}, () => machineRun(${q(i.file)}, ${q(i.sha)}, ${q({ op: i.op, steps: i.steps })}));`,
      '  });',
    ].join('\n');
  }
  if (i.kind === 'step') {
    return [
      `  describe(${q(`${file} (${i.op}, mainnet run ${i.run})`)}, () => {`,
      `    it(${q('replay: the request is the step\'s read with the run\'s ids, and the recorded answer comes back through the SDK')}, () => replayStep(${q(i.file)}, ${q(i.sha)}, ${q({ run: i.run, path: i.path })}));`,
      `    it(${q('schema: the recorded answer keeps its keys and value types')}, () => schemaFixture(${q(i.file)}, ${q(i.sha)}, ${q(i.schema)}));`,
      '  });',
    ].join('\n');
  }
  return [
    `  describe(${q(`${file} (${i.op}, ${i.source})`)}, () => {`,
    `    it(${q('replay: the recorded request through the SDK call yields the recorded answer')}, () => replayFixture(${q(i.file)}, ${q(i.sha)}));`,
    `    it(${q('schema: the recorded answer keeps its keys and value types')}, () => schemaFixture(${q(i.file)}, ${q(i.sha)}, ${q(i.schema)}));`,
    '  });',
  ].join('\n');
}

/** test/io/generated/<market>/<stage>.test.ts for each market and stage the items name */
export function renderFiles(items) {
  const groups = new Map();
  for (const i of items) { const k = `${i.market}/${i.stage}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(i); }
  const out = new Map();
  for (const [k, list] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [market, stage] = k.split('/');
    const has = (k) => list.some((i) => i.kind === k);
    const used = [has('call') ? ['replayFixture'] : [], has('step') ? ['replayStep'] : [], has('call') || has('step') ? ['schemaFixture'] : [], has('run') ? ['machineRun'] : []].flat();
    out.set(`${OUT}/${k}.test.ts`, [
      `// generated: do not edit. ${RULE}: scripts/gen-acceptance-tests.mjs writes this from ${FIXTURES}/${k}/ (npm run gen:acceptance).`,
      `import { describe, it } from 'vitest';`,
      `import { ${used.join(', ')} } from '../../acceptance-harness';`,
      '',
      `describe(${q(`${market} · ${stage}`)}, () => {`,
      list.map(renderItem).join('\n'),
      '});',
      '',
    ].join('\n'));
  }
  return out;
}

/** the generated files on disk, by repo-relative path */
export function generatedOnDisk(root) {
  const out = new Map();
  const walk = (d) => { if (!existsSync(d)) return; for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out.set(relative(root, p), readFileSync(p, 'utf8')); } };
  walk(join(root, OUT));
  return out;
}

/** the generated files that differ from `want`, are missing, or are stale: [{ file, why }] */
export function drift(want, have) {
  const out = [];
  for (const [p, t] of want) { if (!have.has(p)) out.push({ file: p, why: 'missing' }); else if (have.get(p) !== t) out.push({ file: p, why: 'differs' }); }
  for (const p of have.keys()) if (!want.has(p)) out.push({ file: p, why: 'stale' });
  return out;
}

#!/usr/bin/env node
// _ACCEPTANCE_TESTS_v1_: record the api rung of one market path. Walks the read steps of that path in src/market/venue-paths.json,
// asks each read of coord's /v1 and keeps the answer as a fixture in the existing shape (masked as io:record masks), at
//   test/io/fixtures/<market>/<stage>/read-<route>.api-<op>-<step>.json
// The recorder key arrives on stdin only (a pipe), as for io:record; it goes to coord /v1 only and is never written.
//   node scripts/record-api-rung.mjs --market <id> --op list|buy|sell --plan                         what would be asked; no call, no key
//   <key on stdin> | node scripts/record-api-rung.mjs --market <id> --op <op> --key-stdin [--param name=value ...] [--force]
// A step whose read names a {placeholder} needs --param placeholder=value (an id of a run); without it the step is listed, not asked.
// Every call goes through scripts/io-live.mjs: GET only, counted in test/io/live-log.json, 401/402/429 stops the walk.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixturePath, pathRe } from './io-coverage-lib.mjs';
import { liveGet } from './io-live.mjs';
import { assertNoSecret, readRecorderKey } from './io-key.mjs';
import { collect, mask } from './io-mask.mjs';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** the read of a step with its {placeholders} filled: { method, path, query, missing: [names] } */
export function resolveRead(read, params = {}) {
  const m = /^(GET)\s+(\/v1\/[^\s?]*)(?:\?(\S*))?$/.exec(read ?? '');
  if (!m) throw new Error(`not a GET /v1 read: ${read}`);
  const missing = [];
  const fill = (s) => s.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n) => { if (params[n] === undefined) { missing.push(n); return `{${n}}`; } return encodeURIComponent(params[n]); });
  const path = fill(m[2]);
  const query = {};
  for (const kv of (m[3] ?? '').split('&').filter(Boolean)) { const [k, v = ''] = kv.split('='); query[decodeURIComponent(k)] = fill(v).replace(/%7B|%7D/g, (c) => (c === '%7B' ? '{' : '}')); }
  return { method: m[1], path, query, missing: [...new Set(missing)] };
}

/** the stage a step's fixture lives in: the step's own id when it is a stage of the op-map, else the first stage the path's features name */
export function stageOf(row, step, map) {
  if (map.stages.includes(step.id)) return step.id;
  return (row.features ?? []).map((f) => f.stage).find((s) => map.stages.includes(s)) ?? map.stages[0];
}

/** the read steps of one market path, as the walker will ask them */
export function planWalk(paths, map, market, op, params = {}) {
  const row = paths.rows.find((r) => r.market === market && r.op === op);
  if (!row) throw new Error(`no path ${market} ${op} in src/market/venue-paths.json`);
  return { row, steps: (row.steps ?? []).filter((s) => s.read).map((s) => ({ step: s, stage: stageOf(row, s, map), ...resolveRead(s.read, params) })) };
}

/**
 * Walk a path and keep each answer. `fetchImpl` stands in for the network in tests. Returns { wrote: [paths], skipped: [why], stopped }.
 * The walk stops at the first 401, 402 or 429 (liveGet closes that route); a non-200 answer is reported, not kept.
 */
export async function recordApiRung({ root = here, paths, map, market, op, params = {}, fetchImpl, gapMs, force = false, now = () => new Date().toISOString() }) {
  const { steps } = planWalk(paths, map, market, op, params);
  const wrote = [], skipped = [];
  let stopped = null;
  for (const w of steps) {
    if (w.missing.length) { skipped.push(`${w.step.id}: needs ${w.missing.map((n) => `--param ${n}=…`).join(' ')}`); continue; }
    const q = new URLSearchParams(w.query).toString();
    const r = await liveGet(root, `${w.path.replace(/^\/v1/, '')}${q ? `?${q}` : ''}`, { fetchImpl, gapMs });
    if (r.refused) { stopped = `${r.status} on ${w.path}: the walk stops`; break; }
    if (r.status !== 200) { skipped.push(`${w.step.id}: answered ${r.status}, not kept`); continue; }
    collect(r.body);
    const notes = { dropped: [], trimmed: [] };
    const body = mask(r.body, '', notes);
    const name = w.path.replace(/^\/v1\//, '');
    const mapRow = map.rows.find((x) => x.op && x.op.startsWith('GET ') && pathRe(x.op.replace(/^GET\s+/, '')).test(w.path));
    const opName = mapRow?.op ?? `GET ${name}`;
    const file = fixturePath({ market, stage: w.stage, dir: 'read', op: opName, variant: `api-${op}-${w.step.id}` });
    if (existsSync(join(root, file)) && !force) { skipped.push(`${w.step.id}: ${file} is recorded (--force to record again)`); continue; }
    const fx = {
      op: opName, market, stage: w.stage, dir: 'read', ...(mapRow?.sdk ? { sdk: mapRow.sdk } : {}), source: 'live', rung: 'api',
      request: { method: w.method, path: w.path, query: w.query }, response: { status: r.status, body },
      coord_sha: paths.coord.sha, read_at: r.read_at ?? now(),
      ...(notes.dropped.length || notes.trimmed.length ? { notes: { ...(notes.dropped.length ? { dropped: [...new Set(notes.dropped.map((d) => d.replace(/\[\d+\]/g, '[]')))] } : {}), ...(notes.trimmed.length ? { trimmed: notes.trimmed } : {}) } } : {}),
    };
    const text = `${JSON.stringify(fx, null, 1)}\n`;
    assertNoSecret(text, file);
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
    wrote.push(file);
  }
  return { wrote, skipped, stopped };
}

// ── command line ──────────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const market = arg('--market'), op = arg('--op');
  const params = Object.fromEntries(argv.flatMap((a, i) => (a === '--param' ? [argv[i + 1].split(/=(.*)/s).slice(0, 2)] : [])));
  const paths = JSON.parse(readFileSync(join(here, 'src/market/venue-paths.json'), 'utf8'));
  const map = JSON.parse(readFileSync(join(here, 'test/io/op-map.json'), 'utf8'));
  const ops = (m) => paths.rows.filter((r) => r.market === m).map((r) => r.op);
  if (!market || !op || !ops(market).includes(op)) {
    console.error(`usage: record-api-rung.mjs --market <${paths.markets.join('|')}> --op <${[...new Set(paths.rows.map((r) => r.op))].join('|')}> (--plan | --key-stdin) [--param name=value] [--force]${market && !ops(market).length ? `\nno paths for ${market}` : ''}`);
    process.exit(2);
  }
  if (argv.includes('--plan')) {
    for (const w of planWalk(paths, map, market, op, params).steps) console.log(`${w.step.id}\t${w.stage}\t${w.method} ${w.path}${Object.keys(w.query).length ? `?${decodeURIComponent(new URLSearchParams(w.query).toString())}` : ''}${w.missing.length ? `\tneeds ${w.missing.join(', ')}` : ''}`);
    process.exit(0);
  }
  if (!argv.includes('--key-stdin')) { console.error('the key arrives on stdin: pipe it in and pass --key-stdin'); process.exit(2); }
  await readRecorderKey();
  const r = await recordApiRung({ paths, map, market, op, params, force: argv.includes('--force') });
  console.log(`wrote ${r.wrote.length} fixture(s)`);
  for (const f of r.wrote) console.log(`  ${f}`);
  for (const s of r.skipped) console.log(`  not kept: ${s}`);
  if (r.stopped) { console.log(`  ${r.stopped}`); process.exit(1); }
}

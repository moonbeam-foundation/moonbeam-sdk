#!/usr/bin/env node
// _ACCEPTANCE_TESTS_v1_: record the api rung of one market path. Walks the read steps of that path in src/market/venue-paths.json,
// asks each read of coord's /v1 and keeps the answer as a fixture in the existing shape (masked as io:record masks), at
//   test/io/fixtures/<market>/<stage>/read-<route>.api-<op>-<step>.json
// The recorder key arrives on stdin only (a pipe), as for io:record; it goes to coord /v1 only and is never written.
//   node scripts/record-api-rung.mjs --market <id> --op list|buy|sell --plan                         what would be asked; no call, no key
//   <key on stdin> | node scripts/record-api-rung.mjs --market <id> --op <op> --key-stdin [--param name=value ...] [--force]
// A step whose read names a {placeholder} needs --param placeholder=value (an id of a run); without it the step is listed, not asked.
// Every call goes through scripts/io-live.mjs: GET only, counted in test/io/live-log.json, 401/402/429 stops the walk.
//
// _MAINNET_IO_v1_: --rung live records a mainnet run instead. The path's run file (test/io/fixtures/<market>/<stage>/run-live-<op>.json,
// written by scripts/gen-paths.mjs) names the steps the run covers and the public ids that fill their reads; each read is asked once and
// kept at read-<route>.live-<op>-<step>.json with the run's ref. It asks without a key unless --key-stdin is given, and a name the run
// file lists under `needs` comes by --param. A public "live" in VENUES stands on these files (npm run gen:paths after a recording).
//   node scripts/record-api-rung.mjs --rung live (--all | --market <id> --op <op>) --plan
//   node scripts/record-api-rung.mjs --rung live (--all | --market <id> --op <op>) [--param name=value ...] [--force]
//   <key on stdin> | node scripts/record-api-rung.mjs --rung live --market <id> --op <op> --key-stdin [--param name=value ...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expandRows, fixturePath, pathRe } from './io-coverage-lib.mjs';
import { runFiles } from './paths-lib.mjs';
import { liveGet } from './io-live.mjs';
import { assertNoSecret, readRecorderKey } from './io-key.mjs';
import { collect, mask } from './io-mask.mjs';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** the read of a step with its {placeholders} filled: { method, path, query, missing: [names] } */
export function resolveRead(read, params = {}) {
  const m = /^(GET)\s+(\/v1\/[^\s?]*)(?:\?(\S*))?$/.exec(read ?? '');
  if (!m) throw new Error(`not a GET /v1 read: ${read}`);
  const missing = [];
  // a path segment is encoded here; a query value is kept as it is (the URL's own encoding does it once, when the read is asked)
  const fill = (s, enc) => s.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n) => { if (params[n] === undefined) { missing.push(n); return `{${n}}`; } return enc ? encodeURIComponent(params[n]) : String(params[n]); });
  const path = fill(m[2], true);
  const query = {};
  for (const kv of (m[3] ?? '').split('&').filter(Boolean)) { const [k, v = ''] = kv.split('='); query[decodeURIComponent(k)] = fill(v, false); }
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

/** _MAINNET_IO_v1_: the mainnet run of one market path, from its run files: the ref, the steps it covers, its public ids and the names it still needs */
export function liveRunOf(paths, market, op) {
  const runs = [...runFiles(paths).values()].filter((r) => r.run.rung === 'live' && r.market === market && r.op === op);
  if (!runs.length) return null;
  const ref = runs[0].run.ref;
  if (runs.some((r) => r.run.ref !== ref)) throw new Error(`${market} ${op}: its mainnet run files name more than one run`);
  return { ref, covers: [...new Set(runs.flatMap((r) => r.covers))], ids: Object.assign({}, ...runs.map((r) => r.ids)), needs: [...new Set(runs.flatMap((r) => r.needs))] };
}
/** every market path of the snapshot that has a mainnet run */
export const liveWalks = (paths) => paths.rows.filter((r) => liveRunOf(paths, r.market, r.op)).map((r) => ({ market: r.market, op: r.op }));
/** the read steps a mainnet run covers, with its ids (and the market's own id as {venue}) filled; a name given by --param wins */
export function planLive(paths, map, market, op, params = {}) {
  const run = liveRunOf(paths, market, op);
  if (!run) throw new Error(`no mainnet run of ${market} ${op} in src/market/venue-paths.json`);
  const w = planWalk(paths, map, market, op, { venue: market, ...run.ids, ...params });
  return { run, row: w.row, steps: w.steps.filter((x) => run.covers.includes(x.step.id)) };
}

/**
 * _MAINNET_IO_v1_: the SDK call that makes a recorded request, when there is one: the op-map's call for the op, run over a transport
 * that answers the recorded body, must ask exactly the recorded request. `s` is the built SDK (sdkOf), `calls` test/io/calls.mjs CALLS.
 */
export function sdkCallOf(s, calls, map) {
  const rows = expandRows(map);
  return async ({ op, market, stage, request, response }) => {
    const row = rows.find((r) => r.op === op && r.market === market && (r.call || r.sdk));
    const def = row ? calls[row.call] ?? Object.values(calls).find((d) => d.fn === row.sdk) : null;
    if (!def || def.key || def.needs || def.flow) return null;
    // the call's inputs, from the recorded request: the query values its own example names, and the :names of the op's path
    const segs = op.replace(/^GET\s+/, '').split('/'); const got = request.path.replace(/^\/v1\//, '').split('/');
    const inPath = Object.fromEntries(segs.map((sg, i) => [sg, got[i]]).filter(([sg]) => sg.startsWith(':')).map(([sg, v]) => [sg.slice(1), decodeURIComponent(v ?? '')]));
    const asked = def.args ? Object.fromEntries(Object.keys(def.args()).map((k) => [k, request.query?.[k]])) : {};
    if (Object.values(asked).some((v) => v === undefined)) return null;
    const args = Object.keys(asked).length || Object.keys(inPath).length ? { ...inPath, ...asked } : null;
    const seen = [];
    const t = { base: 'https://coord.example/v1', fetch: async (url, init) => {
      const u = new URL(url); seen.push({ method: init?.method ?? 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams) });
      return { ok: true, status: response.status, headers: new Headers(), json: async () => structuredClone(response.body), text: async () => JSON.stringify(response.body) };
    } };
    try { await def.run(s, t, { market, stage, op, fx: { request, response }, ...(args ? { args } : {}) }); } catch { return null; }
    return seen.length === 1 && JSON.stringify(seen[0]) === JSON.stringify(request) ? { fn: def.fn, ...(args ? { args } : {}) } : null;
  };
}

/**
 * Walk a path and keep each answer. `fetchImpl` stands in for the network in tests. Returns { wrote: [paths], skipped: [why], stopped }.
 * The walk stops at the first 401, 402 or 429 (liveGet closes that route); a non-200 answer is reported, not kept.
 */
export async function recordApiRung({ root = here, paths, map, market, op, params = {}, fetchImpl, gapMs, force = false, now = () => new Date().toISOString(), rung = 'api', sdkCall = null }) {
  if (rung !== 'api' && rung !== 'live') throw new Error(`no rung ${rung}: api or live`);
  // _MAINNET_IO_v1_: a mainnet run walks only the steps it covers, with its own ids
  const live = rung === 'live' ? planLive(paths, map, market, op, params) : null;
  const { steps } = live ?? planWalk(paths, map, market, op, params);
  const wrote = [], skipped = [];
  let stopped = null;
  for (const w of steps) {
    if (w.missing.length) { skipped.push(`${w.step.id}: needs ${w.missing.map((n) => `--param ${n}=…`).join(' ')}`); continue; }
    const q = new URLSearchParams(w.query).toString();
    const r = await liveGet(root, `${w.path.replace(/^\/v1/, '')}${q ? `?${q}` : ''}`, { fetchImpl, gapMs, ...(live ? { daily: true } : {}) });
    if (r.refused) { stopped = `${r.status} on ${w.path}: the walk stops`; break; }
    if (r.status !== 200) { skipped.push(`${w.step.id}: answered ${r.status}, not kept`); continue; }
    collect(r.body);
    const notes = { dropped: [], trimmed: [] };
    const body = mask(r.body, '', notes);
    const name = w.path.replace(/^\/v1\//, '');
    const mapRow = map.rows.find((x) => x.op && x.op.startsWith('GET ') && pathRe(x.op.replace(/^GET\s+/, '')).test(w.path));
    const opName = mapRow?.op ?? `GET ${name}`;
    const file = fixturePath({ market, stage: w.stage, dir: 'read', op: opName, variant: `${rung}-${op}-${w.step.id}` });
    if (existsSync(join(root, file)) && !force) { skipped.push(`${w.step.id}: ${file} is recorded (--force to record again)`); continue; }
    const request = { method: w.method, path: w.path, query: w.query };
    // a mainnet read names the SDK call only when that call, replayed over the recorded answer, asks this very request
    const call = live && sdkCall ? await sdkCall({ op: opName, market, stage: w.stage, request, response: { status: r.status, body } }) : null;
    const fx = {
      op: opName, market, stage: w.stage, dir: 'read', ...(live ? (call ? { sdk: call.fn } : {}) : mapRow?.sdk ? { sdk: mapRow.sdk } : {}), source: 'live', rung,
      ...(live ? { run: live.run.ref, path: { op, step: w.step.id } } : {}),
      request, response: { status: r.status, body },
      ...(call?.args ? { args: call.args } : {}),
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
  const show = (w) => `${w.step.id}\t${w.stage}\t${w.method} ${w.path}${Object.keys(w.query).length ? `?${decodeURIComponent(new URLSearchParams(w.query).toString())}` : ''}${w.missing.length ? `\tneeds ${w.missing.join(', ')}` : ''}`;
  if (arg('--rung') === 'live') {
    // _MAINNET_IO_v1_: the mainnet runs of the snapshot, one path or all of them
    const walks = argv.includes('--all') ? liveWalks(paths) : market && op && liveRunOf(paths, market, op) ? [{ market, op }] : [];
    if (!walks.length) { console.error(`usage: record-api-rung.mjs --rung live (--all | --market <id> --op <op>) [--plan] [--key-stdin] [--param name=value] [--force]\nmainnet runs: ${liveWalks(paths).map((w) => `${w.market} ${w.op}`).join(', ') || 'none in the snapshot'}`); process.exit(2); }
    if (argv.includes('--plan')) {
      for (const w of walks) { console.log(`${w.market} ${w.op}`); for (const x of planLive(paths, map, w.market, w.op, params).steps) console.log(`  ${show(x)}`); }
      process.exit(0);
    }
    if (argv.includes('--key-stdin')) await readRecorderKey();
    // the SDK call behind a read, from the build when there is one
    let sdkCall = null;
    try {
      const { CALLS, sdkOf } = await import(pathToFileURL(join(here, 'test/io/calls.mjs')).href);
      const dist = (p) => import(pathToFileURL(join(here, 'dist', p)).href);
      sdkCall = sdkCallOf(sdkOf([await dist('market/index.js'), await dist('playground/index.js'), await dist('jobs/index.js')]), CALLS, map);
    } catch { console.log('no build (npm run build): the reads are kept without their SDK call'); }
    let bad = false;
    for (const w of walks) {
      const r = await recordApiRung({ paths, map, market: w.market, op: w.op, params, force: argv.includes('--force'), rung: 'live', sdkCall });
      console.log(`${w.market} ${w.op}: wrote ${r.wrote.length} fixture(s)`);
      for (const f of r.wrote) console.log(`  ${f}`);
      for (const x of r.skipped) console.log(`  not kept: ${x}`);
      // a refusal stops every walk: the free rate is one, shared
      if (r.stopped) { console.log(`  ${r.stopped}`); bad = true; break; }
    }
    console.log('then: npm run gen:paths && npm run gen:acceptance && npm run gen:readme');
    process.exit(bad ? 1 : 0);
  }
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

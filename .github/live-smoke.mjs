#!/usr/bin/env node
// _LIVE_SMOKE_v1_ (2026-10-09, the owner: on every CI run and every merge, run what a newcomer runs, live: the published
// packages, live Jev through TypeSafe, and the layer's policies that an outside agent meets today). Keyless on purpose: CI
// holds no key (Taifoon's TypeSafe key stays server-side; a grade goes through the layer like an outside caller's).
//   node smoke.mjs [moonbeam] [taifoon] [layer]     (default: all three)   --json   prints one JSON line at the end
// Runs in CI: moonbeam-foundation/moonbeam-sdk (its packed build) and moonbeam-protocol (the npm release), from a copy of
// this file at .github/live-smoke.mjs; on box 116 every 15 min for the Taifoon repos. Exit 0 when every check passes. Reads and grades only: nothing signs or sends a transaction.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COORD = process.env.COORD ?? 'https://coord.taifoon.dev';
const SITE = process.env.SITE ?? 'https://www.taifoon.io';
// the grade Moonbeam's demo replays, recorded on Base (tx 0x25c51d53…01b3, block 51,903,684)
const MOONBEAM_DECISION = process.env.MOONBEAM_DECISION ?? 'decision-1790596700677-ae89127c1f';
const UA = { 'user-agent': 'taifoon-live-smoke/1', 'x-taifoon-client': 'taifoon-live-smoke' };
const want = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !['--out', '--prom'].includes(all[i - 1]));
const parts = want.length ? want : ['moonbeam', 'taifoon', 'layer'];
const results = [];

async function check(part, id, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ part, id, ok: true, ms: Date.now() - t0, note: note ?? null }); console.log(`ok   ${part} ${id} ${note ?? ''} (${Date.now() - t0} ms)`); }
  catch (e) { results.push({ part, id, ok: false, ms: Date.now() - t0, error: String(e.message ?? e).slice(0, 400) }); console.log(`FAIL ${part} ${id}: ${String(e.message ?? e).slice(0, 400)}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240_000, env: { ...process.env, NO_COLOR: '1' } });
// a CLI that reports a stopped step exits non-zero by design: its JSON on stdout is the answer
const shAny = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 240_000, env: { ...process.env, NO_COLOR: '1' } }).stdout ?? '';
const get = async (url, init = {}) => { const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) }); return { r, status: r.status, text: await r.text() }; };
const json = (t) => { try { return JSON.parse(t); } catch { return null; } };
const fresh = () => mkdtempSync(join(tmpdir(), 'live-smoke-'));

if (parts.includes('moonbeam')) {
  const dir = fresh();
  // MOONBEAM_SDK_SPEC: what to install (default the npm release; the SDK's own CI passes its packed build, a .tgz)
  await check('moonbeam', 'npm install @moonbeam-foundation/sdk', () => { sh('npm', ['init', '-y'], dir); sh('npm', ['install', '--no-audit', '--no-fund', process.env.MOONBEAM_SDK_SPEC || '@moonbeam-foundation/sdk@latest'], dir); return JSON.parse(sh('npm', ['ls', '--json', '@moonbeam-foundation/sdk'], dir)).dependencies['@moonbeam-foundation/sdk'].version; });
  await check('moonbeam', 'npx moonbeam demo', () => {
    const out = sh('npx', ['moonbeam', 'demo'], dir);
    assert(out.includes('same decision digest as the one recorded on Base'), 'the demo did not reproduce the decision recorded on Base');
    assert(/sums to zero: yes[\s\S]*sums to zero: yes/.test(out), 'a settlement in the demo does not sum to zero');
    return 'decision reproduced, settlements sum to zero';
  });
  await check('moonbeam', 'the demo grade is recorded on Base (live)', () => {
    const v = json(sh('npx', ['jev', 'verify', MOONBEAM_DECISION, '--chain', 'base'], dir)) ?? {};
    const s = v.status ?? v.base?.status ?? v.chains?.base?.status ?? JSON.stringify(v).match(/"status":\s*"(\w+)"/)?.[1];
    assert(s === 'recorded' && (v.problems ?? []).length === 0, `jev verify: status ${s}, problems ${JSON.stringify(v.problems ?? [])}`);
    return 'recorded, no problems';
  });
  await check('moonbeam', 'gradeJob with no key (the free grades on the layer, through @taifoon/jev)', () => {
    const out = json(sh('node', ['--input-type=module', '-e', "import('@moonbeam-foundation/sdk/judge').then(async ({ gradeJob }) => { try { const r = await gradeJob({ jobId: '0x' + '00'.repeat(31) + '27', evidence: 'task: reply yes. reply: yes' }); console.log(JSON.stringify({ verdict: r.verdict, via: r.via })); } catch (e) { console.log(JSON.stringify({ status: e.status, error: e.message })); } })"], dir).trim().split('\n').pop());
    assert(out && (out.via?.connection === 'trial' || (out.status === 402 && /no free grade left/.test(out.error))), `gradeJob: ${JSON.stringify(out)}`);
    return out.verdict ? `${out.verdict} on a free grade` : 'free grades of this caller spent today (402 naming the ways on)';
  });
  rmSync(dir, { recursive: true, force: true });
}

if (parts.includes('taifoon')) {
  const dir = fresh();
  await check('taifoon', 'npm install @taifoon/jev', () => { sh('npm', ['init', '-y'], dir); sh('npm', ['install', '--no-audit', '--no-fund', '@taifoon/jev@latest'], dir); return JSON.parse(sh('npm', ['ls', '--json', '@taifoon/jev'], dir)).dependencies['@taifoon/jev'].version; });
  await check('taifoon', 'npx jev run (picks a live job, reads its evidence and facts from the layer)', () => {
    const r = json(shAny('npx', ['jev', 'run', '--network', 'none', '--json'], dir));
    assert(r && Array.isArray(r.steps), 'no JSON from jev run');
    for (const id of ['pick', 'evidence', 'facts']) assert(r.steps.find((s) => s.id === id)?.ok, `step ${id} failed: ${JSON.stringify(r.steps.find((s) => s.id === id))}`);
    const g = r.steps.find((s) => s.id === 'grade');
    // _FREE_GRADES_v1_ (@taifoon/jev 0.2.18): no key → the caller's free grades on the layer; past them a 402 naming the ways on
    assert(g?.ok || /no free grade left/.test(g?.error ?? ''), `grade step: ${JSON.stringify(g)}`);
    return `job ${r.job?.jobId} on ${r.job?.chainId}, ${r.steps.filter((s) => s.ok).length} steps ok`;
  });
  rmSync(dir, { recursive: true, force: true });
}

if (parts.includes('layer')) {
  await check('layer', 'GET /v1/quickstart', async () => { const { status, text } = await get(`${COORD}/v1/quickstart`); assert(status === 200 && json(text), `HTTP ${status}`); });
  await check('layer', 'MCP initialize + tools/list', async () => {
    const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const i = await get(`${COORD}/mcp`, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'taifoon-live-smoke', version: '1' } } }) });
    assert(i.status === 200 && /serverInfo/.test(i.text), `initialize HTTP ${i.status}`);
    const t = await get(`${COORD}/mcp`, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
    assert(/taifoon_register/.test(t.text) && /taifoon_judge_compose/.test(t.text), 'tools/list lacks taifoon_register or taifoon_judge_compose');
  });
  await check('layer', 'discovery files (x402, agent card, MCP server card)', async () => {
    for (const p of ['/.well-known/x402', '/.well-known/agent-card.json', '/.well-known/mcp/server-card.json']) { const { status } = await get(`${SITE}${p}`); assert(status === 200, `${p} HTTP ${status}`); }
  });
  await check('layer', 'every open wall answers 402 with an x402 offer before payment (no content without payment)', async () => {
    const d = json((await get(`${SITE}/.well-known/x402`)).text);
    assert(d?.details?.length, 'no walls in /.well-known/x402');
    const bad = [];
    // jev.grade gives every caller 3 free grades first, so its first answer is a grade, not an offer (checked live below)
    for (const w of d.details.filter((x) => !('needs' in x) && x.id !== 'jev.grade')) {
      const q = w.input?.queryParams ? '?' + new URLSearchParams(Object.entries(w.input.queryParams).map(([k, v]) => [k, String(v)])) : '';
      const { status, text } = await get(w.url + (w.method === 'GET' ? q : ''), w.method === 'POST' ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(w.input?.body ?? {}) } : {});
      const body = json(text) ?? {};
      if (status !== 402 || !(body.accepts ?? body.x402?.accepts)?.length) bad.push(`${w.id} ${status}`);
    }
    assert(!bad.length, `walls without a 402 offer: ${bad.join(', ')}`);
    return `${d.details.length} walls`;
  });
  await check('layer', 'a live Jev grade through the layer (TypeSafe, keyless free grade)', async () => {
    // the refusal names a delivery the layer holds now; grading it is what an outside caller's first grade is
    const first = json((await get(`${COORD}/v1/judge/compose`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).text) ?? {};
    const body = first.next_step?.http?.body;
    assert(body, `no next_step body from compose: ${JSON.stringify(first).slice(0, 200)}`);
    const { status, text } = await get(`${COORD}/v1/judge/compose`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const g = json(text) ?? {};
    if (status === 402) return 'free grades of this caller spent today (402 with the price): the wall answered, no grade';
    assert(status === 200 && g.judge_called === true && /^jev-/.test(g.model ?? ''), `compose HTTP ${status}: ${text.slice(0, 200)}`);
    return `${g.model}, ${g.receipt?.verdict?.ending ?? g.verdict?.ending ?? g.decision?.verdict?.ending ?? 'graded'}`;
  });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
const doc = { schema: 'taifoon.live.smoke.v1', at: new Date().toISOString(), parts, ok: failed.length === 0, results };
if (process.argv.includes('--json')) console.log(JSON.stringify(doc));
// on box 116: the answer for api.taifoon.dev/coordination/live-smoke.json and a textfile for Grafana and the alert
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const w = (f, t) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(`${f}.tmp`, t); renameSync(`${f}.tmp`, f); };
if (arg('--out')) w(arg('--out'), JSON.stringify(doc));
if (arg('--prom')) w(arg('--prom'), ['# HELP taifoon_live_smoke_ok 1 when the check passed on its last run', '# TYPE taifoon_live_smoke_ok gauge',
  ...results.map((r) => `taifoon_live_smoke_ok{part="${r.part}",check="${r.id.replace(/["\\\n]/g, '')}"} ${r.ok ? 1 : 0}`),
  '# HELP taifoon_live_smoke_last_run_timestamp_seconds end of the last run', '# TYPE taifoon_live_smoke_last_run_timestamp_seconds gauge',
  `taifoon_live_smoke_last_run_timestamp_seconds ${Math.floor(Date.now() / 1000)}`].join('\n') + '\n');
process.exit(failed.length ? 1 : 0);

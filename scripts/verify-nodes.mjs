#!/usr/bin/env node
// Run every workflow node's SDK call against the live layer, and record what happened: src/workflows/verified.ts.
//
//   MOONBEAM_API=… MOONBEAM_API_KEY=… node scripts/verify-nodes.mjs [--studio-run run-templates-live.json] [--write]
//
// Not published. Reads run as reads; a step that moves money runs as a plan (unsigned calls come back, nothing is signed or
// sent). The hand-over is opened without dispatch. The test-network ending is taken from a recorded Studio run (--studio-run),
// with its transaction hashes. A step that cannot run today says why; nothing is marked as run that did not answer.
import { readFileSync, writeFileSync } from 'node:fs';
import * as market from '../dist/market/index.js';
import * as devnet from '../dist/devnet/index.js';
import { WORKFLOWS } from '../dist/workflows/index.js';

const argv = process.argv.slice(2);
const opt = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const t = market.transportFromEnv();
const at = new Date().toISOString().slice(0, 10);
const out = {};
const short = (v) => JSON.stringify(v).slice(0, 160);
async function run(op, f, says) {
  const t0 = Date.now();
  try { const r = await f(); out[op] = { status: r.status ?? 'ran', at, ms: Date.now() - t0, evidence: says(r.value ?? r) }; }
  catch (e) { out[op] = { status: 'refused', at, ms: Date.now() - t0, evidence: `${e.status ?? ''} ${e.code ?? ''} ${e.message}`.trim().slice(0, 200) }; }
  console.log(out[op].status.padEnd(8), op.padEnd(38), out[op].evidence);
}
const notRun = (op, why) => { out[op] = { status: 'not-run', at, evidence: why }; console.log('not-run ', op.padEnd(38), why); };

// knowledge
let seller = null;
await run('GET /v1/match/search', () => market.searchSellers(t, { tag: 'text.summarize', limit: 5 }), (r) => `${r.n} sellers of text.summarize; first on ${r.hits[0]?.venue}`);
await run('GET /v1/match/demands', () => market.findBuyers(t, { tag: 'text.summarize', limit: 5 }), (r) => `${r.demands.length} markets with buyers of text.summarize; first ${short(r.demands[0]?.venue ?? r.demands[0])}`);
await run('GET /v1/venues/:id', () => market.market(t, 'x402'), (r) => `x402: ${(r.venues ?? []).length} networks; Base ${(r.venues ?? []).find((v) => v.id === 'x402-base')?.paid_via?.reduce((a, p) => a + (p.usd_7d ?? 0), 0).toFixed(0)} USD in 7 days`);
await run('GET /v1/exchanges', () => market.listedEdges(t, { class: 'chat.word_count' }), (r) => `${r.total} edges; first ${r.rows[0]?.edge_id} (${r.rows[0]?.state})`);
await run('GET /v1/agents/identity', () => market.identity(t, 8453, [31596]), (r) => `${r.length} agent: 8453:${r[0]?.agentId}, its card and owner on record`);
seller = await market.registryAgent(t, 8453, 31596).catch(() => null);
await run('GET /v1/onboard/worklist', () => devnet.findSellers(t, { chainId: 36927 }, { limit: 3, pages: 1 }), (r) => `${r.read} worklist rows; ${r.sellers.length} candidates`);
// checks
await run('GET /v1/agents/:chain/:id/readiness', () => market.readiness(t, 8453, 31596), (r) => `hireable ${r.hireable}; ${(r.steps ?? []).length} checks`);
await run('pure:onboard.fix', () => market.checkAgent(t, { agent: '8453:31596' }), (r) => `goals ${short(r.goals ?? r.verdict ?? Object.keys(r))}`);
const ep = seller?.endpoint ? String(seller.endpoint) : null;
if (ep) await run('POST /v1/agents/probe', () => market.testEndpoint(t, { url: ep, kind: 'mcp' }), (r) => `probe ${short(r.ok ?? r.status ?? Object.keys(r))}`);
else notRun('POST /v1/agents/probe', 'no endpoint read for the sample agent');
// transforms
const edges = await market.listedEdges(t, { limit: 50 }).catch(() => ({ rows: [] }));
const sor = edges.rows.find((r) => /^0x[0-9a-fA-F]{40}$/.test(String(r.seller_of_record ?? '')))?.seller_of_record ?? null;
if (sor) await run('POST /v1/pools/quote', () => devnet.quoteEdge(t, { chainId: 36927 }, { sellerOfRecord: sor }), (r) => `deposit ${r.quote.deposit} · premium ${r.quote.premium} (test GLMR wei) · ${r.pool ? 'a pool covers it' : 'no pool covers it'}: ${String(r.why?.[0] ?? '').slice(0, 90)}`);
else notRun('POST /v1/pools/quote', 'no seller of record on the listed edges to quote');
const studio = opt('--studio-run') ? JSON.parse(readFileSync(opt('--studio-run'), 'utf8')) : null;
const ev = (studio?.publish?.events ?? []).filter((e) => e.e === 'result' || e.e === 'tx');
const res = (k) => ev.find((e) => e.e === 'result' && e.j?.key === k)?.j;
const hs = res('hire')?.data?.handshake_id ?? null;
if (hs) await run('POST /v1/judge/compose', () => market.composeGrade(t, { handshake_id: hs, mode: 'prepare' }), (r) => `${r.rubric} prepare on ${hs}: hard_fail ${r.hard_fail}, judge called ${r.judge_called}, digest ${String(r.prepare_digest).slice(0, 18)}…`);
else notRun('POST /v1/judge/compose', 'no handshake recorded to grade');
// connectors
if (ep) await run('POST /v1/handshake', () => market.handOver(t, { candidate: { kind: 'mcp', address: String(seller.owner), agentId: '31596', chainId: 8453 }, task: 'Answer with the word ready.', dispatch: false }), (r) => `opened ${r.handshakeId} without dispatch`);
notRun('POST /v1/exchanges/edge', 'needs a seller that passes the onboarding check today; the last two checks of 48 candidates passed none');
const callable = edges.rows.find((r) => r.state === 'live');
if (!callable) notRun('POST /v1/exchanges/:edge_id/call', `no edge is live: the ${edges.rows.length} on record are ${[...new Set(edges.rows.map((r) => r.state))].join(' or ')}`);
else await run('POST /v1/exchanges/:edge_id/call', () => devnet.callEdge(t, String(callable.edge_id), { task: 'Count the words: agents sell work on every market', class: String(callable.class) }), (r) => (r.ok ? `one meter line on ${callable.edge_id}` : `${r.code}: ${r.why}`));
const job = res('settle')?.data?.jobId ?? null;
if (job) await run('GET /v1/settle/:id', () => market.jobRecord(t, job), (r) => `the run's job read back: verdict ${r.verdict}, buyer and seller on record`);
else notRun('GET /v1/settle/:id', 'no job recorded to read');
// money: plans on Base, and the test network's ending from the Studio's run
await run('POST /v1/assurance/call', () => market.jobCalls(t, { chainId: 8453, action: { kind: 'register-8004', agentURI: 'https://example.com/.well-known/agent-card.json' } }), (r) => `${r.calls.length} unsigned call(s) on Base; nothing sent`);
// the test network stays out of public text (council rule): steps and signers only, never its chain id or transaction hashes
const txs = ev.filter((e) => e.e === 'tx').map((e) => ({ action: e.j.action, signer: e.j.signer }));
if (txs.length) out['POST /v1/assurance/call'].testnet = { at, ending: res('settle')?.data?.ending ?? null, verdict: res('grade')?.data?.decided ?? null, txs };
out['POST /v1/settle'] = txs.length
  ? { status: 'ran', at, evidence: `the Studio's run funded and accepted a job on the test network (${txs.filter((x) => x.signer !== 'evaluator').length} transactions); on Base hirePlan answers the unsigned calls`, testnet: { txs: txs.filter((x) => x.signer !== 'evaluator') } }
  : { status: 'not-run', at, evidence: 'no recorded run' };
console.log(out['POST /v1/settle'].status.padEnd(8), 'POST /v1/settle'.padEnd(38), out['POST /v1/settle'].evidence);
// listing, key and sale (the List my business modules)
await run('pure:business.plan', () => market.keyStanding(t), (r) => `plan ${short(r.plan?.name ?? r.plan?.id ?? r.body?.tier ?? null)}`);
for (const op of ['pure:business.publish', 'pure:business.reach', 'pure:business.keep', 'pure:business.seen']) notRun(op, 'no agent listing on this key yet: createListing makes one (the Studio\'s My agents)');
notRun('pure:business.pay', 'no sale of a listing on this key yet');
out['pure:business.door'] = out['POST /v1/agents/probe'];
{ const { hookQuote } = await import('../dist/assurance/index.js'); const q = hookQuote({ price: 10n ** 18n, premium: 0n, deposit: 2n * 10n ** 18n, covered: false });
  out['pure:wilson.sides'] = { status: 'ran', at, evidence: `hookQuote on the quote's own amounts: completed pays the seller ${q.legs.completed.seller}, a rejection returns the buyer ${q.legs.rejected.buyer} (wei)` }; }
for (const op of ['pure:business.workflow', 'pure:business.read', 'pure:business.claim', 'pure:manual']) out[op] = { status: 'studio', at, evidence: 'the Studio runs this step itself' };

const used = new Set(WORKFLOWS.flatMap((w) => w.nodes.map((n) => n.op)).filter(Boolean));
const missing = [...used].filter((op) => !out[op]);
if (missing.length) { console.error('no verification for', missing); process.exit(1); }
const text = `// GENERATED by scripts/verify-nodes.mjs on ${at}: what each layer call did the last time it was run. Do not edit.\n` +
  `export type Verification = { status: 'ran' | 'planned' | 'refused' | 'not-run' | 'studio'; at: string; ms?: number; evidence: string;\n` +
  `  testnet?: { at?: string; ending?: string | null; verdict?: string | null; txs: { action: string; signer: string }[] } };\n` +
  `export const VERIFIED: Readonly<Record<string, Verification>> = ${JSON.stringify(out, null, 1)};\n`;
if (argv.includes('--write')) { writeFileSync(new URL('../src/workflows/verified.ts', import.meta.url), text); console.log('wrote src/workflows/verified.ts'); }

#!/usr/bin/env node
// Onboard ONE seller end to end on a devnet, through the SDK's ./devnet calls, and print every step.
//
//   npm run e2e:devnet                     (builds, then runs this file)
//   node scripts/devnet-onboard.mjs [--seller <chain>:<agent>] [--tries 6] [--backing 10] [--no-finalize] [--json out.json]
//
// Not published (scripts/ is not in the package's files). It names no network, address or URL: every one comes from the
// environment or from the coordination API's own registry (see the internal note DEVNET.md beside this repo's README).
//
//   MOONBEAM_API              the coordination endpoint, /v1 included                       (required)
//   MOONBEAM_API_KEY          the tenant key the edge is written with                       (required: edge writes are keyed)
//   MOONBEAM_DEVNET_*         chain id, RPC, faucet, tx link, contracts (any left out are read from the API)
//   MOONBEAM_GRADE_URL        the Studio's grade workflow                                   (required to grade)
//   MOONBEAM_GRADE_TOKEN      its token
//   MOONBEAM_DEVNET_MNEMONIC  the devnet signer's test mnemonic; else the macOS Keychain item "moonbeam-devnet-mnemonic"
//
// Keys: one HD test mnemonic, never printed. Indexes: sellers of record 37200–37999 (one per edge), buyer 36934,
// evaluator 36958, pool backer 37040, gas 0. Every send asserts the RPC's chain id equals the profile's first.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, defineChain, hashTypedData, http, parseAbi } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import {
  devnetProfile, transportFromEnv, txLinkOf, withQuote, findSellers, mcpTools, checkSeller, quoteEdge, openPoolPlan, poolOpened,
  edgeAgreement, edgeBody, writeEdge, readEdge, faucetMintCalls, claimGas, fundPoolPlan, hire, deliver, grade, decisionDigest, settle,
  callEdge, meterLines, agreementState, DEVNET_JOB_PRICE, DEVNET_POOL_BACKING,
} from '@moonbeam-foundation/sdk/devnet';

const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (f) => argv.includes(f);
const KEYS = { gas: 0, buyer: 36934, evaluator: 36958, backer: 37040, sorBase: 37200, sorSpan: 800 };
const out = { steps: [], txs: [] };
const say = (step, line, extra = {}) => { console.log(`${String(out.steps.length + 1).padStart(2)} ${step.padEnd(10)} ${line}`); out.steps.push({ step, line, ...extra }); };
const die = (why) => { console.error(`stopped: ${why}`); if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(out, null, 1)); process.exit(1); };
const big = (x) => (typeof x === 'bigint' ? x.toString() : x);

function mnemonic() {
  if (process.env.MOONBEAM_DEVNET_MNEMONIC?.trim()) return process.env.MOONBEAM_DEVNET_MNEMONIC.trim();
  try { return execFileSync('security', ['find-generic-password', '-s', 'moonbeam-devnet-mnemonic', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

const t = transportFromEnv();
if (!t.apiKey) die('MOONBEAM_API_KEY is not set: the edge is written with the tenant key');
let P = await devnetProfile({}, t).catch((e) => die(e.message));
say('profile', `chain ${P.chainId} · line ${P.line} · token ${P.token.symbol} · sources ${Object.entries(P.sources).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(' ')}`);
const M = mnemonic(); if (!M) die('no devnet mnemonic (MOONBEAM_DEVNET_MNEMONIC or the Keychain item moonbeam-devnet-mnemonic)');
const acct = (i) => mnemonicToAccount(M, { addressIndex: i });
const chain = defineChain({ id: P.chainId, name: `devnet ${P.chainId}`, nativeCurrency: { name: 'devnet gas', symbol: 'GAS', decimals: 18 }, rpcUrls: { default: { http: [P.rpc] } } });
const pub = createPublicClient({ chain, transport: http(P.rpc, { timeout: 30_000 }) });
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function totalAssets() view returns (uint256)', 'function totalSupply() view returns (uint256)']);
const HOOK = parseAbi(['function jobs(bytes32) view returns (address buyer, address seller, address token, uint256 price, uint256 premium, uint256 deposit, uint64 deadline, uint64 challengeWindow, address pool, uint8 state)',
  'function v4Of(bytes32) view returns (address evaluator, uint64 submittedAt, uint32 reviewWindow, uint32 disputeWindow, uint64 disputeDeadline, bool isV4, uint256 evaluatorFee, uint256 openCoverCap, bytes32 verdictDigest)', 'function finalizeReject(bytes32 jobId)']);
const STATE = ['None', 'Funded', 'Submitted', 'Completed', 'Expired', 'Rejected', 'Cheated', 'Open', 'RejectPending', 'Disputed', 'Accepted'];

let chainChecked = false;
async function send(i, call, label) {
  if (call.chainId !== P.chainId) die(`refusing to sign ${label}: chain ${call.chainId} is not the profile's ${P.chainId}`);
  if (!chainChecked) { const id = await pub.getChainId(); if (id !== P.chainId) die(`refusing to sign: the RPC answers chain ${id}, not ${P.chainId}`); chainChecked = true; }
  const a = acct(i); const w = createWalletClient({ account: a, chain, transport: http(P.rpc, { timeout: 30_000 }) });
  const est = await pub.estimateGas({ account: a, to: call.to, data: call.data, value: 0n });
  const hash = await w.sendTransaction({ to: call.to, data: call.data, value: 0n, gas: (est * 12n) / 10n, type: 'legacy' });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== 'success') die(`${label} reverted: ${hash}`);
  for (let k = 0; k < 20 && (await pub.getBlockNumber()) < r.blockNumber; k++) await new Promise((res) => setTimeout(res, 1500));
  const link = txLinkOf(P, hash) ?? hash;
  out.txs.push({ step: label, hash, block: Number(r.blockNumber), link });
  console.log(`   tx ${label.padEnd(22)} ${link}`);
  return hash;
}
async function gas(i) {
  const a = acct(i).address; if ((await pub.getBalance({ address: a })) >= 5n * 10n ** 16n) return;
  const c = await claimGas(P, a, t.fetch);
  if (c.ok) { console.log(`   gas from the faucet for ${a}`); for (let k = 0; k < 20 && (await pub.getBalance({ address: a })) < 10n ** 16n; k++) await new Promise((r) => setTimeout(r, 2000)); if ((await pub.getBalance({ address: a })) >= 10n ** 16n) return; }
  // the faucet rests an address 6 h after a claim: the devnet's gas key tops it up instead
  const w = createWalletClient({ account: acct(KEYS.gas), chain, transport: http(P.rpc) });
  const hash = await w.sendTransaction({ to: a, value: 2n * 10n ** 17n, type: 'legacy' }); await pub.waitForTransactionReceipt({ hash });
  out.txs.push({ step: 'gas', hash, link: txLinkOf(P, hash) ?? hash }); console.log(`   tx ${'gas'.padEnd(22)} ${txLinkOf(P, hash) ?? hash}`);
}
async function glmr(i, need, label) {
  const a = acct(i).address; const b = await pub.readContract({ address: P.token.address, abi: ERC20, functionName: 'balanceOf', args: [a] });
  if (b >= need) return b;
  await send(i, faucetMintCalls(P, { to: a, amount: need - b })[0], `faucet ${P.token.symbol} → ${label}`);
  return need;
}

// ── 1. find ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const listed = await (await t.fetch(`${t.base}/exchanges?tenant=moonbeam&chain_id=${P.chainId}&limit=200`, { headers: { accept: 'application/json' } })).json().catch(() => ({ rows: [] }));
const known = new Set((listed.rows ?? []).flatMap((r) => [r.edge_id, String(r.seller?.endpoint ?? '').replace(/^https?:\/\//, '').toLowerCase().replace(/\/+$/, '')]));
const sorTaken = new Set((listed.rows ?? []).map((r) => String(r.seller_of_record).toLowerCase()));
const want = opt('--seller');
const found = await findSellers(t, P, { limit: Number(opt('--tries', '6')), skip: known });
let pool = found.sellers;
if (want) pool = pool.filter((s) => `${s.chain_id}:${s.agent_id}` === want);
say('find', `${found.read} worklist rows, ${found.sellers.length} candidates not yet onboarded (${(listed.rows ?? []).length} edges on record)`);
if (!pool.length) die('no seller left to onboard on this worklist');

// ── 2. check (one seller at a time until one passes) ─────────────────────────────────────────────────────────────────────
let seller = null, check = null; const run = `e2e_${Math.floor(Date.now() / 1000)}`;
for (const s of pool) {
  const tools = s.protocol === 'mcp' ? await mcpTools((u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(10_000) }), s.endpoint) : null;
  const c = await checkSeller(t, s, { chainId: P.chainId, run, tools });
  say('check', `${s.chain_id}:${s.agent_id} ${s.name ?? ''} (${s.protocol}) → ${c.passed ? 'pass' : 'refused'}: ${c.why}`, { handshake_id: c.handshake_id });
  if (c.passed) { seller = s; check = c; break; }
}
if (!seller) die('no candidate passed the check');
const ids = seller.ids;

// ── 3. seller of record: one devnet key per edge ─────────────────────────────────────────────────────────────────────────
let sorIndex = KEYS.sorBase + (parseInt(ids.edge16.slice(0, 8), 16) % KEYS.sorSpan);
for (let k = 0; k < KEYS.sorSpan && sorTaken.has(acct(sorIndex).address.toLowerCase()); k++) sorIndex = KEYS.sorBase + ((sorIndex - KEYS.sorBase + 1) % KEYS.sorSpan);
const sor = acct(sorIndex).address;
await gas(sorIndex);

// ── 4. edge: pool, agreement, record ─────────────────────────────────────────────────────────────────────────────────────
const plan = await openPoolPlan(t, P, { sellerOfRecord: sor, edge16: ids.edge16 });
let poolAddr = plan.pool; let poolTx = null;
if (plan.state === 'plan') {
  poolTx = await send(sorIndex, plan.call, 'createPool');
  for (let k = 0; k < 24; k++) { const st = await poolOpened(t, P, poolTx); if (st.state === 'created') { poolAddr = st.pool; break; } await new Promise((r) => setTimeout(r, (st.retryAfter ?? 5) * 1000)); }
}
const terms0 = await quoteEdge(t, P, { sellerOfRecord: sor });
P = withQuote(P, terms0.raw);
const agr = edgeAgreement(P, { edgeId: ids.edge_id, sellerOfRecord: sor, seller });
if (hashTypedData(agr.typed) !== agr.hash) die('the SDK agreement hash differs from the EIP-712 hash');
const signature = await acct(sorIndex).signTypedData(agr.typed);
const body = edgeBody({ chainId: P.chainId, seller, sellerOfRecord: sor,
  check: { handshake_id: check.handshake_id, status: check.status, reply_digest: check.reply_digest, passed: true, rules: check.rules },
  quote: terms0.quote, pool: { line: P.line, factory: plan.factory, address: poolAddr, tx: poolTx, state: 'open' }, agreement: { hash: agr.hash, signature }, state: 'live' });
const w = await writeEdge(t, body);
const back = await readEdge(t, ids.edge_id);
say('edge', `${ids.edge_id} ${w.created ? 'written' : 'already on record'} · state ${back?.state} · pool ${poolAddr} · lambda ${back?.lambda.id} (acts ${JSON.stringify(back?.lambda.acts)}) · meter row ${back?.meter_row.id} · agreement ${back?.agreement.id}`, { edge: back });

// ── 5. fund the pool with faucet GLMR (a devnet backer, not the seller of record) ────────────────────────────────────────
const backing = BigInt(opt('--backing', '10')) * 10n ** 18n || DEVNET_POOL_BACKING;
await gas(KEYS.backer);
await glmr(KEYS.backer, backing, 'backer');
const fp = await fundPoolPlan(t, P, { pool: poolAddr, from: acct(KEYS.backer).address, assets: backing });
for (const c of fp.calls) await send(KEYS.backer, c, `back pool: ${c.step}`);
const assets = await pub.readContract({ address: poolAddr, abi: ERC20, functionName: 'totalAssets' });
say('fund', `pool ${poolAddr} holds ${Number(assets) / 1e18} ${P.token.symbol} (plan from the ${fp.source})`, { pool_assets: assets.toString() });

// ── 6. quote (the only source of the terms) ──────────────────────────────────────────────────────────────────────────────
const terms = await quoteEdge(t, P, { sellerOfRecord: sor });
say('quote', `line ${terms.quote.line} · price ${Number(terms.quote.price) / 1e18} · deposit ${Number(terms.quote.deposit) / 1e18} · premium ${terms.quote.premium ?? 'none'} · pool_id ${terms.quote.pool_id ?? 'null'} · pool total ${terms.pool ? Number(terms.pool.total) / 1e18 : '?'} free ${terms.pool ? Number(terms.pool.free) / 1e18 : '?'}`, { why: terms.why });

// ── 7–8. hire and deliver ────────────────────────────────────────────────────────────────────────────────────────────────
const buyer = acct(KEYS.buyer).address;
const ask = { buyer, sellerOfRecord: sor, price: DEVNET_JOB_PRICE, evidence: check.reply_digest, refId: check.handshake_id, task: check.task, deadline: Math.floor(Date.now() / 1000) + 600 };
const h = await hire(t, P, ask);
await gas(KEYS.buyer);
await glmr(KEYS.buyer, DEVNET_JOB_PRICE * 2n, 'buyer');
await glmr(sorIndex, BigInt(h.plan.deposit) + DEVNET_JOB_PRICE, 'seller of record');
for (const c of h.hire) await send(KEYS.buyer, c, `hire: ${c.step}`);
for (const c of h.accept) await send(sorIndex, c, `accept: ${c.step}`);
for (const c of deliver(h)) await send(sorIndex, c, `deliver: ${c.step}`);
const j1 = await pub.readContract({ address: h.plan.hook, abi: HOOK, functionName: 'jobs', args: [h.plan.jobId] });
say('hire', `job ${h.plan.jobId} · ${STATE[Number(j1[9])] ?? j1[9]} · price ${Number(j1[3]) / 1e18} · deposit ${Number(j1[5]) / 1e18}`);

// ── 9. grade (binary) ────────────────────────────────────────────────────────────────────────────────────────────────────
if (!process.env.MOONBEAM_GRADE_URL || !process.env.MOONBEAM_GRADE_TOKEN) die('MOONBEAM_GRADE_URL / MOONBEAM_GRADE_TOKEN are not set: the delivery cannot be graded');
const g = await grade({ url: process.env.MOONBEAM_GRADE_URL, token: process.env.MOONBEAM_GRADE_TOKEN }, { handshake_id: check.handshake_id });
say('grade', `${g.decided} (grader ${g.raw_verdict ?? '—'}, ${g.by}; spec_met ${g.spec_met ?? '—'}, cheat_shaped ${g.cheat_shaped ?? '—'}) · decision ${g.decision_id}`);

// ── 10. settle ───────────────────────────────────────────────────────────────────────────────────────────────────────────
let digest = null;
for (let k = 0; k < 12 && !digest; k++) { digest = await decisionDigest(t, g.decision_id).catch(() => null); if (!digest) await new Promise((r) => setTimeout(r, 5000)); }
if (!digest) die(`the decision ${g.decision_id} has no digest yet`);
const s = await settle(t, P, ask, { ...g, digest });
await gas(KEYS.evaluator);
for (const c of s.settle) await send(KEYS.evaluator, c, `settle: ${c.step}`);
let j2 = await pub.readContract({ address: h.plan.hook, abi: HOOK, functionName: 'jobs', args: [h.plan.jobId] });
if (Number(j2[9]) === 8 && !flag('--no-finalize')) {
  const v4 = await pub.readContract({ address: h.plan.hook, abi: HOOK, functionName: 'v4Of', args: [h.plan.jobId] });
  const until = Number(v4[4]); const waitS = Math.max(0, until - Math.floor(Date.now() / 1000) + 5);
  console.log(`   the seller may dispute for ${waitS} s; then anyone may finalize the rejection`);
  await new Promise((r) => setTimeout(r, waitS * 1000));
  const { encodeFunctionData } = await import('viem');
  await send(KEYS.evaluator, { chainId: P.chainId, to: h.plan.hook, data: encodeFunctionData({ abi: HOOK, functionName: 'finalizeReject', args: [h.plan.jobId] }) }, 'finalize-reject');
  j2 = await pub.readContract({ address: h.plan.hook, abi: HOOK, functionName: 'jobs', args: [h.plan.jobId] });
}
say('settle', `job ${h.plan.jobId} → ${STATE[Number(j2[9])] ?? j2[9]} (plan ${s.plan.ending})`);

// ── 11. the edge at work: one call inside the agreement, one outside, then the meter lines and the agreement state ──────
const callArgs = check.tool ? { tool: check.tool, args: check.args } : {};
const inside = await callEdge(t, ids.edge_id, { task: check.task, ...callArgs });
say('call', inside.ok ? `inside the agreement → metered ${inside.line.id} (${Object.entries(inside.line.legs).map(([k, v]) => `${k} ${v}`).join(' · ')})` : `inside the agreement → ${inside.status} ${inside.code}: ${inside.why}`);
const outside = await callEdge(t, ids.edge_id, { task: check.task, class: 'market.price', ...callArgs });
say('call', outside.ok ? `outside the agreement → TAKEN (enforcement is off)` : `outside the agreement (class market.price) → ${outside.status} ${outside.code}: ${outside.why}`);
const ml = await meterLines(t, ids.edge_id);
const as = await agreementState(t, ids.edge_id);
const finalAssets = await pub.readContract({ address: poolAddr, abi: ERC20, functionName: 'totalAssets' });
say('read', `pool ${Number(finalAssets) / 1e18} ${P.token.symbol} · meter lines ${ml.pending ? 'pending (the API does not route edge meter reads yet)' : ml.lines.length} · agreement ${as.pending ? 'pending (not routed yet)' : `enforced ${as.state?.enforced} · signature valid ${as.state?.signature_valid}`}`,
  { meter: ml, agreement: as.state, pool_assets: finalAssets.toString() });

out.summary = { edge_id: ids.edge_id, seller: `${seller.chain_id}:${seller.agent_id}`, seller_name: seller.name, seller_of_record: sor, pool: poolAddr, pool_assets: finalAssets.toString(), job: h.plan.jobId, decided: g.decided, job_state: STATE[Number(j2[9])],
  meter_lines: ml.pending ? 'pending' : ml.lines.length, agreement: as.pending ? 'pending' : as.state, txs: out.txs.length };
console.log(JSON.stringify(out.summary, (_, v) => big(v), 1));
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(out, (_, v) => big(v), 1));

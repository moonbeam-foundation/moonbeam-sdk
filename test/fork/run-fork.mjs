#!/usr/bin/env node
// Every write path of the SDK, sent on a local fork of Base (anvil --fork-url, the fork's endpoint from warmbed's rotation).
// Nothing reaches Base itself: the fork is a local copy, its transactions exist only in it. Needs `anvil` (Foundry) and a
// build (npm run build). Prints one line per step with the fork's tx hash, and writes the evidence as JSON.
//   npm run build && node test/fork/run-fork.mjs [--out evidence.json] [--fork-url <url>] [--keep]
//
//   1. a covered GLMR job on the live hook: the seller approves its deposit, the buyer approves price + premium and funds
//      it against pool #1, the seller submits, the buyer completes; then settleAttested's call lands on the decision log
//   2. a grade's record on Base: JevAnswerLog.record + JevDecisionLog.record (the stamp registry is missing on Base, said)
//   3. a resale: quoteSale prices the wall, the child signs the x402 EIP-3009 typed data, USDC's transferWithAuthorization
//      executes it on the fork (the signature verifies on chain), and attestSale's call lands on the decision log
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, createTestClient, http, decodeEventLog, parseAbi, parseSignature, verifyTypedData, numberToHex, pad, keccak256, encodeAbiParameters } from 'viem';
import { mnemonicToAccount, privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { base } from 'viem/chains';
import { baseReader } from '@moonbeam-foundation/sdk/rpc';
import { fundCalls, sellerDepositCalls, submitCalls, settleCalls, coverPremium, jobIdOf } from '@moonbeam-foundation/sdk/onboard';
import { settleAttested, hookQuote, readJob } from '@moonbeam-foundation/sdk/assurance';
import { gradeJob, recordGrade } from '@moonbeam-foundation/sdk/judge';
import { quoteSale, attestSale } from '@moonbeam-foundation/sdk/resale';
import { transferAuthorization, paymentHeader, baseAccept } from '@moonbeam-foundation/sdk/x402';
import { REGISTRY, MOONBEAM_COVERAGE_POOLS } from '../../dist/acp/moonbeam-acp.generated.js';
import { CLEAN } from '../../examples/data/answers.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const PORT = Number(process.env.FORK_PORT ?? 8547);
const RPC = `http://127.0.0.1:${PORT}`;
const forkUrl = arg('--fork-url') ?? (await baseReader().urls('call')).find((u) => !/127\.0\.0\.1|localhost/.test(u));
const evidence = { forkedFrom: new URL(forkUrl).host, startedAt: new Date().toISOString(), steps: [] };
const log = (step, o) => { evidence.steps.push({ step, ...o }); console.log(`${o.ok === false ? 'FAIL' : 'ok  '} ${step}${o.tx ? ` · tx ${o.tx}` : ''}${o.note ? ` · ${o.note}` : ''}`); if (o.ok === false) failed++; };
let failed = 0;

const anvil = spawn('anvil', ['--fork-url', forkUrl, '--port', String(PORT), '--silent', '--chain-id', '8453'], { stdio: 'ignore' });
const stop = () => { if (!process.argv.includes('--keep')) anvil.kill('SIGTERM'); };
process.on('exit', stop);
const pub = createPublicClient({ chain: base, transport: http(RPC) });
for (let i = 0; i < 60; i++) { try { await pub.getChainId(); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const forkBlock = await pub.getBlockNumber();
evidence.forkBlock = Number(forkBlock);
console.log(`fork of Base from ${evidence.forkedFrom} at block ${forkBlock} on ${RPC}`);
const test = createTestClient({ chain: base, mode: 'anvil', transport: http(RPC) });
const MN = 'test test test test test test test test test test test junk'; // anvil's public development mnemonic
const buyer = mnemonicToAccount(MN, { addressIndex: 0 });
// the child is a fresh key made for this run: anvil's well-known addresses carry EIP-7702 code on Base, and USDC then
// checks an ERC-1271 signature instead of the ECDSA one
const child = privateKeyToAccount(generatePrivateKey());
const wallet = (account) => createWalletClient({ chain: base, transport: http(RPC), account });

/** send one SDK unsigned call from `from` (an anvil key, or an impersonated address) and wait for its receipt */
async function send(from, c) {
  const impersonated = typeof from === 'string';
  if (impersonated) { await test.impersonateAccount({ address: from }); await test.setBalance({ address: from, value: 10n ** 18n }); }
  const w = impersonated ? createWalletClient({ chain: base, transport: http(RPC), account: from }) : wallet(from);
  const hash = await w.sendTransaction({ to: c.to, data: c.data, value: 0n, chain: base, account: impersonated ? from : from });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (impersonated) await test.stopImpersonatingAccount({ address: from });
  if (r.status !== 'success') throw new Error(`${c.fn ?? c.step} reverted (${hash})`);
  return r;
}
/** an ERC-20 balance written straight into the fork's storage (GLMR keeps balances at slot 0, USDC at slot 9) */
async function deal(token, who, amount, slot) {
  const key = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [who, BigInt(slot)]));
  await test.setStorageAt({ address: token, index: key, value: pad(numberToHex(amount), { size: 32 }) });
}
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)']);
const LOG = parseAbi([
  'event Decided(bytes32 indexed subject, bytes32 indexed kind, address indexed recorder, uint256 index, bytes32 digest, uint16 confidenceBps, string model, string uri)',
  'event JevAnswered(address indexed recorder, bytes32 indexed useCase, bytes32 indexed subject, bytes32 inputDigest, bytes32 answersDigest, bytes32 decisionDigest, string model, string uri, uint256 timestamp, bool trusted)',
  'function count(bytes32 subject) view returns (uint256)',
]);
const HOOK_ABI = parseAbi(['function jobs(bytes32) view returns (address buyer,address seller,address token,uint256 price,uint256 premium,uint256 deposit,uint64 deadline,uint64 challengeWindow,address pool,uint8 state)']);
const bal = (token, who) => pub.readContract({ address: token, abi: ERC20, functionName: 'balanceOf', args: [who] });
const decodedOf = (r) => r.logs.map((l) => { try { return decodeEventLog({ abi: LOG, data: l.data, topics: l.topics }); } catch { return null; } }).filter(Boolean);

/** send an attestation's calls; check each Decided lands and the subject's count grows */
async function landAttestation(step, a, from) {
  const subjectBefore = await pub.readContract({ address: REGISTRY.decisionLog, abi: LOG, functionName: 'count', args: [a.mark.subject] });
  for (const c of a.calls) {
    const r = await send(from, c);
    const ev = decodedOf(r).map((e) => e.eventName);
    log(`${step}: ${c.fn}`, { tx: r.transactionHash, block: Number(r.blockNumber), events: ev, ok: ev.length > 0 });
  }
  const subjectAfter = await pub.readContract({ address: REGISTRY.decisionLog, abi: LOG, functionName: 'count', args: [a.mark.subject] });
  log(`${step}: the decision log holds the mark`, { subject: a.mark.subject, digest: a.mark.digest, before: Number(subjectBefore), after: Number(subjectAfter), ok: subjectAfter === subjectBefore + 1n });
  if (a.missing.length) log(`${step}: missing on Base (said, not faked)`, { missing: a.missing.map((m) => `${m.contract}@${m.chainId}`), note: a.missing.map((m) => m.contract).join(', ') });
}

try {
  // ── 1. a covered GLMR job on the live hook, then its settle attested ─────────────────────────────────────────────
  const pool = MOONBEAM_COVERAGE_POOLS[0];
  const seller = /seller (0x[0-9a-fA-F]{40})/.exec(pool.note)[1];
  const now = Number((await pub.getBlock()).timestamp);
  const terms = { chainId: 8453, jobContract: REGISTRY.hook, token: REGISTRY.glmr, buyer: buyer.address, seller, price: 10n * 10n ** 18n, deadline: now + 86_400, deposit: 12n * 10n ** 18n, premium: null, task: 'fork run: summarise one block', skills: [] };
  const premium = coverPremium(terms.price, { k: 19, n: 20 });
  await deal(REGISTRY.glmr, buyer.address, 100n * 10n ** 18n, 0);
  await deal(REGISTRY.glmr, seller, 100n * 10n ** 18n, 0);
  const jobId = jobIdOf(terms);
  for (const c of sellerDepositCalls(terms)) log('covered job: seller approves its deposit', { tx: (await send(seller, c)).transactionHash });
  const [approve, fund] = fundCalls(terms, { pool: pool.address, premium });
  log('covered job: buyer approves price + premium', { tx: (await send(buyer, approve)).transactionHash });
  const funded = await send(buyer, fund);
  log('covered job: fundJob against pool #1', { tx: funded.transactionHash, jobId, premium: premium.toString(), pool: pool.address });
  const sellerBefore = await bal(REGISTRY.glmr, seller);
  const evidenceDigest = keccak256('0x01');
  for (const c of submitCalls({ jobId, evidenceDigest, correlator: evidenceDigest })) log('covered job: seller submits', { tx: (await send(seller, c)).transactionHash });
  for (const c of settleCalls(jobId, 'completed')) log('covered job: buyer completes', { tx: (await send(buyer, c)).transactionHash });
  const j = await pub.readContract({ address: REGISTRY.hook, abi: HOOK_ABI, functionName: 'jobs', args: [jobId] });
  const sellerGot = (await bal(REGISTRY.glmr, seller)) - sellerBefore;
  log('covered job: the hook paid the seller price + deposit', { state: Number(j[9]), sellerGot: sellerGot.toString(), ok: sellerGot === terms.price + terms.deposit && Number(j[9]) === 3 });
  const trail = readJob([1, 2, Number(j[9])].map((hookState) => ({ name: 'hook', hookState }))); // Funded → Submitted → what the hook reads now
  if (!trail.ok) throw new Error(trail.error);
  const s = settleAttested({ venue: 'moonbeam', ctx: { lane: 'hook', hook: 'V3' }, chainId: 8453, jobId, buyer: buyer.address, seller, evaluator: null, terms: null, clock: {}, state: trail.state, path: trail.path },
    hookQuote({ price: terms.price, premium, deposit: terms.deposit, covered: true }));
  if (!s.ok) throw new Error(s.why.join('; '));
  log('covered job: settleAttested', { ending: s.ending.id, legs: Object.fromEntries(Object.entries(s.legs).map(([k, v]) => [k, v.toString()])), ok: s.legs.seller === sellerGot });
  await landAttestation('settle attested', s.attest, buyer);

  // ── 2. a grade's record on Base ─────────────────────────────────────────────────────────────────────────────────
  const receipt = await gradeJob({ jobId, evidence: 'the summary of one block', answers: CLEAN, model: 'jev-1.13.0' });
  const rec = await recordGrade(receipt);
  log('grade: recordGrade, Base by default', { networks: rec.networks, calls: rec.calls.map((c) => c.fn), missing: rec.missing.map((m) => `${m.contract}@${m.chainId}`) });
  for (const c of rec.calls) {
    const r = await send(buyer, c);
    const ev = decodedOf(r);
    log(`grade: ${c.fn}`, { tx: r.transactionHash, events: ev.map((e) => e.eventName + (e.eventName === 'JevAnswered' ? `(trusted=${e.args.trusted})` : '')), ok: ev.length > 0 });
  }

  // ── 3. a resale: quote → x402 payment on Base → attested ───────────────────────────────────────────────────────
  const wall = { x402Version: 2, accepts: [{ scheme: 'exact', network: 'eip155:8453', asset: REGISTRY.usdc, payTo: process.env.X402_PAY_TO ?? '0x3574999dd4c96eB73Bd6e11D4177010C83E14f5b', maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } }] };
  const q = quoteSale({ venue_in: 'x402-base', venue_out: 'x402-base', seller_price: 9207n });
  if (!q.ok) throw new Error(q.why);
  const accept = { ...baseAccept(wall), amount: String(q.price_to_buyer) };
  log('resale: quoteSale prices the wall', { seller_price: '9207', price_to_buyer: String(q.price_to_buyer) });
  const typed = transferAuthorization(accept, { from: child.address, now: Number((await pub.getBlock()).timestamp) });
  const signature = await child.signTypedData(typed);
  const okOffline = await verifyTypedData({ address: child.address, ...typed, signature });
  log('x402: the typed data verifies offline (viem)', { ok: okOffline });
  const header = paymentHeader(accept, typed.message, signature);
  await deal(REGISTRY.usdc, child.address, 1_000_000n, 9);
  const payToBefore = await bal(REGISTRY.usdc, accept.payTo);
  const { v, r, s: ss } = parseSignature(signature);
  const m = typed.message;
  const hash = await wallet(buyer).writeContract({ address: REGISTRY.usdc, abi: ERC20, functionName: 'transferWithAuthorization', args: [m.from, m.to, BigInt(m.value), BigInt(m.validAfter), BigInt(m.validBefore), m.nonce, Number(v), r, ss] });
  const paid = await pub.waitForTransactionReceipt({ hash });
  const payToGot = (await bal(REGISTRY.usdc, accept.payTo)) - payToBefore;
  log('x402: USDC.transferWithAuthorization executes the signature on the fork', { tx: hash, status: paid.status, paid: payToGot.toString(), header: `${header.slice(0, 24)}…`, ok: paid.status === 'success' && payToGot === BigInt(m.value) });
  const saleKey = `fork_${forkBlock}_${m.nonce.slice(2, 12)}`;
  await landAttestation('resale paid, attested', attestSale({ saleKey, step: 'paid', quote: q, tx: hash, contract: accept.payTo }), buyer);
} catch (e) {
  log('fork run', { ok: false, note: e.message });
}
evidence.failed = failed;
const out = arg('--out'); if (out) writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
console.log(failed ? `${failed} step(s) failed` : `all ${evidence.steps.length} steps ok on the fork (nothing reached Base)`);
stop();
process.exit(failed ? 1 : 0);

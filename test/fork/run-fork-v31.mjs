#!/usr/bin/env node
// Both hook rules on one local fork of Base: the SDK reads which rules the hook runs, plans and sends a covered GLMR job on
// the live V3 hook, then the fork (only the fork) is upgraded to V3.1 exactly as the unsigned upgrade package does it, and the
// same SDK calls plan and send a covered job under the V3.1 rules: the seller's funder approval, no buyer reject, the review
// window and claimAutoComplete. Nothing reaches Base: the fork is a local copy, and the upgrade is sent from the hook owner's
// address impersonated inside the fork. Needs `anvil` (Foundry), a build (npm run build) and the V3.1 package's plan.json:
//   npm run build && node test/fork/run-fork-v31.mjs --plan <moonbeam-protocol>/contracts-deploy/upgrades/2026-11-hook-v3-1/plan.json [--fork-url <url>] [--out evidence.json]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, createTestClient, http, parseAbi, numberToHex, pad, keccak256, encodeAbiParameters, encodeFunctionData } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { baseReader } from '@moonbeam-foundation/sdk/rpc';
import { readHook, planFunding, fundCalls, sellerDepositCalls, submitCalls, settleCalls, autoCompleteCalls, revokeFunderCalls, coverPremium } from '@moonbeam-foundation/sdk/onboard';
import { REGISTRY, MOONBEAM_COVERAGE_POOLS } from '../../dist/acp/moonbeam-acp.generated.js';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const planPath = arg('--plan') ?? process.env.V31_PLAN;
if (!planPath) { console.error('pass --plan <…/2026-11-hook-v3-1/plan.json>'); process.exit(2); }
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const deployTx = plan.implementation.deployTx;
const IMPL = plan.implementation.address;
const PORT = Number(process.env.FORK_PORT ?? 8548);
const RPC = `http://127.0.0.1:${PORT}`;
const forkUrl = arg('--fork-url') ?? (await baseReader().urls('call')).find((u) => !/127\.0\.0\.1|localhost/.test(u));
const evidence = { forkedFrom: new URL(forkUrl).host, startedAt: new Date().toISOString(), impl: IMPL, steps: [] };
let failed = 0;
const log = (step, o = {}) => { evidence.steps.push({ step, ...o }); console.log(`${o.ok === false ? 'FAIL' : 'ok  '} ${step}${o.tx ? ` · tx ${o.tx}` : ''}${o.note ? ` · ${o.note}` : ''}`); if (o.ok === false) failed++; };
const check = (step, cond, o = {}) => log(step, { ...o, ok: Boolean(cond) });

const anvil = spawn('anvil', ['--fork-url', forkUrl, '--port', String(PORT), '--silent', '--chain-id', '8453', '--no-storage-caching'], { stdio: 'ignore' });
const stop = () => anvil.kill('SIGTERM');
process.on('exit', stop);
const pub = createPublicClient({ chain: base, transport: http(RPC) });
for (let i = 0; i < 60; i++) { try { await pub.getChainId(); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
evidence.forkBlock = Number(await pub.getBlockNumber());
console.log(`fork of Base from ${evidence.forkedFrom} at block ${evidence.forkBlock} on ${RPC}`);
const test = createTestClient({ chain: base, mode: 'anvil', transport: http(RPC) });
const reader = baseReader({ urls: [RPC], warmbed: false });
const buyer = mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex: 3 }); // anvil's public dev mnemonic

async function send(from, c) {
  const imp = typeof from === 'string';
  if (imp) { await test.impersonateAccount({ address: from }); await test.setBalance({ address: from, value: 10n ** 18n }); }
  else await test.setBalance({ address: from.address, value: 10n ** 18n });
  const w = createWalletClient({ chain: base, transport: http(RPC), account: from });
  const hash = await w.sendTransaction({ to: c.to, data: c.data, value: 0n, chain: base, account: from, ...(c.gas ? { gas: BigInt(c.gas) } : {}) });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (imp) await test.stopImpersonatingAccount({ address: from });
  if (r.status !== 'success') throw new Error(`${c.step} reverted (${hash})`);
  return r;
}
/** a call that must revert on chain: eth_call from `from`, true when it reverts */
async function reverts(from, c) {
  try { await pub.call({ account: typeof from === 'string' ? from : from.address, to: c.to, data: c.data }); return false; } catch { return true; }
}
const refused = (f) => { try { f(); return null; } catch (e) { return e.message; } };
async function deal(token, who, amount) { // GLMR keeps balances at slot 0
  const key = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [who, 0n]));
  await test.setStorageAt({ address: token, index: key, value: pad(numberToHex(amount), { size: 32 }) });
}
const HOOK = parseAbi(['function owner() view returns (address)', 'function upgradeToAndCall(address,bytes)', 'function initializeV31(address)', 'function jobs(bytes32) view returns (address,address,address,uint256,uint256,uint256,uint64,uint64,address,uint8)']);
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const bal = (who) => pub.readContract({ address: REGISTRY.glmr, abi: ERC20, functionName: 'balanceOf', args: [who] });
const stateOf = async (id) => Number((await pub.readContract({ address: REGISTRY.hook, abi: HOOK, functionName: 'jobs', args: [id] }))[9]);

/** one covered job through the SDK, on whichever rules the hook reads */
async function coveredJob(label, poolRow, task) {
  const seller = /seller (0x[0-9a-fA-F]{40})/.exec(poolRow.note)[1];
  const now = Number((await pub.getBlock()).timestamp);
  const terms = { chainId: 8453, jobContract: REGISTRY.hook, token: REGISTRY.glmr, buyer: buyer.address, seller, price: 10n * 10n ** 18n, deadline: now + 7 * 86_400, deposit: 12n * 10n ** 18n, premium: null, task, skills: [] };
  const premium = coverPremium(terms.price, { k: 19, n: 20 });
  await deal(REGISTRY.glmr, buyer.address, 100n * 10n ** 18n); await deal(REGISTRY.glmr, seller, 100n * 10n ** 18n);
  const p = await planFunding(reader, terms, { pool: poolRow.address, premium, gradeWindow: 3600 });
  log(`${label}: planFunding reads the rules`, { rules: p.rules, seller: p.seller.map((c) => c.step), buyer: p.buyer.map((c) => c.step), jobId: p.jobId });
  return { seller, terms, premium, p };
}

try {
  // ── 1. the live V3 hook ─────────────────────────────────────────────────────────────────────────────────────────────
  const f3 = await readHook(reader, {});
  check('V3: readHook reads the live hook as V3', f3.rules === 'v3' && f3.maxDeadline === null, { rules: f3.rules });
  const a = await coveredJob('V3', MOONBEAM_COVERAGE_POOLS[0], 'fork run V3: summarise one block');
  check('V3: the seller signs only its deposit approval', a.p.seller.map((c) => c.step).join() === 'approve-deposit');
  for (const c of a.p.seller) log('V3: seller approves its deposit', { tx: (await send(a.seller, c)).transactionHash });
  for (const c of a.p.buyer) log(`V3: buyer ${c.step}`, { tx: (await send(buyer, c)).transactionHash });
  for (const c of submitCalls({ jobId: a.p.jobId, evidenceDigest: keccak256('0x01'), correlator: keccak256('0x01') })) log('V3: seller submits', { tx: (await send(a.seller, c)).transactionHash });
  const j3 = (await readHook(reader, { jobId: a.p.jobId })).job;
  check('V3: the job reads V3 rules, Submitted, no window', j3.rules === 'v3' && j3.state === 'Submitted' && j3.autoCompleteAt === null);
  const rej3 = settleCalls(a.p.jobId, 'rejected', keccak256('0x02'), { job: j3 });
  check('V3: the buyer reject is built and the chain accepts it (eth_call)', !(await reverts(buyer, rej3[0])));
  const sellerBefore3 = await bal(a.seller);
  for (const c of settleCalls(a.p.jobId, 'completed', undefined, { job: j3 })) log('V3: buyer completes', { tx: (await send(buyer, c)).transactionHash });
  check('V3: completed, seller paid price + deposit', (await stateOf(a.p.jobId)) === 3 && (await bal(a.seller)) - sellerBefore3 === a.terms.price + a.terms.deposit);
  const wrong = await planFunding(reader, { ...a.terms, task: 'wrong pool' }, { pool: MOONBEAM_COVERAGE_POOLS[1].address, premium: a.premium }).then(() => null, (e) => e.message);
  check('V3: a pool that is not the factory’s pool for this seller is refused before any call', /not the factory's pool/.test(wrong ?? ''), { note: wrong ?? 'not refused' });

  // ── 2. upgrade the FORK to V3.1, as the package does (deploy tx, then upgradeToAndCall from the hook's owner) ────────
  const deployed = await send(buyer, { to: deployTx.to, data: deployTx.data, step: 'deploy V3.1 implementation', gas: deployTx.gasLimitBudget });
  const code = await pub.getCode({ address: IMPL });
  check('fork: the V3.1 implementation is at the package’s CREATE2 address', code && code.length > 2 && keccak256(code) === plan.implementation.runtimeBytecodeKeccak, { tx: deployed.transactionHash });
  const owner = await pub.readContract({ address: REGISTRY.hook, abi: HOOK, functionName: 'owner' });
  const upgrade = encodeFunctionData({ abi: HOOK, functionName: 'upgradeToAndCall', args: [IMPL, encodeFunctionData({ abi: HOOK, functionName: 'initializeV31', args: [REGISTRY.poolFactory] })] });
  log('fork: the hook owner (impersonated in the fork only) upgrades the hook', { tx: (await send(owner, { to: REGISTRY.hook, data: upgrade, step: 'upgradeToAndCall' })).transactionHash, owner });

  // ── 3. the V3.1 hook ────────────────────────────────────────────────────────────────────────────────────────────────
  const f31 = await readHook(reader, {});
  check('V3.1: readHook reads the upgraded hook as V3.1', f31.rules === 'v3.1' && f31.maxDeadline === 365 * 86_400 && f31.poolFactory.toLowerCase() === REGISTRY.poolFactory.toLowerCase(), { rules: f31.rules });
  const b = await coveredJob('V3.1', MOONBEAM_COVERAGE_POOLS[0], 'fork run V3.1: summarise one block');
  check('V3.1: the seller signs its deposit approval and approveFunder(buyer)', b.p.seller.map((c) => c.step).join() === 'approve-deposit,approve-funder');
  // the funding without the seller's funder approval is refused by the hook itself
  for (const c of sellerDepositCalls(b.terms, { rules: 'v3' })) await send(b.seller, c);
  await send(buyer, b.p.buyer[0]);
  check('V3.1: without approveFunder the hook refuses the funding', await reverts(buyer, b.p.buyer[1]));
  for (const c of b.p.seller) log(`V3.1: seller ${c.step}`, { tx: (await send(b.seller, c)).transactionHash });
  for (const c of b.p.buyer) log(`V3.1: buyer ${c.step}`, { tx: (await send(buyer, c)).transactionHash });
  for (const c of submitCalls({ jobId: b.p.jobId, evidenceDigest: keccak256('0x03'), correlator: keccak256('0x03') })) log('V3.1: seller submits', { tx: (await send(b.seller, c)).transactionHash });
  const j31 = (await readHook(reader, { jobId: b.p.jobId })).job;
  check('V3.1: the job reads V3.1 rules with a 1 h review window', j31.rules === 'v3.1' && j31.window === 3600 && j31.autoCompleteAt === j31.submittedAt + 3600);
  const noReject = refused(() => settleCalls(b.p.jobId, 'rejected', keccak256('0x04'), { job: j31 }));
  check('V3.1: the SDK builds no buyer reject', /buyer has no reject/.test(noReject ?? ''), { note: noReject ?? 'built' });
  const raw = settleCalls(b.p.jobId, 'rejected', keccak256('0x04'), { job: { ...j31, rules: 'v3' } })[0]; // the V3 bytes, forced
  check('V3.1: and the hook refuses a buyer reject on chain', await reverts(buyer, raw));
  const noExpire = refused(() => settleCalls(b.p.jobId, 'expired', undefined, { job: j31 }));
  check('V3.1: a delivered job is not offered expire', /does not expire/.test(noExpire ?? ''));
  const tOpen = Number((await pub.getBlock()).timestamp);
  const early = refused(() => autoCompleteCalls(j31, tOpen));
  check('V3.1: claimAutoComplete is refused while the window is open', /open until/.test(early ?? ''));
  await test.increaseTime({ seconds: 3601 }); await test.mine({ blocks: 1 });
  const after = await readHook(reader, { jobId: b.p.jobId });
  const sellerBefore31 = await bal(b.seller);
  for (const c of autoCompleteCalls(after.job, after.blockTime)) log('V3.1: anyone sends claimAutoComplete after the window', { tx: (await send(buyer, c)).transactionHash });
  check('V3.1: completed, seller paid price + deposit', (await stateOf(b.p.jobId)) === 3 && (await bal(b.seller)) - sellerBefore31 === b.terms.price + b.terms.deposit);
  for (const c of revokeFunderCalls(buyer.address)) log('V3.1: seller revokes the funder approval', { tx: (await send(b.seller, c)).transactionHash });
  const again = await readHook(reader, { seller: b.seller, funder: buyer.address });
  check('V3.1: the approval reads revoked', again.funderApproved === false);
  const far = refused(() => fundCalls({ ...b.terms, deadline: after.blockTime + 366 * 86_400 }, { pool: MOONBEAM_COVERAGE_POOLS[0].address, registeredPool: MOONBEAM_COVERAGE_POOLS[0].address, premium: b.premium, rules: 'v3.1', now: after.blockTime }));
  check('V3.1: a deadline more than 365 days out is refused', /365 days/.test(far ?? ''));
} catch (e) {
  log('fork run', { ok: false, note: e.message });
}
evidence.failed = failed;
const out = arg('--out'); if (out) writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
console.log(failed ? `${failed} step(s) failed` : `all ${evidence.steps.length} steps ok on the fork (nothing reached Base)`);
stop();
process.exit(failed ? 1 : 0);

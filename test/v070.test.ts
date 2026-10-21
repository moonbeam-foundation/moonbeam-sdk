// 0.7.0: what the release adds or fixes, offline. Every encoding is pinned against viem (or a recorded eth_call on Base);
// the live reads are in test/live.test.ts (LIVE=1) and the writes on a Base fork in test/fork/run-fork.mjs.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hashTypedData, recoverTypedDataAddress, encodeFunctionData, parseAbi, encodeEventTopics, encodeAbiParameters, parseAbiParameters, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { premiumAmount, wilsonUpperFailure } from '@taifoon/jev-wilson';
import { baseAccept, transferAuthorization, paymentHeader, x402Of, X402_BASE_NETWORK } from '../src/x402/index.js';
import { readProof, proofRef, parseProofRef, verifyCall, verifyOnBase, V5_VERIFIER, type ProofBlob } from '../src/proof/index.js';
import * as arb from '../src/arbitration/index.js';
import { baseReader, RpcReverted } from '../src/rpc/index.js';
import { attest, MOONBEAM_ATTEST_NETWORKS } from '../src/attest/index.js';
import { settleAttested, hookQuote, readJob, attest as assuranceAttest } from '../src/assurance/index.js';
import { quoteSale, quoteBase, attestSale } from '../src/resale/index.js';
import { gradeJob, recordGrade, STAMP_VERDICT_OF } from '../src/judge/index.js';
import { coverPremium, sellerDepositCalls, fundCalls, readinessForClient, readiness, DEFAULT_GUARD } from '../src/onboard/index.js';
import { poolsOpenOn, depositCalls as poolDeposit, PoolsNotOpenError } from '../src/pools/index.js';
import { REGISTRY, MOONBEAM_COVERAGE_POOLS } from '../src/acp/moonbeam-acp.generated.js';
// @ts-expect-error: the examples' plain .mjs data, no types
import { CLEAN } from '../examples/data/answers.mjs';

const fx = (p: string) => JSON.parse(readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8'));
const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const; // a test key, nothing on it
const ROUTER = '0x00000000000000000000000000000000000000ab';
const J = `0x${'ab'.repeat(32)}`;
const D = `0x${'cd'.repeat(32)}`;

describe('x402 on Base: the EIP-3009 typed data, signed and recovered', () => {
  const wall = { ok: false, x402: { x402Version: 2, accepts: [
    { scheme: 'exact', network: 'eip155:42161', amount: '11509', asset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', payTo: '0x3574999dd4c96eB73Bd6e11D4177010C83E14f5b', maxTimeoutSeconds: 300 },
    { scheme: 'exact', network: 'eip155:8453', amount: '11509', asset: REGISTRY.usdc, payTo: '0x3574999dd4c96eB73Bd6e11D4177010C83E14f5b', maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } },
  ] } };
  it('picks the Base entry, refuses a wall without one', () => {
    expect(baseAccept(wall).network).toBe(X402_BASE_NETWORK);
    expect(() => baseAccept({ x402: { x402Version: 2, accepts: [wall.x402.accepts[0]] } })).toThrow(/no exact payment on Base/);
    expect(() => x402Of({})).toThrow(/accepts/);
  });
  it('the typed data is USDC\'s TransferWithAuthorization on Base; a signature over it recovers the payer', async () => {
    const a = baseAccept(wall); const acct = privateKeyToAccount(KEY);
    const t = transferAuthorization(a, { from: acct.address, nonce: D, now: 1_000 });
    expect(t.domain).toEqual({ name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: REGISTRY.usdc });
    expect(t.message).toMatchObject({ to: a.payTo, value: '11509', validAfter: '0', validBefore: '1300', nonce: D });
    // the domain separator equals USDC's on Base (DOMAIN_SEPARATOR() read 2026-10-14)
    expect(keccak256(encodeAbiParameters(parseAbiParameters('bytes32,bytes32,bytes32,uint256,address'), [keccak256(toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')), keccak256(toBytes('USD Coin')), keccak256(toBytes('2')), 8453n, REGISTRY.usdc]))).toBe('0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f');
    const sig = await acct.signTypedData(t as never);
    expect(await recoverTypedDataAddress({ ...(t as unknown as Record<string, unknown>), signature: sig } as never)).toBe(acct.address);
    const h = JSON.parse(Buffer.from(paymentHeader(a, t.message, sig), 'base64').toString('utf8'));
    // 0.8.0: x402 v2 carries the accepted entry whole (the wall refused 0.7.0's top-level scheme/network: "accepted.scheme must be exact")
    expect(h).toEqual({ x402Version: 2, accepted: a, payload: { signature: sig, authorization: t.message } });
    expect(JSON.parse(Buffer.from(paymentHeader(a, t.message, sig, 1), 'base64').toString('utf8'))).toEqual({ x402Version: 1, scheme: 'exact', network: 'eip155:8453', payload: { signature: sig, authorization: t.message } });
    expect(hashTypedData(t as never)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('proofs: the ref, and the verifier call that Base answered true', () => {
  const p = fx('proof/base-tx-52587000.json'); const v = fx('proof/base-tx-52587000.verify.json');
  it('verifyCall(blob) is byte for byte the call the V5 verifier on Base returned true for', () => {
    const c = verifyCall(p.blob as ProofBlob);
    expect(c.to).toBe('0x2D475a53eAA8F9AC78B69bD2429275a622C644f8');
    expect(V5_VERIFIER).toBe(c.to);
    expect(c.data).toBe(v.calldata);
    expect(c.boundAt.blockNumber).toBe(p.blob.blockProof.inclusion.tipBlockNumber);
  });
  it('readProof reads /proof/tx/8453/<tx>, says proven only when every check holds, and names the ref', async () => {
    const t = { base: '/v1', fetch: async () => ({ ok: true, status: 200, json: async () => p }) } as never;
    const r = await readProof(t, p.tx);
    expect(r.proven).toBe(true);
    expect(r.ref).toBe(`v5:8453:${p.tx}@0x${p.super_root_hash}`);
    expect(parseProofRef(r.ref!)).toEqual({ chainId: 8453, tx: p.tx, superroot: `0x${p.super_root_hash}` });
    expect(proofRef(parseProofRef(r.ref!))).toBe(r.ref);
    await expect(readProof(t, '0x12')).rejects.toThrow(/0x \+ 64 hex/);
    const notYet = { base: '/v1', fetch: async () => ({ ok: true, status: 200, json: async () => ({ ...p, checks: { ...p.checks, within_verifiable_range: false } }) }) } as never;
    expect((await readProof(notYet, p.tx)).proven).toBe(false);
  });
  it('verifyOnBase reports true, a verifier error by name, and that no superroot anchor is set', async () => {
    const reader = (answer: (to: string, data: string) => string | Error) => ({ chainId: 8453 as const, urls: async () => [], call: async (_m: string, [c]: [{ to: string; data: string }]) => { const a = answer(c.to, c.data); if (a instanceof Error) throw a; return a; } }) as never;
    const ok = await verifyOnBase(reader((_to, data) => (data.startsWith('0x') && data.length === 10 ? `0x${'0'.repeat(64)}` : v.eth_call_result)), p.blob);
    expect(ok).toMatchObject({ verified: true, error: null, anchored: false, inclusion: 'served' });
    const bad = await verifyOnBase(reader((_to, data) => (data.length === 10 ? `0x${'0'.repeat(64)}` : new RpcReverted('execution reverted', '0xd3137376'))), p.blob);
    expect(bad).toMatchObject({ verified: false, error: 'L3_SuperrootPathInvalid' });
  });
});

describe('arbitration: the router\'s calls, its EIP-712 verdict and its events, against viem', () => {
  const v = { jobId: J, verdict: 'Cheated' as const, loss: 5n, decisionDigest: D };
  it('says the router is not deployed on Base, and refuses to build without an address', () => {
    expect(arb.ARBITRATION_ON_BASE.deployed).toBe(false);
    expect(() => arb.resolveByCode('', J)).toThrow(/not deployed on Base/);
  });
  it('the verdict digest equals the EIP-712 hash viem computes (the router recovers the same signer)', async () => {
    const td = arb.secondGraderTypedData(ROUTER, v);
    expect(arb.verdictDigest(ROUTER, v)).toBe(hashTypedData({ ...td, message: { ...td.message, loss: 5n } } as never));
    const acct = privateKeyToAccount(KEY);
    const sig = await acct.signTypedData({ ...td, message: { ...td.message, loss: 5n } } as never);
    expect(await recoverTypedDataAddress({ ...(td as unknown as Record<string, unknown>), message: { ...td.message, loss: 5n }, signature: sig } as never)).toBe(acct.address);
    const c = arb.resolveBySecondGrader(ROUTER, v, sig);
    const abi = parseAbi(['function resolveBySecondGrader((bytes32 jobId,uint8 verdict,uint256 loss,bytes32 rubricHash,bytes32 decisionDigest) v, bytes signature)']);
    expect(c.data).toBe(encodeFunctionData({ abi, functionName: 'resolveBySecondGrader', args: [{ jobId: J as `0x${string}`, verdict: 3, loss: 5n, rubricHash: arb.RUBRIC_V1_HASH, decisionDigest: D as `0x${string}` }, sig] }));
  });
  it('the council and code tiers encode as the router expects; a loss only on Cheated', () => {
    const abi = parseAbi(['function councilApprove(bytes32 jobId, uint8 verdict, uint256 loss)', 'function resolveByCode(bytes32 jobId)', 'function resolveByCouncil(bytes32 jobId)', 'function pullOracle(bytes32 jobId)']);
    expect(arb.councilApprove(ROUTER, J, 'Cheated', 7n).data).toBe(encodeFunctionData({ abi, functionName: 'councilApprove', args: [J as `0x${string}`, 3, 7n] }));
    expect(arb.resolveByCode(ROUTER, J).data).toBe(encodeFunctionData({ abi, functionName: 'resolveByCode', args: [J as `0x${string}`] }));
    expect(arb.resolveByCouncil(ROUTER, J).data).toBe(encodeFunctionData({ abi, functionName: 'resolveByCouncil', args: [J as `0x${string}`] }));
    expect(arb.pullOracle(ROUTER, J).data).toBe(encodeFunctionData({ abi, functionName: 'pullOracle', args: [J as `0x${string}`] }));
    expect(() => arb.councilApprove(ROUTER, J, 'BuyerWins', 1n)).toThrow(/only a Cheated verdict/);
    expect(() => arb.councilApprove(ROUTER, J, 'Cheated', 0n)).toThrow(/names the loss/);
  });
  it('decodes Resolved, Escalated and CouncilApproved, and says what each ruling writes into the seller\'s record', () => {
    const ev = parseAbi(['event Resolved(bytes32 indexed jobId, uint8 indexed tier, uint8 verdict, uint256 loss, address by)', 'event CouncilApproved(bytes32 indexed jobId, address indexed seat, uint8 verdict, uint256 loss)']);
    const topics = encodeEventTopics({ abi: ev, eventName: 'Resolved', args: { jobId: J as `0x${string}`, tier: 3 } });
    const r = arb.decodeRouterLog({ topics: topics as string[], data: encodeAbiParameters(parseAbiParameters('uint8,uint256,address'), [3, 5n, ROUTER]) });
    expect(r).toEqual({ event: 'Resolved', jobId: J, tier: 'Council', verdict: 'Cheated', loss: 5n, by: ROUTER.toLowerCase() });
    const ct = encodeEventTopics({ abi: ev, eventName: 'CouncilApproved', args: { jobId: J as `0x${string}`, seat: ROUTER } });
    expect(arb.decodeRouterLog({ topics: ct as string[], data: encodeAbiParameters(parseAbiParameters('uint8,uint256'), [2, 0n]) })).toMatchObject({ event: 'CouncilApproved', seat: ROUTER.toLowerCase(), verdict: 'BuyerWins' });
    expect(arb.decodeRouterLog({ topics: [D], data: '0x' })).toBeNull();
    expect(arb.recordEffectOf('Cheated').sellerRecord).toBe('incorrect');
    expect(arb.recordEffectOf('SellerWins').sellerRecord).toBe('correct');
  });
});

describe('the Base reader: warmbed\'s rotation by default, the next endpoint on a failure, a revert thrown at once', () => {
  it('walks past a 429 and a refusal, and stops on a revert', async () => {
    const seen: string[] = [];
    const f = (async (url: string) => {
      seen.push(url);
      if (url.includes('warmbed')) return { ok: true, status: 200, json: async () => [{ url: 'https://a.example' }, { url: 'https://b.example' }, { url: 'https://c.example' }] };
      if (url === 'https://a.example') return { ok: false, status: 429, json: async () => ({}) };
      if (url === 'https://b.example') return { ok: true, status: 200, json: async () => ({ error: { code: -32005, message: 'request limit reached' } }) };
      return { ok: true, status: 200, json: async () => ({ result: '0x10' }) };
    }) as never;
    const r = baseReader({ fetch: f });
    expect(await r.call('eth_blockNumber', [])).toBe('0x10');
    expect(seen.filter((u) => !u.includes('warmbed'))).toEqual(['https://a.example', 'https://b.example', 'https://c.example']);
    const rev = baseReader({ urls: ['https://x.example'], warmbed: false, fetch: (async () => ({ ok: true, status: 200, json: async () => ({ error: { code: 3, message: 'execution reverted', data: '0xd3137376' } }) })) as never });
    await expect(rev.call('eth_call', [])).rejects.toBeInstanceOf(RpcReverted);
  });
});

describe('attestations by default: every step on Base unless told otherwise', () => {
  const pool = MOONBEAM_COVERAGE_POOLS[0]!;
  const seller = /seller (0x[0-9a-fA-F]{40})/.exec(pool.note)![1]!;
  it('attest() aims at Base; the stamp registry Base lacks is said, not faked; networks none opts out', () => {
    expect([...MOONBEAM_ATTEST_NETWORKS]).toEqual([8453]);
    const a = attest({ kind: 'grade', subject: { chainId: 8453, contract: REGISTRY.hook, jobId: J }, body: { x: 1 }, model: 'm', verdict: 1 });
    expect(a.calls.map((c) => [c.chainId, c.to])).toEqual([[8453, REGISTRY.decisionLog]]);
    expect(a.missing.map((m) => m.contract)).toEqual(['GradeStampRegistry']);
    expect(attest({ kind: 'grade', subject: { chainId: 8453, contract: REGISTRY.hook, jobId: J }, model: 'm' }, { networks: 'none' }).calls).toEqual([]);
    expect(assuranceAttest({ kind: 'x', subject: { chainId: 8453, contract: REGISTRY.hook, jobId: J }, model: 'm' }).networks).toEqual([8453]);
  });
  it('settleAttested: the legs of a completed covered job from its own GLMR amounts, attested on Base against the hook', () => {
    const t = readJob([1, 2, 3].map((hookState) => ({ name: 'hook', hookState })));
    if (!t.ok) throw new Error(t.error);
    const q = hookQuote({ price: 10n, premium: 1n, deposit: 12n, covered: true });
    const s = settleAttested({ venue: 'moonbeam', ctx: { lane: 'hook', hook: 'V3' }, chainId: 8453, jobId: J, buyer: seller, seller, evaluator: null, terms: null, clock: {}, state: t.state, path: t.path }, q);
    if (!s.ok) throw new Error(s.why.join());
    expect(s.legs).toEqual({ buyer: 0n, seller: 22n, backers: 1n, layer: 0n, evaluator: 0n });
    expect(s.attest.calls[0]!.to).toBe(REGISTRY.decisionLog);
    expect(s.attest.mark.verdict).toBe(1);
    expect(hookQuote({ price: 10n, premium: 1n, deposit: 12n, covered: false }).legs.completed!.buyer).toBe(1n);
  });
  it('recordGrade records on Base by default with the Jev SDK\'s own call data; none turns it off', async () => {
    const receipt = await gradeJob({ jobId: J, evidence: 'the report', answers: CLEAN, model: 'jev-1.13.0' });
    const r = await recordGrade(receipt);
    expect(r.networks).toEqual([8453]);
    expect(r.calls.map((c) => [c.fn, c.to])).toEqual([['JevAnswerLog.record', REGISTRY.answerLog], ['JevDecisionLog.record', REGISTRY.decisionLog]]);
    expect(r.missing.map((m) => m.contract)).toEqual(['GradeStampRegistry']);
    const jev = await (await import('@taifoon/jev')).record(receipt, { network: 'base' });
    expect(r.calls.map((c) => c.data)).toEqual(jev.calls.map((c) => c.data));   // the same bytes the Jev SDK sends
    expect((await recordGrade(receipt, { network: 'none' })).calls).toEqual([]);
    expect((await recordGrade(receipt, { network: 'devnet' })).calls.map((c) => c.fn)).toEqual(['JevAnswerLog.record', 'JevDecisionLog.record', 'GradeStampRegistry.stamp']);
    expect(STAMP_VERDICT_OF.complete).toBe(1);
  });
  it('attestSale: a resale step on Base; the wall quote is the layer\'s price (9207 to the seller → 11509 to the buyer)', () => {
    const q = quoteSale({ venue_in: 'x402-base', venue_out: 'x402-base', seller_price: 9207n });
    if (!q.ok) throw new Error(q.why);
    expect(String(q.price_to_buyer)).toBe('11509');
    // 0.8.0: quoteSale takes the seller's own venue (any the scheme prices); quoteBase keeps both sides on Base
    expect(quoteBase({ venue_in: 'x402-base', venue_out: 'x402-base', seller_price: 9207n })).toEqual(q);
    const a = attestSale({ saleKey: 'rs_x_0123456789', step: 'settled', quote: q });
    expect(a.mark.kind).toBe('resale.settled'); expect(a.calls[0]!.to).toBe(REGISTRY.decisionLog); expect(a.mark.verdict).toBe(1);
    expect(attestSale({ saleKey: 'rs_x_0123456789', step: 'quoted', quote: q }).missing).toEqual([]);
  });
});

describe('fixes P2 / P11 / P13 / P6, as 0.7.0 leaves them', () => {
  const seller = /seller (0x[0-9a-fA-F]{40})/.exec(MOONBEAM_COVERAGE_POOLS[0]!.note)![1]!;
  it('P2: coverPremium is the layer\'s number (jev-wilson), and the seller\'s deposit approval is a call of its own', () => {
    expect(coverPremium(10n ** 18n, { k: 19, n: 20 })).toBe(premiumAmount(10n ** 18n, wilsonUpperFailure(19, 20)));
    const c = sellerDepositCalls({ token: REGISTRY.glmr, price: 10n, deposit: 12n });
    expect(c[0]).toMatchObject({ to: REGISTRY.glmr, signer: 'seller', step: 'approve-deposit' });
    expect(() => sellerDepositCalls({ token: REGISTRY.glmr, price: 10n, deposit: 10n })).toThrow();
    expect(fundCalls({ chainId: 8453, jobContract: REGISTRY.hook as never, token: REGISTRY.glmr as never, buyer: seller as never, seller: seller as never, price: 10n, deadline: 2_000_000_000, deposit: 12n, premium: null, task: 't', skills: [] }, { pool: pool0(), premium: 1n })[1]!.data.slice(-40).toLowerCase()).toBe(pool0().slice(2).toLowerCase());
  });
  it('P11: pools-open comes from the layer\'s policy (supported + closed_by_policy); Moonbeam stays closed while it says so', async () => {
    const live = fx('layer/pools-networks-2026-10-14.json');
    const t = { base: '/v1', fetch: async () => ({ ok: true, status: 200, json: async () => live }) };
    const r = await poolsOpenOn(t);
    expect(r.source).toBe('layer'); expect(r.chains).toEqual([]);
    expect(r.closedByPolicy.map((c) => c.chain_id)).toContain(8453);
    expect(() => poolDeposit({ chainId: 36927, pool: pool0() as never, asset: REGISTRY.glmr as never, amount: 1n, receiver: pool0() as never, openOn: r.chains })).toThrow(PoolsNotOpenError);
    const opened = { ...live, closed_by_policy: [], supported: [...live.supported, { chain_id: 8453, factory: '0x91f078D10E3f0D05fEBcEA35f114063c696aef54', status: 'open' }] };
    expect((await poolsOpenOn({ base: '/v1', fetch: async () => ({ ok: true, status: 200, json: async () => opened }) })).chains).toEqual([36927, 8453]);
    expect((await poolsOpenOn({ base: '/v1', fetch: async () => { throw new Error('down'); } })).source).toBe('typed');
  });
  it('P13: ./onboard is the one onboarding module: the hook\'s path and every role\'s readiness checks', () => {
    expect(typeof readinessForClient).toBe('function');
    expect(Object.keys(readiness)).toContain('readinessForBacker');
  });
  it('P6: the judge guard anchors on Base\'s decision log', () => {
    expect(DEFAULT_GUARD.anchor).toEqual({ chain: 8453, log: REGISTRY.decisionLog });
  });
});
const pool0 = () => MOONBEAM_COVERAGE_POOLS[0]!.address;

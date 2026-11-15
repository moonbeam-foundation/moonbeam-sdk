// The hook's rules by read: every builder works on the live V3 hook and on its V3.1 upgrade, and which one applies is read
// from the chain (one Multicall3.aggregate3), never assumed. The fake chain below answers the aggregate3 the SDK sends, decoded
// with viem, so the SDK's own encoder and decoder are checked against viem's on every read.
import { describe, it, expect } from 'vitest';
import { decodeFunctionData, encodeFunctionResult, parseAbi, toFunctionSelector, encodeAbiParameters, type Hex } from 'viem';
import {
  BASE_ASSURANCE_HOOK, BASE_GLMR, BASE_USDC, BASE_POOL_FACTORY, BASE_JOB_CONTRACT, MULTICALL3, SIGNATURES, HOOK_READS, MAX_DEADLINE_S,
  readHook, planFunding, fundCalls, sellerDepositCalls, approveFunderCalls, revokeFunderCalls, settleCalls, autoCompleteCalls, claimCalls,
  encodeAggregate3, decodeAggregate3, jobIdOf, newJobSalt, selector, sendCalls, assertCallChain, ChainMismatchError,
} from '../src/onboard/index.js';
import type { ChainReader, HireTerms, JobRules, UnsignedCall, Eip1193Provider } from '../src/onboard/index.js';
import { depositCalls, redeemCalls } from '../src/pools/index.js';
import { checkRouter, resolveByCode, ARBITRATION_ON_BASE } from '../src/arbitration/index.js';

const SELLER = '0xccf57d593aa2cf8f8329e5e8353f69f2b21e34e9' as const;
const BUYER = '0x00000000000000000000000000000000000000b1' as const;
const POOL = '0x9C1eC3E4250Abe356FB440FF7a8aD158De9bdf39' as const;
const OTHER = '0x00000000000000000000000000000000000000ee' as const;
const JOB = ('0x' + '11'.repeat(32)) as Hex;
const DIGEST = ('0x' + '22'.repeat(32)) as Hex;
const NOW = 1_800_000_000;
const MAX_UINT = (1n << 256n) - 1n;

const MC = parseAbi(['struct Call3 { address target; bool allowFailure; bytes callData; }', 'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)']);
const VIEWS = parseAbi([
  'function poolFactory() view returns (address)', 'function MAX_DEADLINE() view returns (uint256)', 'function getCurrentBlockTimestamp() view returns (uint256)',
  'function poolOf(address seller, address asset) view returns (address)', 'function funderApproved(address seller, address funder) view returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)', 'function claimable(address token, address account) view returns (uint256)',
  'function reviewOf(bytes32 jobId) view returns (uint32 window, uint64 submittedAt)',
  'function jobs(bytes32 jobId) view returns (address buyer, address seller, address token, uint256 price, uint256 premium, uint256 deposit, uint64 deadline, uint64 challengeWindow, address pool, uint8 state)',
]);
const ok = (fn: (typeof VIEWS)[number]['name'], result: unknown) => ({ success: true, returnData: encodeFunctionResult({ abi: VIEWS, functionName: fn, result: result as never }) });
const REVERT = { success: false, returnData: '0x' as Hex };

type Chain = { rules: 'v3' | 'v3.1'; factory?: string; poolOf?: string; approved?: boolean; allowance?: bigint; job?: { state: number; deadline: number; window?: number; submittedAt?: number }; claimable?: bigint };
/** a fake chain that answers aggregate3 as the live V3 hook or the V3.1 hook would; it counts the eth_calls it served */
function chain(c: Chain): ChainReader & { calls: number } {
  const r = {
    calls: 0,
    async call<T>(method: string, params: readonly unknown[]): Promise<T> {
      expect(method).toBe('eth_call'); r.calls++;
      const { to, data } = params[0] as { to: string; data: Hex };
      expect(to).toBe(MULTICALL3);
      const d = decodeFunctionData({ abi: MC, data });
      const calls = d.args[0] as readonly { target: string; allowFailure: boolean; callData: Hex }[];
      const out = calls.map(({ target, allowFailure, callData }) => {
        expect(allowFailure).toBe(true);
        const sel = callData.slice(0, 10); const v31 = c.rules === 'v3.1'; const hook = target.toLowerCase() === BASE_ASSURANCE_HOOK.toLowerCase();
        if (target === MULTICALL3 && sel === toFunctionSelector('getCurrentBlockTimestamp()')) return ok('getCurrentBlockTimestamp', BigInt(NOW));
        if (hook && sel === toFunctionSelector('poolFactory()')) return v31 ? ok('poolFactory', c.factory ?? BASE_POOL_FACTORY) : REVERT;
        if (hook && sel === toFunctionSelector('MAX_DEADLINE()')) return v31 ? ok('MAX_DEADLINE', BigInt(MAX_DEADLINE_S)) : REVERT;
        if (hook && sel === toFunctionSelector('funderApproved(address,address)')) return v31 ? ok('funderApproved', c.approved ?? false) : REVERT;
        if (hook && sel === toFunctionSelector('claimable(address,address)')) return v31 ? ok('claimable', c.claimable ?? 0n) : REVERT;
        if (hook && sel === toFunctionSelector('reviewOf(bytes32)')) return v31 ? ok('reviewOf', [c.job?.window ?? 0, BigInt(c.job?.submittedAt ?? 0)]) : REVERT;
        if (hook && sel === toFunctionSelector('jobs(bytes32)')) {
          const j = c.job ?? { state: 0, deadline: 0 };
          return ok('jobs', [BUYER, SELLER, BASE_GLMR, 10n, 1n, 12n, BigInt(j.deadline), 3600n, POOL, j.state]);
        }
        if (target.toLowerCase() === BASE_POOL_FACTORY.toLowerCase() && sel === toFunctionSelector('poolOf(address,address)')) return ok('poolOf', c.poolOf ?? POOL);
        if (sel === toFunctionSelector('allowance(address,address)')) return ok('allowance', c.allowance ?? 0n);
        return REVERT;
      });
      return encodeFunctionResult({ abi: MC, functionName: 'aggregate3', result: out as never }) as T;
    },
  };
  return r;
}

const terms = (o: Partial<HireTerms> = {}): HireTerms => ({ chainId: 8453, jobContract: BASE_JOB_CONTRACT, token: BASE_GLMR, buyer: BUYER, seller: SELLER, price: 10n, deadline: NOW + 86_400, deposit: 12n, premium: null, task: 'summarise the paper', skills: [], ...o });
const selOf = (c: UnsignedCall) => c.data.slice(0, 10);

describe('aggregate3: the SDK encodes and decodes exactly as viem does', () => {
  it('calldata round-trips through viem, and viem-encoded results decode', () => {
    const calls = [{ target: BASE_ASSURANCE_HOOK, data: selector(HOOK_READS.poolFactory) }, { target: BASE_POOL_FACTORY, data: (selector(HOOK_READS.poolOf) + '00'.repeat(64)) as Hex }];
    const d = decodeFunctionData({ abi: MC, data: encodeAggregate3(calls) });
    expect((d.args[0] as readonly { target: string; callData: string }[]).map((x) => [x.target.toLowerCase(), x.callData])).toEqual(calls.map((x) => [x.target.toLowerCase(), x.data]));
    const ret = encodeFunctionResult({ abi: MC, functionName: 'aggregate3', result: [{ success: true, returnData: '0x1234' }, { success: false, returnData: '0x' }] as never });
    expect(decodeAggregate3(ret)).toEqual([{ success: true, data: '0x1234' }, { success: false, data: '0x' }]);
  });
  it('refuses an answer whose offsets point outside it', () => { expect(() => decodeAggregate3('0x' + encodeAbiParameters([{ type: 'uint256' }], [10_000n]).slice(2))).toThrow(/outside/); });
});

describe('readHook: which rules, from one read', () => {
  it('V3 (the live hook): poolFactory and MAX_DEADLINE revert; the shipped factory answers poolOf', async () => {
    const r = chain({ rules: 'v3' });
    const f = await readHook(r, { seller: SELLER, funder: BUYER, token: BASE_GLMR, jobId: JOB, account: BUYER });
    expect(r.calls).toBe(1);
    expect(f).toMatchObject({ rules: 'v3', poolFactory: BASE_POOL_FACTORY, maxDeadline: null, blockTime: NOW, funderApproved: null, claimable: null });
    expect(f.registeredPool?.toLowerCase()).toBe(POOL.toLowerCase());
    expect(f.job).toMatchObject({ rules: 'v3', state: 'None', window: 0, autoCompleteAt: null });
  });
  it('V3.1: the hook names its factory and its deadline cap; funder approval, review window and credits read', async () => {
    const f = await readHook(chain({ rules: 'v3.1', approved: true, claimable: 7n, job: { state: 2, deadline: NOW + 10, window: 3600, submittedAt: NOW - 100 } }), { seller: SELLER, funder: BUYER, jobId: JOB, token: BASE_GLMR, account: BUYER });
    expect(f).toMatchObject({ rules: 'v3.1', maxDeadline: MAX_DEADLINE_S, funderApproved: true, claimable: 7n });
    expect(f.poolFactory.toLowerCase()).toBe(BASE_POOL_FACTORY.toLowerCase());
    expect(f.job).toEqual({ jobId: JOB, rules: 'v3.1', state: 'Submitted', window: 3600, submittedAt: NOW - 100, autoCompleteAt: NOW + 3500, deadline: NOW + 10 });
  });
  it('a job funded before V3.1 keeps the V3 rules on the upgraded hook (no review window recorded)', async () => {
    const f = await readHook(chain({ rules: 'v3.1', job: { state: 2, deadline: NOW + 10, window: 0 } }), { jobId: JOB });
    expect(f.rules).toBe('v3.1'); expect(f.job).toMatchObject({ rules: 'v3', window: 0, autoCompleteAt: null });
  });
  it('refuses a V3.1 hook that names another pool factory, or none', async () => {
    await expect(readHook(chain({ rules: 'v3.1', factory: OTHER }), {})).rejects.toThrow(/takes pools from factory/);
    await expect(readHook(chain({ rules: 'v3.1', factory: '0x0000000000000000000000000000000000000000' }), {})).rejects.toThrow(/names no pool factory/);
  });
  it('a failed read is an error, never read as V3', async () => {
    await expect(readHook({ call: async () => { throw new Error('every Base endpoint failed'); } }, {})).rejects.toThrow(/every Base endpoint failed/);
    await expect(readHook({ call: async () => '0x' as never }, {})).rejects.toThrow(/no answer/);
  });
});

describe('the seller’s calls: V3 and V3.1', () => {
  it('V3: one exact approve, and the honest text that any funder can spend it', () => {
    const c = sellerDepositCalls({ token: BASE_GLMR, price: 10n, deposit: 12n }, { rules: 'v3', funder: BUYER });
    expect(c.map((x) => x.step)).toEqual(['approve-deposit']); expect(c[0]!.effect).toMatch(/anyone funding a job that names you/);
  });
  it('V3.1: the exact approve, then approveFunder(buyer, true) on the hook; left out once approved', () => {
    const c = sellerDepositCalls({ token: BASE_GLMR, price: 10n, deposit: 12n }, { rules: 'v3.1', funder: BUYER });
    expect(c.map((x) => x.step)).toEqual(['approve-deposit', 'approve-funder']);
    expect(c[1]!.to).toBe(BASE_ASSURANCE_HOOK); expect(c[1]!.signer).toBe('seller');
    expect(c[1]!.data).toBe(selector(SIGNATURES.approveFunder) + BUYER.slice(2).padStart(64, '0') + '1'.padStart(64, '0'));
    expect(selector(SIGNATURES.approveFunder)).toBe(toFunctionSelector('approveFunder(address,bool)'));
    expect(c[0]!.effect).toMatch(/only for a job you or a funder you approved opens/);
    expect(sellerDepositCalls({ token: BASE_GLMR, price: 10n, deposit: 12n }, { rules: 'v3.1', funder: BUYER, funderApproved: true }).map((x) => x.step)).toEqual(['approve-deposit']);
    expect(() => sellerDepositCalls({ token: BASE_GLMR, price: 10n, deposit: 12n }, { rules: 'v3.1' })).toThrow(/pass \{ funder \}/);
  });
  it('revoke is approveFunder(funder, false)', () => {
    expect(revokeFunderCalls(BUYER)[0]!.data.slice(-64)).toBe('0'.repeat(64));
    expect(approveFunderCalls(BUYER)[0]!.data.slice(-64)).toBe('1'.padStart(64, '0'));
  });
});

describe('fundCalls: the pool must be the factory’s, the deadline is bounded, approvals stay exact', () => {
  it('a named pool needs the factory’s answer, and must equal it', () => {
    expect(() => fundCalls(terms(), { jobId: JOB, pool: POOL, premium: 1n })).toThrow(/registeredPool/);
    expect(() => fundCalls(terms(), { jobId: JOB, pool: POOL, premium: 1n, registeredPool: OTHER })).toThrow(/not the factory's pool/);
    expect(() => fundCalls(terms(), { jobId: JOB, pool: POOL, premium: 1n, registeredPool: null })).toThrow(/names none/);
    expect(fundCalls(terms(), { jobId: JOB, pool: POOL, premium: 1n, registeredPool: POOL.toLowerCase() as `0x${string}` })).toHaveLength(2);
  });
  it('a pool with premium 0 is refused (the hook would revert CoverNotPaidFor)', () => { expect(() => fundCalls(terms(), { jobId: JOB, pool: POOL, registeredPool: POOL })).toThrow(/premium 0/); });
  it('with the chain time, a deadline more than 365 days away or already past is refused', () => {
    expect(() => fundCalls(terms({ deadline: NOW + MAX_DEADLINE_S + 1 }), { jobId: JOB, now: NOW })).toThrow(/365 days/);
    expect(() => fundCalls(terms({ deadline: NOW }), { jobId: JOB, now: NOW })).toThrow(/has passed/);
    expect(fundCalls(terms({ deadline: NOW + MAX_DEADLINE_S }), { jobId: JOB, now: NOW })).toHaveLength(2);
  });
  it('V3.1: the review window is 1 hour to 30 days, and the text says the buyer has no reject', () => {
    expect(() => fundCalls(terms(), { jobId: JOB, rules: 'v3.1', gradeWindow: 200 })).toThrow(/review window/);
    const f = fundCalls(terms(), { jobId: JOB, rules: 'v3.1' })[1]!;
    expect(f.effect).toMatch(/approved you as a funder/); expect(f.effect).toMatch(/you have no reject/); expect(f.effect).toMatch(/claimAutoComplete/);
    expect(fundCalls(terms(), { jobId: JOB, rules: 'v3' })[1]!.effect).toMatch(/complete or reject it yourself/);
  });
  it('the calldata is the same on both hooks (the fund signatures did not change)', () => {
    expect(fundCalls(terms(), { jobId: JOB, rules: 'v3.1' })[1]!.data).toBe(fundCalls(terms(), { jobId: JOB, rules: 'v3' })[1]!.data);
  });
  it('every approve the SDK builds is for an exact amount, never unlimited', () => {
    const all = [
      ...fundCalls(terms(), { jobId: JOB, pool: POOL, premium: 3n, registeredPool: POOL }),
      ...fundCalls(terms({ token: BASE_USDC }), { jobId: JOB }),
      ...sellerDepositCalls({ token: BASE_GLMR, price: 10n, deposit: 12n }, { rules: 'v3.1', funder: BUYER }),
      ...depositCalls({ chainId: 36927, pool: POOL, asset: BASE_GLMR, amount: 10n ** 19n, receiver: BUYER }),
    ].filter((c) => selOf(c) === selector(SIGNATURES.approve));
    expect(all).toHaveLength(4);
    expect(all.map((c) => BigInt('0x' + c.data.slice(-64)))).toEqual([13n, 10n, 12n, 10n ** 19n]);
    for (const c of all) expect(BigInt('0x' + c.data.slice(-64))).not.toBe(MAX_UINT);
  });
});

describe('the job id: salted so it cannot be derived from the terms', () => {
  it('jobIdOf(terms, salt) differs per salt; no salt is the old id', () => {
    const a = newJobSalt(); const b = newJobSalt();
    expect(a).not.toBe(b); expect(jobIdOf(terms(), a)).not.toBe(jobIdOf(terms(), b)); expect(jobIdOf(terms(), a)).not.toBe(jobIdOf(terms()));
    expect(jobIdOf(terms(), a)).toBe(jobIdOf(terms(), a));
    expect(() => jobIdOf(terms(), '0x12' as Hex)).toThrow(/32 bytes/);
    expect(() => fundCalls(terms(), { jobId: JOB, salt: a })).toThrow(/not both/);
    expect(fundCalls(terms(), { salt: a })[1]!.data.slice(10, 74)).toBe(jobIdOf(terms(), a).slice(2));
  });
});

describe('planFunding: one read, the calls for the rules it finds', () => {
  it('V3: the seller approves its deposit; the buyer approves and funds; the id is salted', async () => {
    const r = chain({ rules: 'v3' });
    const p = await planFunding(r, terms(), { pool: POOL, premium: 1n });
    expect(r.calls).toBe(1);
    expect(p.rules).toBe('v3'); expect(p.seller.map((c) => c.step)).toEqual(['approve-deposit']); expect(p.buyer.map((c) => c.step)).toEqual(['approve', 'fundJob']);
    expect(p.salt).toMatch(/^0x[0-9a-f]{64}$/); expect(p.jobId).toBe(jobIdOf(terms(), p.salt!)); expect(p.buyer[1]!.data.slice(10, 74)).toBe(p.jobId.slice(2));
    expect(p.notes.join(' ')).toMatch(/any funder/);
  });
  it('V3.1: the seller also approves this buyer as a funder, unless it already has', async () => {
    const p = await planFunding(chain({ rules: 'v3.1' }), terms(), { pool: POOL, premium: 1n });
    expect(p.seller.map((c) => c.step)).toEqual(['approve-deposit', 'approve-funder']);
    expect(p.buyer[1]!.effect).toMatch(/no reject/);
    const q = await planFunding(chain({ rules: 'v3.1', approved: true }), terms(), { pool: POOL, premium: 1n });
    expect(q.seller.map((c) => c.step)).toEqual(['approve-deposit']);
  });
  it('a seller funding its own job needs no funder approval', async () => {
    const p = await planFunding(chain({ rules: 'v3.1' }), terms({ buyer: SELLER }), {});
    expect(p.seller.map((c) => c.step)).toEqual(['approve-deposit']);
  });
  it('refuses a pool the factory did not create, on both hooks', async () => {
    for (const rules of ['v3', 'v3.1'] as const) await expect(planFunding(chain({ rules, poolOf: OTHER }), terms(), { pool: POOL, premium: 1n })).rejects.toThrow(/not the factory's pool/);
  });
  it('refuses a deadline more than 365 days past the chain’s time, on both hooks', async () => {
    for (const rules of ['v3', 'v3.1'] as const) await expect(planFunding(chain({ rules }), terms({ deadline: NOW + MAX_DEADLINE_S + 60 }))).rejects.toThrow(/365 days/);
  });
  it('refuses terms without a buyer', async () => {
    await expect(planFunding(chain({ rules: 'v3' }), terms({ buyer: '0x0000000000000000000000000000000000000000' }))).rejects.toThrow(/no buyer/);
  });
});

describe('endings: no buyer reject on a V3.1 job; auto-completion after the window', () => {
  const v31 = (o: Partial<JobRules> = {}): JobRules => ({ jobId: JOB, rules: 'v3.1', state: 'Submitted', window: 3600, submittedAt: NOW, autoCompleteAt: NOW + 3600, deadline: NOW + 86_400, ...o });
  const v3 = (o: Partial<JobRules> = {}): JobRules => ({ jobId: JOB, rules: 'v3', state: 'Submitted', window: 0, submittedAt: 0, autoCompleteAt: null, deadline: NOW + 86_400, ...o });
  it('V3 job: the buyer rejects as before', () => {
    const c = settleCalls(JOB, 'rejected', DIGEST, { job: v3() })[0]!; expect(c.signer).toBe('buyer'); expect(selOf(c)).toBe(selector(SIGNATURES.reject));
  });
  it('V3.1 job: the buyer reject is refused; a hook evaluator may reject inside the window only', () => {
    expect(() => settleCalls(JOB, 'rejected', DIGEST, { job: v31() })).toThrow(/buyer has no reject/);
    expect(() => settleCalls(JOB, 'rejected', DIGEST, { job: v31(), as: 'buyer' })).toThrow(/buyer has no reject/);
    expect(settleCalls(JOB, 'rejected', DIGEST, { job: v31(), as: 'evaluator', now: NOW + 10 })[0]!.signer).toBe('evaluator');
    expect(() => settleCalls(JOB, 'rejected', DIGEST, { job: v31(), as: 'evaluator', now: NOW + 3600 })).toThrow(/window closed/);
  });
  it('V3.1 job: a delivered job does not expire; a funded one still does past its deadline', () => {
    expect(() => settleCalls(JOB, 'expired', undefined, { job: v31() })).toThrow(/does not expire/);
    expect(settleCalls(JOB, 'expired', undefined, { job: v31({ state: 'Funded', submittedAt: 0, autoCompleteAt: null }), now: NOW + 86_401 })).toHaveLength(1);
    expect(() => settleCalls(JOB, 'expired', undefined, { job: v31({ state: 'Funded' }), now: NOW })).toThrow(/has not passed/);
    expect(settleCalls(JOB, 'expired', undefined, { job: v3() })).toHaveLength(1);
  });
  it('claimAutoComplete: V3.1 delivered jobs, after the window; anyone sends it', () => {
    const c = autoCompleteCalls(v31(), NOW + 3600)[0]!;
    expect(c.data).toBe(toFunctionSelector('claimAutoComplete(bytes32)') + '11'.repeat(32)); expect(c.signer).toBe('anyone');
    expect(() => autoCompleteCalls(v31(), NOW + 3599)).toThrow(/open until/);
    expect(() => autoCompleteCalls(v3())).toThrow(/no review window/);
    expect(() => autoCompleteCalls(v31({ state: 'Funded', autoCompleteAt: null }))).toThrow(/only a delivered job/);
  });
  it('claim(token) withdraws a credited payout', () => { expect(claimCalls(BASE_GLMR)[0]!.data).toBe(toFunctionSelector('claim(address)') + BASE_GLMR.slice(2).toLowerCase().padStart(64, '0')); });
  it('rules read for another job are refused', () => { expect(() => settleCalls(DIGEST, 'completed', undefined, { job: v31() })).toThrow(/not 0x22/); });
});

describe('sendCalls: the call’s chain is enforced, not advisory', () => {
  const c: UnsignedCall = { chainId: 8453, to: BASE_ASSURANCE_HOOK, data: '0x83ccfb84', value: '0x0', step: 'complete', signer: 'buyer', effect: '' };
  const wallet = (chainHex: string, o: { switchTo?: string } = {}) => {
    let chainId = chainHex; const sent: unknown[] = [];
    const p: Eip1193Provider & { sent: unknown[] } = {
      sent,
      async request({ method, params }) {
        if (method === 'eth_chainId') return chainId;
        if (method === 'eth_accounts') return [BUYER];
        if (method === 'wallet_switchEthereumChain') { chainId = o.switchTo ?? (params![0] as { chainId: string }).chainId; return null; }
        if (method === 'eth_sendTransaction') { sent.push(params![0]); return '0x' + 'ab'.repeat(32); }
        if (method === 'eth_getTransactionReceipt') return { status: '0x1' };
        throw new Error(method);
      },
    };
    return p;
  };
  it('refuses a call for another chain and sends nothing', async () => {
    const w = wallet('0x1');
    await expect(sendCalls(w, [c])).rejects.toBeInstanceOf(ChainMismatchError); expect(w.sent).toHaveLength(0);
    expect(() => assertCallChain(c, 1)).toThrow(/built for chain 8453, but the wallet is on chain 1/);
  });
  it('sends on the right chain, with chainId on the transaction', async () => {
    const w = wallet('0x2105');
    expect(await sendCalls(w, [c, c])).toHaveLength(2);
    expect(w.sent[0]).toMatchObject({ from: BUYER, to: BASE_ASSURANCE_HOOK, chainId: '0x2105' });
  });
  it('switchChain asks the wallet, then reads the chain again; a wallet that does not switch is refused', async () => {
    expect(await sendCalls(wallet('0x1'), [c], { switchChain: true })).toHaveLength(1);
    await expect(sendCalls(wallet('0x1', { switchTo: '0x1' }), [c], { switchChain: true })).rejects.toBeInstanceOf(ChainMismatchError);
  });
  it('a reverted receipt stops the calls after it', async () => {
    const w = wallet('0x2105'); const req = w.request.bind(w);
    w.request = async (a) => (a.method === 'eth_getTransactionReceipt' ? { status: '0x0' } : req(a));
    await expect(sendCalls(w, [c, c])).rejects.toThrow(/reverted/); expect(w.sent).toHaveLength(1);
  });
});

describe('pools: the factory check and the asset’s own label', () => {
  it('on Base a deposit needs the factory’s pool for its seller and asset; redeem never does', () => {
    const a = { chainId: 8453, openOn: [8453], pool: POOL as `0x${string}`, asset: BASE_GLMR, amount: 10n ** 19n, receiver: BUYER };
    expect(() => depositCalls(a)).toThrow(/registeredPool/);
    expect(() => depositCalls({ ...a, registeredPool: OTHER })).toThrow(/not the factory's pool/);
    expect(depositCalls({ ...a, registeredPool: POOL })).toHaveLength(2);
    expect(redeemCalls({ chainId: 8453, openOn: [8453], pool: POOL, shares: 1n, owner: BUYER })).toHaveLength(1);
  });
  it('labels name the pool’s asset, not GLMR for everything', () => {
    expect(depositCalls({ chainId: 36927, pool: POOL, asset: BASE_GLMR, amount: 10n ** 19n, receiver: BUYER })[0]!.effect).toMatch(/10\.0000 GLMR/);
    expect(depositCalls({ chainId: 36927, pool: POOL, asset: BASE_USDC, amount: 2_500_000n, receiver: BUYER, symbol: 'USDC', decimals: 6 })[0]!.effect).toMatch(/2\.5000 USDC/);
    expect(depositCalls({ chainId: 36927, pool: POOL, asset: OTHER, amount: 5n, receiver: BUYER })[0]!.effect).toMatch(/5 units of 0x0+ee/);
    expect(redeemCalls({ chainId: 36927, pool: POOL, shares: 1n, owner: BUYER })[0]!.effect).not.toMatch(/GLMR/);
  });
});

describe('arbitration: the router is pinned once deployed', () => {
  it('nothing is pinned on Base today', () => { expect(ARBITRATION_ON_BASE.router).toBeNull(); expect(resolveByCode(POOL, JOB).to).toBe(POOL); });
  it('a pinned router refuses any other address', () => {
    expect(checkRouter(POOL, POOL.toLowerCase())).toBe(POOL);
    expect(() => checkRouter(OTHER, POOL)).toThrow(/not the pinned ArbitratorRouter/);
    expect(() => checkRouter('0x12', null)).toThrow(/not an address/);
  });
});

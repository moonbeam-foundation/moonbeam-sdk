// _ECONOMY_BUILDERS_v1_: the assurance hook V5.1 economy calls as unsigned calls (src/economy), checked three ways.
//   1. encoding: every builder's calldata equals viem's encodeFunctionData with the hook's compiled ABI (fixture), and the role
//      each call names is the one the hook's source lets call it (fixture: the reverts and msg.sender checks per function);
//   2. endings: legsOf reproduces, to the unit, the money of the devnet run that ended one job in every way (fixture: the run's
//      ledger, trimmed to its amounts), for the quote every job there was opened with;
//   3. the chain guard: the devnet only, unless { allowMainnet: true }.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, toFunctionSignature, type Abi, type AbiFunction, type Hex } from 'viem';
import {
  ECONOMY_CHAIN_IDS, ECONOMY_ENDINGS, ECONOMY_ROLES, ECONOMY_SIGNATURES, EconomyChainError, SETTLED_ENDING, VERDICT,
  accept, assertEconomyChain, cancelOpen, claimAutoComplete, complete, dispute, expire, finalizeReject, findCheated, jobIdFor, legsOf,
  openJobWithEconomy, poolDeposit, poolRedeem, reject, resolveDispute, settleStaleDispute, submit, submitWithDelivery, sweepLayerFees,
} from '../src/economy/index.js';
import type { EconomyCall, EconomyEnding, EconomyQuote, EconomyRole, EconTerms, JobTerms } from '../src/economy/index.js';
import { signatureOf } from '../src/abi/index.js';

const FIX = join(__dirname, 'fixtures', 'economy');
const read = <T>(f: string): T => JSON.parse(readFileSync(join(FIX, f), 'utf8')) as T;
const ABI = read<{ hook: Abi; adapter: Abi; pool: Abi }>('hook-v5.1.abi.json');
type Access = { reverts: string[]; senderChecks: string[]; onlyOwner: boolean; via: string[] };
const ACCESS = read<{ hook: Record<string, Access>; adapter: Record<string, Access> }>('hook-v5.1.access.json');
type Ev = { event: string; [k: string]: string | number };
const RUN = read<{ chainId: number; quote: Record<string, number>; ledger: { job: number; ending: string; state: string; events: Ev[] }[]; hookEvents: Ev[] }>('36927-v5.1-economy.ledger.json');

const DEVNET = 36927;
const HOOK = '0x00000000000000000000000000000000000000a1' as const;
const ADAPTER = '0x00000000000000000000000000000000000000a2' as const;
const POOL = '0x00000000000000000000000000000000000000a3' as const;
const TOKEN = '0x00000000000000000000000000000000000000a4' as const;
const SELLER = '0x00000000000000000000000000000000000000b2' as const;
const BUYER = '0x00000000000000000000000000000000000000b1' as const;
const EVALUATOR = ADAPTER;
const JOB = ('0x' + '11'.repeat(32)) as Hex;
const DIGEST = ('0x' + '22'.repeat(32)) as Hex;
const SALT = ('0x' + '33'.repeat(32)) as Hex;
const SPEC = ('0x' + '44'.repeat(32)) as Hex;

// the run's quote, as the SDK names it (the run's ledger calls the protocol fee by the hook's field name)
const Q = RUN.quote;
const QUOTE: EconomyQuote = {
  price: BigInt(Q.price!), premium: BigInt(Q.premium!), toBackers: BigInt(Q.toBackers!), protocolFee: BigInt(Q.toLayer!),
  deposit: BigInt(Q.deposit!), compensation: BigInt(Q.compensation!), evaluatorFee: BigInt(Q.evaluatorFee!),
  // the run quoted at the default cover multiple, 1x (jev-wilson quoteEconomy: coverCap = price x 10,000 / 10,000)
  coverCap: BigInt(Q.price!),
};
const TERMS: JobTerms = {
  seller: SELLER, token: TOKEN, price: QUOTE.price, premium: QUOTE.premium, deposit: QUOTE.deposit, deadline: 1_800_000_660,
  pool: POOL, coverCap: QUOTE.coverCap!, evaluator: EVALUATOR, evaluatorFee: QUOTE.evaluatorFee, reviewWindow: 60, disputeWindow: 60,
};
const ECON: EconTerms = { toBackers: QUOTE.toBackers, protocolFee: QUOTE.protocolFee, compensation: QUOTE.compensation };

const fn = (abi: Abi, name: string): AbiFunction => {
  const f = abi.filter((x): x is AbiFunction => x.type === 'function' && x.name === name);
  expect(f, name).toHaveLength(1);
  return f[0]!;
};
type Want = { abi: Abi; to: string; functionName: string; args: readonly unknown[] };
const enc = (w: Want) => encodeFunctionData({ abi: w.abi, functionName: w.functionName, args: w.args } as never);

/** Every builder, a call of it, the calls it must return (viem-encoded) and the role that signs them. */
const CASES: { name: string; build: () => EconomyCall[]; want: Want[]; signer: EconomyRole; access: Access | null }[] = [
  { name: 'openJobWithEconomy', signer: 'buyer', access: ACCESS.hook.openJobWithEconomy!,
    build: () => openJobWithEconomy({ chainId: DEVNET, hook: HOOK, salt: SALT, terms: TERMS, econ: ECON, spec: { digest: SPEC, uri: 'ipfs://task' } }),
    want: [
      { abi: erc20Abi, to: TOKEN, functionName: 'approve', args: [HOOK, QUOTE.price + QUOTE.premium + QUOTE.evaluatorFee] },
      { abi: ABI.hook, to: HOOK, functionName: 'openJobWithEconomy', args: [SALT,
        { seller: SELLER, token: TOKEN, price: QUOTE.price, premium: QUOTE.premium, deposit: QUOTE.deposit, deadline: 1_800_000_660n, challengeWindow: 0n,
          pool: POOL, coverCap: QUOTE.coverCap, evaluator: EVALUATOR, evaluatorFee: QUOTE.evaluatorFee, reviewWindow: 60, disputeWindow: 60, paymentRef: ('0x' + '0'.repeat(64)) },
        { toBackers: QUOTE.toBackers, toLayer: QUOTE.protocolFee, compensation: QUOTE.compensation },
        { digest: SPEC, uri: 'ipfs://task' }] },
    ] },
  { name: 'accept', signer: 'seller', access: ACCESS.hook.accept!,
    build: () => accept({ chainId: DEVNET, hook: HOOK, jobId: JOB, token: TOKEN, deposit: QUOTE.deposit }),
    want: [{ abi: erc20Abi, to: TOKEN, functionName: 'approve', args: [HOOK, QUOTE.deposit] }, { abi: ABI.hook, to: HOOK, functionName: 'accept', args: [JOB] }] },
  { name: 'submit', signer: 'seller', access: ACCESS.hook.submit!,
    build: () => submit({ chainId: DEVNET, hook: HOOK, jobId: JOB, evidenceDigest: DIGEST }),
    want: [{ abi: ABI.hook, to: HOOK, functionName: 'submit', args: [JOB, DIGEST] }] },
  { name: 'submitWithDelivery', signer: 'seller', access: ACCESS.hook.submitWithDelivery!,
    build: () => submitWithDelivery({ chainId: DEVNET, hook: HOOK, jobId: JOB, evidenceDigest: DIGEST, deliveryURI: 'https://example.org/work.json' }),
    want: [{ abi: ABI.hook, to: HOOK, functionName: 'submitWithDelivery', args: [JOB, DIGEST, 'https://example.org/work.json'] }] },
  { name: 'complete (hook)', signer: 'evaluator', access: ACCESS.hook.complete!,
    build: () => complete({ chainId: DEVNET, hook: HOOK, jobId: JOB }),
    want: [{ abi: ABI.hook, to: HOOK, functionName: 'complete', args: [JOB] }] },
  { name: 'complete (adapter postVerdict)', signer: 'evaluator', access: ACCESS.adapter.postVerdict!,
    build: () => complete({ chainId: DEVNET, adapter: ADAPTER, jobId: JOB, digest: DIGEST, mode: 'calibrated' }),
    want: [{ abi: ABI.adapter, to: ADAPTER, functionName: 'postVerdict', args: [JOB, 1, 2, DIGEST] }] },
  { name: 'reject (hook)', signer: 'evaluator', access: ACCESS.hook.reject!,
    build: () => reject({ chainId: DEVNET, hook: HOOK, jobId: JOB, verdictDigest: DIGEST }),
    want: [{ abi: ABI.hook, to: HOOK, functionName: 'reject', args: [JOB, DIGEST] }] },
  { name: 'reject (adapter postVerdict)', signer: 'evaluator', access: ACCESS.adapter.postVerdict!,
    build: () => reject({ chainId: DEVNET, adapter: ADAPTER, jobId: JOB, verdictDigest: DIGEST }),
    want: [{ abi: ABI.adapter, to: ADAPTER, functionName: 'postVerdict', args: [JOB, 2, 1, DIGEST] }] },
  { name: 'reject (adapter, malformed)', signer: 'evaluator', access: ACCESS.adapter.postVerdict!,
    build: () => reject({ chainId: DEVNET, adapter: ADAPTER, jobId: JOB, verdictDigest: DIGEST, malformed: true }),
    want: [{ abi: ABI.adapter, to: ADAPTER, functionName: 'postVerdict', args: [JOB, 3, 1, DIGEST] }] },
  { name: 'finalizeReject', signer: 'keeper', access: ACCESS.hook.finalizeReject!,
    build: () => finalizeReject({ chainId: DEVNET, hook: HOOK, jobId: JOB }), want: [{ abi: ABI.hook, to: HOOK, functionName: 'finalizeReject', args: [JOB] }] },
  { name: 'dispute', signer: 'seller', access: ACCESS.hook.dispute!,
    build: () => dispute({ chainId: DEVNET, hook: HOOK, jobId: JOB }), want: [{ abi: ABI.hook, to: HOOK, functionName: 'dispute', args: [JOB] }] },
  { name: 'resolveDispute (seller wins)', signer: 'arbitrator', access: ACCESS.hook.resolveDispute!,
    build: () => resolveDispute({ chainId: DEVNET, hook: HOOK, jobId: JOB, sellerWins: true }), want: [{ abi: ABI.hook, to: HOOK, functionName: 'resolveDispute', args: [JOB, true] }] },
  { name: 'resolveDispute (buyer wins)', signer: 'arbitrator', access: ACCESS.hook.resolveDispute!,
    build: () => resolveDispute({ chainId: DEVNET, hook: HOOK, jobId: JOB, sellerWins: false }), want: [{ abi: ABI.hook, to: HOOK, functionName: 'resolveDispute', args: [JOB, false] }] },
  { name: 'settleStaleDispute', signer: 'keeper', access: ACCESS.hook.settleStaleDispute!,
    build: () => settleStaleDispute({ chainId: DEVNET, hook: HOOK, jobId: JOB }), want: [{ abi: ABI.hook, to: HOOK, functionName: 'settleStaleDispute', args: [JOB] }] },
  { name: 'findCheated', signer: 'arbitrator', access: ACCESS.hook.findCheated!,
    build: () => findCheated({ chainId: DEVNET, hook: HOOK, jobId: JOB, loss: 3_500_000n }), want: [{ abi: ABI.hook, to: HOOK, functionName: 'findCheated', args: [JOB, 3_500_000n] }] },
  { name: 'expire', signer: 'keeper', access: ACCESS.hook.expire!,
    build: () => expire({ chainId: DEVNET, hook: HOOK, jobId: JOB }), want: [{ abi: ABI.hook, to: HOOK, functionName: 'expire', args: [JOB] }] },
  { name: 'claimAutoComplete', signer: 'keeper', access: ACCESS.hook.claimAutoComplete!,
    build: () => claimAutoComplete({ chainId: DEVNET, hook: HOOK, jobId: JOB }), want: [{ abi: ABI.hook, to: HOOK, functionName: 'claimAutoComplete', args: [JOB] }] },
  { name: 'cancelOpen', signer: 'buyer', access: ACCESS.hook.cancelOpen!,
    build: () => cancelOpen({ chainId: DEVNET, hook: HOOK, jobId: JOB }), want: [{ abi: ABI.hook, to: HOOK, functionName: 'cancelOpen', args: [JOB] }] },
  { name: 'sweepLayerFees', signer: 'keeper', access: ACCESS.hook.sweepLayerFees!,
    build: () => sweepLayerFees({ chainId: DEVNET, hook: HOOK }), want: [{ abi: ABI.hook, to: HOOK, functionName: 'sweepLayerFees', args: [] }] },
  { name: 'poolDeposit', signer: 'backer', access: null,
    build: () => poolDeposit({ chainId: DEVNET, pool: POOL, asset: TOKEN, amount: 10n ** 7n, receiver: BUYER }),
    want: [{ abi: erc20Abi, to: TOKEN, functionName: 'approve', args: [POOL, 10n ** 7n] }, { abi: ABI.pool, to: POOL, functionName: 'deposit', args: [10n ** 7n, BUYER] }] },
  { name: 'poolRedeem', signer: 'backer', access: null,
    build: () => poolRedeem({ chainId: DEVNET, pool: POOL, shares: 5n, owner: BUYER }),
    want: [{ abi: ABI.pool, to: POOL, functionName: 'redeem', args: [5n, BUYER, BUYER] }] },
];

describe('_ECONOMY_BUILDERS_v1_ encoding: every builder equals viem with the hook ABI', () => {
  it('the fixture is the hook V5.1 build: every function the builders call is in its ABI', () => {
    for (const name of ['openJobWithEconomy', 'accept', 'submit', 'submitWithDelivery', 'complete', 'reject', 'finalizeReject', 'dispute', 'resolveDispute',
      'settleStaleDispute', 'findCheated', 'expire', 'claimAutoComplete', 'cancelOpen', 'sweepLayerFees']) fn(ABI.hook, name);
    fn(ABI.adapter, 'postVerdict'); fn(ABI.pool, 'deposit'); fn(ABI.pool, 'redeem');
    expect(ABI.hook.some((x) => x.type === 'error' && x.name === 'BuyerCannotReject')).toBe(true);
  });

  it('each signature hashes to the compiled function (names aside)', () => {
    const where: Record<string, Abi> = { postVerdict: ABI.adapter, deposit: ABI.pool, redeem: ABI.pool, approve: erc20Abi };
    for (const [name, sig] of Object.entries(ECONOMY_SIGNATURES))
      expect(signatureOf(sig), name).toBe(toFunctionSignature(fn(where[name] ?? ABI.hook, name)));
  });

  for (const c of CASES) {
    it(`${c.name}: calldata, target, chain and signer`, () => {
      const got = c.build();
      expect(got.map((x) => x.data)).toEqual(c.want.map(enc));
      expect(got.map((x) => x.to.toLowerCase())).toEqual(c.want.map((w) => w.to.toLowerCase()));
      for (const x of got) {
        expect(x.chainId).toBe(DEVNET);
        expect(x.value).toBe('0x0');
        expect(x.signer).toBe(c.signer);
        expect(x.effect.length).toBeGreaterThan(10);
      }
      expect(got.at(-1)!.step).toBe(c.want.at(-1)!.functionName);
    });
  }

  it('every role is used, and every hook function has a builder', () => {
    expect(new Set(CASES.map((c) => c.signer))).toEqual(new Set(ECONOMY_ROLES));
    for (const name of Object.keys(ACCESS.hook)) expect(CASES.some((c) => c.want.some((w) => w.functionName === name)), name).toBe(true);
  });

  it('the job id is keccak256(abi.encode(chainId, hook, buyer, salt))', () => {
    const want = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }], [BigInt(DEVNET), HOOK, BUYER, SALT]));
    expect(jobIdFor({ chainId: DEVNET, hook: HOOK, buyer: BUYER, salt: SALT })).toBe(want);
  });

  it('no spec is digest 0 and uri "" (the hook commits none)', () => {
    const [, open] = openJobWithEconomy({ chainId: DEVNET, hook: HOOK, salt: SALT, terms: TERMS, econ: ECON });
    const want = enc({ ...CASES[0]!.want[1]!, args: [...(CASES[0]!.want[1]!.args.slice(0, 3)), { digest: '0x' + '0'.repeat(64), uri: '' }] });
    expect(open!.data).toBe(want);
  });
});

describe('_ECONOMY_BUILDERS_v1_ roles: each signer is the one the hook source lets call', () => {
  const GUARDS = ['NotBuyer', 'NotSeller', 'NotEvaluator', 'NotJobEvaluator', 'NotArbitrator', 'BuyerCannotReject'];
  const guards = (a: Access) => a.reverts.filter((r) => GUARDS.includes(r));
  for (const c of CASES) {
    if (!c.access) continue;
    it(`${c.name} → ${c.signer}`, () => {
      const a = c.access!; const g = guards(a);
      expect(a.onlyOwner).toBe(false);
      switch (c.signer) {
        case 'buyer': expect(g.includes('NotBuyer') || a.senderChecks.some((l) => l.includes('jobIdFor(msg.sender'))).toBe(true); expect(g.filter((x) => x !== 'NotBuyer')).toEqual([]); break;
        case 'seller': expect(g).toEqual(['NotSeller']); break;
        case 'evaluator': expect(g.length).toBeGreaterThan(0); expect(g.every((x) => ['NotEvaluator', 'NotJobEvaluator', 'BuyerCannotReject'].includes(x))).toBe(true); break;
        case 'arbitrator': expect(g).toEqual(['NotArbitrator']); break;
        case 'keeper': expect(g).toEqual([]); expect(a.senderChecks).toEqual([]); break;
        default: throw new Error(`no access rule for ${c.signer}`);
      }
    });
  }
  it('reject is evaluator-only: the hook has BuyerCannotReject, and the SDK refuses the buyer', () => {
    expect(ACCESS.hook.reject!.reverts).toContain('BuyerCannotReject');
    expect(() => reject({ chainId: DEVNET, hook: HOOK, jobId: JOB, verdictDigest: DIGEST, as: 'buyer' })).toThrow(/BuyerCannotReject/);
  });
  it('the buyer completes only directly (a job naming no evaluator), never through the adapter', () => {
    expect(complete({ chainId: DEVNET, hook: HOOK, jobId: JOB, as: 'buyer' })[0]!.signer).toBe('buyer');
    expect(() => complete({ chainId: DEVNET, adapter: ADAPTER, jobId: JOB, digest: DIGEST, as: 'buyer' })).toThrow(/NotEvaluator/);
    expect(VERDICT.conformant).toBe(1);
  });
});

describe('_ECONOMY_BUILDERS_v1_ endings: legsOf reproduces the devnet ledger to the unit', () => {
  // the run's job plan (its proof script): one job for every ending
  const PLAN: Record<number, { ending: EconomyEnding; text: RegExp }> = {
    1: { ending: 'completed', text: /^completed \(complete by/ },
    2: { ending: 'cheated', text: /^cheated$/ },
    3: { ending: 'rejected', text: /^rejected_delivered \(the rejection stood/ },
    4: { ending: 'no_show', text: /no-show/ },
    5: { ending: 'dispute_seller_won', text: /dispute won by the seller/ },
    6: { ending: 'rejected', text: /the arbitrator for the buyer/ },
    7: { ending: 'rejected', text: /stale dispute/ },
    8: { ending: 'cancelled', text: /^cancelled offer$/ },
    9: { ending: 'lapsed', text: /^lapsed offer/ },
    10: { ending: 'auto_completed', text: /^auto-completed$/ },
  };
  const CODE: Record<EconomyEnding, number> = { completed: 1, no_show: 2, lapsed: 2, rejected: 3, cheated: 4, auto_completed: 5, dispute_seller_won: 6, cancelled: 7 };
  const ev = (j: { events: Ev[] }, name: string): Ev | undefined => j.events.find((e) => e.event === name);
  const n = (e: Ev | undefined, k: string): bigint => (e ? BigInt(e[k] as number) : 0n);

  it('the run is the devnet with one job per ending, all opened with the one quote', () => {
    expect(RUN.chainId).toBe(DEVNET);
    expect(RUN.ledger.map((j) => j.job)).toEqual(Object.keys(PLAN).map(Number));
    for (const j of RUN.ledger) {
      expect(j.ending, `job ${j.job}`).toMatch(PLAN[j.job]!.text);
      const c = ev(j, 'EconomyCommitted')!;
      expect([n(c, 'toBackers'), n(c, 'toLayer'), n(c, 'compensation')]).toEqual([QUOTE.toBackers, QUOTE.protocolFee, QUOTE.compensation]);
    }
    expect(new Set(Object.values(PLAN).map((p) => p.ending))).toEqual(new Set(ECONOMY_ENDINGS));
  });

  for (const j of RUN.ledger) {
    const plan = PLAN[j.job]!;
    it(`job ${j.job}: ${plan.ending}`, () => {
      const cheat = ev(j, 'Cheated');
      const legs = legsOf(plan.ending, QUOTE, cheat ? { loss: n(cheat, 'loss') } : {});
      const settled = ev(j, 'Settled')!;
      expect(Number(settled.ending)).toBe(CODE[plan.ending]);
      expect(SETTLED_ENDING[CODE[plan.ending] as keyof typeof SETTLED_ENDING]).toBeDefined();
      expect(legs.seller).toBe(n(settled, 'toSeller'));
      // the pool pays a cheat's buyer itself: Settled counts what the hook paid
      expect(legs.buyer).toBe(n(settled, 'toBuyer') + n(cheat, 'fromPool'));
      expect(legs.backers).toBe(n(settled, 'toPool'));
      expect(legs.backers).toBe(n(ev(j, 'PremiumSplit'), 'toBackers'));
      expect(legs.protocolFee).toBe(n(ev(j, 'PremiumSplit'), 'toLayer'));
      expect(legs.evaluator).toBe(n(settled, 'toEvaluator'));
      expect(legs.evaluator).toBe(n(ev(j, 'EvaluatorFeePaid'), 'amount'));
      expect(legs.feeRefunded).toBe(n(ev(j, 'EvaluatorFeeRefunded'), 'amount'));
      expect(legs.compensation).toBe(n(ev(j, 'NoShowCompensated') ?? ev(j, 'RejectionCompensated'), 'amount'));
      expect(legs.fromDeposit).toBe(n(cheat, 'fromDeposit'));
      expect(legs.fromPool).toBe(n(cheat, 'fromPool'));
      // value is conserved: what the job held (the deposit once accepted) plus what the pool paid
      const accepted = !['cancelled', 'lapsed'].includes(plan.ending);
      const held = QUOTE.price + QUOTE.premium + QUOTE.evaluatorFee + (accepted ? QUOTE.deposit : 0n) + legs.fromPool;
      expect(legs.buyer + legs.seller + legs.backers + legs.protocolFee + legs.evaluator).toBe(held);
    });
  }

  it('the protocol fees the run swept are the completed jobs\' protocol fee legs', () => {
    const swept = RUN.hookEvents.find((e) => e.event === 'LayerFeesSwept')!;
    const sum = RUN.ledger.reduce((s, j) => s + legsOf(PLAN[j.job]!.ending, QUOTE, { loss: n(ev(j, 'Cheated'), 'loss') }).protocolFee, 0n);
    expect(sum).toBe(BigInt(swept.amount as number));
  });

  it('cheated needs the loss and the cover cap; a legs mismatch is refused', () => {
    expect(() => legsOf('cheated', QUOTE)).toThrow(/loss/);
    const { coverCap: _cap, ...noCap } = QUOTE;
    expect(() => legsOf('cheated', noCap, { loss: 1n })).toThrow(/coverCap/);
    expect(() => legsOf('completed', { ...QUOTE, protocolFee: QUOTE.protocolFee + 1n })).toThrow(/sum to the premium/);
    // a small loss: the deposit pays it all, the pool nothing, the rest of the deposit goes back to the seller
    const small = legsOf('cheated', QUOTE, { loss: 1_000n });
    expect([small.fromDeposit, small.fromPool, small.seller]).toEqual([1_000n, 0n, QUOTE.deposit - 1_000n]);
  });
});

describe('_ECONOMY_BUILDERS_v1_ chain guard: the devnet only, unless allowMainnet', () => {
  it('the devnet is the one chain open', () => {
    expect(ECONOMY_CHAIN_IDS).toEqual([DEVNET]);
    expect(() => assertEconomyChain(DEVNET)).not.toThrow();
    expect(() => assertEconomyChain(0)).toThrow(RangeError);
  });
  it('8453 is refused by every builder without allowMainnet, and built with it', () => {
    const on = (chainId: number, allowMainnet?: boolean): (() => EconomyCall[])[] => {
      const o = { chainId, ...(allowMainnet ? { allowMainnet } : {}) };
      return [
        () => openJobWithEconomy({ ...o, hook: HOOK, salt: SALT, terms: TERMS, econ: ECON }),
        () => accept({ ...o, hook: HOOK, jobId: JOB, token: TOKEN, deposit: 2n }),
        () => submit({ ...o, hook: HOOK, jobId: JOB, evidenceDigest: DIGEST }),
        () => submitWithDelivery({ ...o, hook: HOOK, jobId: JOB, evidenceDigest: DIGEST, deliveryURI: 'ipfs://x' }),
        () => complete({ ...o, hook: HOOK, jobId: JOB }),
        () => complete({ ...o, adapter: ADAPTER, jobId: JOB, digest: DIGEST }),
        () => reject({ ...o, hook: HOOK, jobId: JOB, verdictDigest: DIGEST }),
        () => finalizeReject({ ...o, hook: HOOK, jobId: JOB }),
        () => dispute({ ...o, hook: HOOK, jobId: JOB }),
        () => resolveDispute({ ...o, hook: HOOK, jobId: JOB, sellerWins: true }),
        () => settleStaleDispute({ ...o, hook: HOOK, jobId: JOB }),
        () => findCheated({ ...o, hook: HOOK, jobId: JOB, loss: 1n }),
        () => expire({ ...o, hook: HOOK, jobId: JOB }),
        () => claimAutoComplete({ ...o, hook: HOOK, jobId: JOB }),
        () => cancelOpen({ ...o, hook: HOOK, jobId: JOB }),
        () => sweepLayerFees({ ...o, hook: HOOK }),
        () => poolDeposit({ ...o, pool: POOL, asset: TOKEN, amount: 1n, receiver: BUYER }),
        () => poolRedeem({ ...o, pool: POOL, shares: 1n, owner: BUYER }),
      ];
    };
    for (const b of on(8453)) {
      expect(b).toThrow(EconomyChainError);
      expect(b).toThrow(/chain 8453 is not the devnet .*allowMainnet: true/);
    }
    for (const b of on(8453, true)) for (const c of b()) expect(c.chainId).toBe(8453);
    expect(on(8453).length).toBe(CASES.length - 3); // every case but the second resolveDispute and the two adapter rejects
  });
});

describe('_ECONOMY_BUILDERS_v1_ refusals before anything is signed', () => {
  const open = (t: Partial<JobTerms>, e: Partial<EconTerms> = {}, spec?: { digest: Hex; uri?: string }) =>
    () => openJobWithEconomy({ chainId: DEVNET, hook: HOOK, salt: SALT, terms: { ...TERMS, ...t }, econ: { ...ECON, ...e }, ...(spec ? { spec } : {}) });
  it('names the hook revert it saves you', () => {
    expect(open({}, { protocolFee: 1n })).toThrow(/EconomyTerms\(1\)/);
    expect(open({ pool: '0x0000000000000000000000000000000000000000', coverCap: 0n })).toThrow(/EconomyTerms\(2\)/);
    expect(open({}, { toBackers: 0n, protocolFee: QUOTE.premium })).toThrow(/EconomyTerms\(4\)/);
    expect(open({}, { compensation: QUOTE.price + 1n })).toThrow(/EconomyTerms\(5\)/);
    expect(open({ deposit: QUOTE.price })).toThrow(/DepositNotAbovePrice/);
    expect(open({ evaluatorFee: QUOTE.price })).toThrow(/FeeTooHigh/);
    expect(open({ evaluator: SELLER })).toThrow(/EvaluatorIsSeller/);
    expect(open({ reviewWindow: 31 * 86_400 })).toThrow(/BadWindow/);
    expect(open({ coverCap: 0n })).toThrow(/PoolWithoutCover/);
    expect(open({}, {}, { digest: ('0x' + '0'.repeat(64)) as Hex, uri: 'ipfs://x' })).toThrow(/SpecDigestZero/);
    expect(open({}, {}, { digest: SPEC, uri: 'x'.repeat(513) })).toThrow(/URITooLong/);
    expect(() => submitWithDelivery({ chainId: DEVNET, hook: HOOK, jobId: JOB, evidenceDigest: DIGEST, deliveryURI: '' })).toThrow(/DeliveryURIEmpty/);
  });
  it('takes the hook and pool from the caller: a bad address or job id is refused', () => {
    expect(() => expire({ chainId: DEVNET, hook: '0x12' as never, jobId: JOB })).toThrow(/hook is not an address/);
    expect(() => expire({ chainId: DEVNET, hook: HOOK, jobId: '0x12' as never })).toThrow(/jobId is not 32 bytes/);
    expect(() => complete({ chainId: DEVNET, jobId: JOB } as never)).toThrow(/hook, or the judge adapter/);
    expect(() => complete({ chainId: DEVNET, hook: HOOK, adapter: ADAPTER, jobId: JOB } as never)).toThrow(/not both/);
    expect(() => poolRedeem({ chainId: DEVNET, pool: POOL, shares: 0n, owner: BUYER })).toThrow(/positive/);
  });
});

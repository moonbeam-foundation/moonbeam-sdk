// _PLAYGROUND_NETS_v1_: the playground's one switch between the devnet (36927) and Base (8453), src/playground.
//   1. the table: who signs each role per net, no address in it, and the gaps it names (Base has no evaluator or arbitrator yet);
//   2. same structure: every built case has the same [stage, fn, role] steps on both nets; only signers, chain and addresses differ;
//   3. the money: each case's legs match the worked numbers and the devnet run's ledger, and sum to what the job held;
//   4. the gates: Base refuses without allowMainnet, a budget and two green devnet runs; a placement for another chain is refused;
//   5. runs through ports (in-memory fakes only): a light turns on only from an ack plus a chain event;
//   6. docs/playground.md is generated from the table and the cases, and never drifts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAddress, type Hex } from 'viem';
import { openJobWithEconomy } from '../src/economy/index.js';
import type { EconomyQuote, EndingLegs } from '../src/economy/index.js';
import {
  CASE_IDS, CASES, NETS, PlacementError, PlaygroundGateError, SIGNER_ROLES, VIAS, checkPlacement, fakePorts, gapsOf,
  isChecksumAddress, playground, playgroundDoc, rolesOf, statusOn, stepsOf, toChecksum,
} from '../src/playground/index.js';
import type { CaseId, Placement, Plan, PlanArgs, PlaygroundOptions, Via } from '../src/playground/index.js';

type Ev = { event: string; [k: string]: string | number };
const RUN = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'economy', '36927-v5.1-economy.ledger.json'), 'utf8')) as
  { chainId: number; quote: Record<string, number>; ledger: { job: number; ending: string; events: Ev[] }[]; hookEvents: Ev[] };

// made-up addresses, checksummed
const A = (b: string): `0x${string}` => getAddress(`0x${b.repeat(40 / b.length)}`);
const DEV: Placement = { chainId: 36927, hook: A('a1'), token: A('a4'), judgeAdapter: A('a2'), pool: A('a3'), vault: A('a5') };
const BASE: Placement = { chainId: 8453, hook: A('c1'), token: A('c4'), judgeAdapter: A('c2'), pool: A('c3'), vault: A('c5'),
  windows: { reviewS: 60, disputeS: 60, arbitrationS: 120 } };
const PARTIES = { buyer: A('b1'), seller: A('b2'), backer: A('b3') };
const SALT = ('0x' + '33'.repeat(32)) as Hex;
const DIG = { evidenceDigest: ('0x' + '22'.repeat(32)) as Hex, verdictDigest: ('0x' + '44'.repeat(32)) as Hex };
const MARKET = 'erc8183-base';
const GREEN = { market: MARKET, runs: ['devnet-run-1', 'devnet-run-2'] };
const BASE_OPTS: PlaygroundOptions = { net: 'base', placement: BASE, allowMainnet: true, budget: { perRunUnits: 10_000_000n }, devnetGreen: GREEN };

// the worked numbers (the devnet run's quote)
const QUOTE: EconomyQuote = { price: 1_000_000n, premium: 111_750n, toBackers: 94_803n, protocolFee: 16_947n, deposit: 1_111_750n,
  compensation: 111_750n, evaluatorFee: 10_000n, coverCap: 1_000_000n };
const LOSS = 3_500_000n;
const args = (via?: Via, x: Partial<PlanArgs> = {}): PlanArgs =>
  ({ market: MARKET, quote: QUOTE, salt: SALT, parties: PARTIES, deadline: 1_800_000_660, ...DIG, ...(via ? { via } : {}), loss: LOSS, ...x });

/** Every built case, with each via of `rejected`. */
const BUILT: { id: CaseId; via?: Via }[] = CASE_IDS.filter((id) => CASES[id].status === 'planned')
  .flatMap((id) => (CASES[id].vias ? CASES[id].vias!.map((via) => ({ id, via })) : [{ id }]));
const label = (c: { id: CaseId; via?: Via }) => (c.via ? `${c.id} (${c.via})` : c.id);
const MOONBEAM_ROLES = new Set(['evaluator', 'arbitrator', 'keeper', 'payout']);

const dev = playground({ net: 'devnet', placement: DEV });
const base = playground(BASE_OPTS);
const baseFilled = playground({ ...BASE_OPTS, __testOnlySigners: { evaluator: 'coord:test.evaluate', arbitrator: 'coord:test.arbitrate' } });

describe('_PLAYGROUND_NETS_v1_ the table', () => {
  it('devnet and Base, frozen, with their chain, token and windows', () => {
    expect(Object.keys(NETS)).toEqual(['devnet', 'base']);
    expect(Object.isFrozen(NETS) && Object.isFrozen(NETS.devnet.signers) && Object.isFrozen(NETS.base.windows)).toBe(true);
    expect([NETS.devnet.chainId, NETS.base.chainId]).toEqual([36927, 8453]);
    expect(NETS.devnet.token).toEqual({ symbol: 'dUSDC', decimals: 6 });
    expect(NETS.base.token).toEqual({ symbol: 'USDC', decimals: 6 });
    expect(NETS.devnet.windows).toMatchObject({ reviewS: 60, arbitrationS: 120 });
    expect(NETS.base.windows).toEqual({ reviewS: null, disputeS: null, arbitrationS: null });
    expect(() => { (NETS.devnet.signers as Record<string, string>).buyer = 'coord:x'; }).toThrow();
  });
  it('who signs each role', () => {
    expect(NETS.devnet.signers).toEqual({ buyer: 'wallet:test', seller: 'wallet:test', backer: 'wallet:test',
      evaluator: 'coord:devnet.evaluate', arbitrator: 'coord:devnet.arbitrate', keeper: 'coord:devnet.keeper', payout: 'coord:devnet.payout' });
    expect(NETS.base.signers).toEqual({ buyer: 'wallet:user', seller: 'wallet:user', backer: 'wallet:user',
      evaluator: null, arbitrator: null, keeper: 'coord:keeper.end', payout: 'coord:payout.seller' });
    expect(Object.keys(NETS.base.signers).sort()).toEqual([...SIGNER_ROLES].sort());
  });
  it('holds no address', () => {
    expect(JSON.stringify(NETS)).not.toMatch(/0x[0-9a-fA-F]{40}/);
  });
  it('gapsOf: none on the devnet; on Base the evaluator and the arbitrator, with the cases they block', () => {
    expect(gapsOf('devnet')).toEqual([]);
    expect(gapsOf('base')).toEqual([
      { role: 'evaluator', blocks: [{ case: 'delivered-accepted' }, { case: 'rejected', via: 'finalize' }, { case: 'rejected', via: 'arbitrated' },
        { case: 'rejected', via: 'stale' }, { case: 'rejection-overturned' }] },
      { role: 'arbitrator', blocks: [{ case: 'rejected', via: 'arbitrated' }, { case: 'rejection-overturned' }, { case: 'cheated' }] },
    ]);
  });
});

describe('_PLAYGROUND_NETS_v1_ the placement', () => {
  it('checksums like viem (EIP-55)', () => {
    for (const b of ['a1', 'c4', 'de', '7f', '0b']) expect(toChecksum(A(b).toLowerCase())).toBe(A(b));
    expect(isChecksumAddress(A('a1'))).toBe(true);
    expect(isChecksumAddress(A('a1').toLowerCase())).toBe(false);
  });
  it('refuses a placement for another chain, an unchecksummed or a zero address, and Base without the hook\'s windows', () => {
    expect(() => checkPlacement('devnet', { ...DEV, chainId: 8453 })).toThrow(PlacementError);
    expect(() => playground({ ...BASE_OPTS, placement: { ...BASE, chainId: 36927 } })).toThrow(/placement is for chain 36927, but base is chain 8453/);
    expect(() => playground({ net: 'devnet', placement: { ...DEV, chainId: 8453 } })).toThrow(PlacementError);
    expect(() => checkPlacement('devnet', { ...DEV, hook: DEV.hook.toLowerCase() as never })).toThrow(/placement.hook is not a checksummed address/);
    expect(() => checkPlacement('devnet', { ...DEV, pool: '0x0000000000000000000000000000000000000000' })).toThrow(/zero address/);
    const { windows: _w, ...noWindows } = BASE;
    expect(() => playground({ ...BASE_OPTS, placement: noWindows })).toThrow(/reads reviewS from the hook/);
    expect(() => playground({ net: 'devnet', placement: { ...DEV, windows: { reviewS: 61 } } })).toThrow(/fixes it at 60/);
  });
});

describe('_PLAYGROUND_NETS_v1_ same structure on both networks', () => {
  for (const c of BUILT) {
    it(`${label(c)}: the same [stage, fn, role]; only signer, chain and addresses differ`, () => {
      const d = dev.plan(c.id, args(c.via)), b = baseFilled.plan(c.id, args(c.via));
      expect(d.status).toBe('planned');
      expect(b.steps.map((s) => [s.stage, s.fn, s.role])).toEqual(d.steps.map((s) => [s.stage, s.fn, s.role]));
      expect(d.steps.map((s) => [s.stage, s.fn, s.role])).toEqual(stepsOf(c.id, c.via).map((t) => [t.stage, t.fn, t.role]));
      expect([d.chainId, b.chainId]).toEqual([36927, 8453]);
      expect(b.legs).toEqual(d.legs);
      expect(b.lights.map((l) => [l.light, l.expected])).toEqual(d.lights.map((l) => [l.light, l.expected]));
      // the calldata is the same once the devnet's addresses (and the job id, which hashes the chain) are swapped for Base's
      const swap: [string, string][] = (['hook', 'token', 'judgeAdapter', 'pool'] as const).map((k) => [DEV[k].slice(2).toLowerCase(), BASE[k].slice(2).toLowerCase()]);
      if (d.jobId) swap.push([d.jobId.slice(2), b.jobId!.slice(2)]);
      const to = (x: string) => swap.reduce((s, [f, t]) => s.split(f).join(t), x.toLowerCase());
      for (const [i, s] of d.steps.entries()) {
        const bs = b.steps[i]!;
        expect(bs.call.chainId).toBe(8453); expect(s.call.chainId).toBe(36927);
        expect(bs.call.data).toBe(to(s.call.data));
        expect(bs.call.to.toLowerCase()).toBe(to(s.call.to));
        expect([bs.waits, bs.seconds, bs.at]).toEqual([s.waits, s.seconds, s.at]);
      }
    });
  }
  it('the plan\'s calls are the economy builders\' (no second encoding)', () => {
    const d = dev.plan('delivered-accepted', args());
    const want = openJobWithEconomy({ chainId: 36927, hook: DEV.hook, salt: SALT, terms: { seller: PARTIES.seller, token: DEV.token, price: QUOTE.price,
      premium: QUOTE.premium, deposit: QUOTE.deposit, deadline: 1_800_000_660, pool: DEV.pool, coverCap: QUOTE.coverCap!, evaluator: DEV.judgeAdapter,
      evaluatorFee: QUOTE.evaluatorFee, reviewWindow: 60, disputeWindow: 60 }, econ: { toBackers: QUOTE.toBackers, protocolFee: QUOTE.protocolFee, compensation: QUOTE.compensation } });
    expect(d.steps.slice(0, 2).map((s) => s.call)).toEqual(want);
    expect(d.steps.at(-1)!.call.to).toBe(DEV.judgeAdapter);
  });
});

describe('_PLAYGROUND_NETS_v1_ signers', () => {
  it('devnet: every Moonbeam step is coord:devnet.*, every user step wallet:test', () => {
    for (const c of BUILT) for (const s of dev.plan(c.id, args(c.via)).steps) {
      if (MOONBEAM_ROLES.has(s.role)) expect(s.signer, `${label(c)} ${s.fn}`).toMatch(/^coord:devnet\./);
      else { expect(s.signer).toBe('wallet:test'); expect(s.signer).not.toMatch(/^coord:/); }
    }
    expect(dev.plan('delivered-accepted', args()).lights.find((l) => l.light === 'paid')!.by).toBe('coord:devnet.payout');
  });
  it('Base: no step is coord:devnet.*; evaluator and arbitrator cases are refused, naming the gap', () => {
    const planned: string[] = [], refused: string[] = [];
    for (const c of BUILT) {
      const needs = rolesOf(c.id, c.via).filter((r) => NETS.base.signers[r] === null);
      if (!needs.length) {
        const p = base.plan(c.id, args(c.via));
        for (const s of p.steps) {
          expect(s.signer).not.toMatch(/^coord:devnet\./);
          expect(s.signer).toMatch(MOONBEAM_ROLES.has(s.role) ? /^coord:/ : /^wallet:user$/);
        }
        planned.push(label(c));
        continue;
      }
      let err: unknown;
      try { base.plan(c.id, args(c.via)); } catch (e) { err = e; }
      expect(err, label(c)).toBeInstanceOf(PlaygroundGateError);
      expect((err as PlaygroundGateError).gate).toBe('signer');
      expect((err as Error).message).toContain(`no signer for the ${needs[0]}`);
      expect((err as PlaygroundGateError).gap!.role).toBe(needs[0]);
      refused.push(label(c));
    }
    expect(planned).toEqual(['auto-complete', 'no-show', 'offer-cancelled', 'offer-lapsed', 'layer-sweep', 'pool-deposit-withdraw']);
    expect(refused).toEqual(['delivered-accepted', 'rejected (finalize)', 'rejected (arbitrated)', 'rejected (stale)', 'rejection-overturned', 'cheated']);
    for (const c of BUILT) expect(statusOn('base', c.id, c.via)).toBe(planned.includes(label(c)) ? 'planned' : 'refused');
    // the test refs only fill a gap, and only as coord:test.*
    for (const p of BUILT.map((c) => baseFilled.plan(c.id, args(c.via)))) for (const s of p.steps) expect(s.signer).not.toMatch(/^coord:devnet\./);
    expect(() => playground({ ...BASE_OPTS, __testOnlySigners: { keeper: 'coord:test.keeper' } })).toThrow(/only fills a gap/);
    expect(() => playground({ ...BASE_OPTS, __testOnlySigners: { evaluator: 'coord:devnet.evaluate' as never } })).toThrow(/coord:test/);
  });
});

describe('_PLAYGROUND_NETS_v1_ the money', () => {
  const legs = (id: CaseId, via?: Via) => dev.plan(id, args(via)).legs as EndingLegs;
  const pick = (l: EndingLegs) => ({ buyer: l.buyer, seller: l.seller, backers: l.backers, protocolFee: l.protocolFee, evaluator: l.evaluator });
  it('the worked numbers', () => {
    expect(pick(legs('delivered-accepted'))).toEqual({ buyer: 0n, seller: 2_111_750n, backers: 94_803n, protocolFee: 16_947n, evaluator: 10_000n });
    expect(pick(legs('no-show'))).toEqual({ buyer: 1_233_500n, seller: 1_000_000n, backers: 0n, protocolFee: 0n, evaluator: 0n });
    for (const via of VIAS) expect(pick(legs('rejected', via))).toEqual({ buyer: 1_223_500n, seller: 1_000_000n, backers: 0n, protocolFee: 0n, evaluator: 10_000n });
    expect(pick(legs('offer-cancelled'))).toEqual({ buyer: 1_121_750n, seller: 0n, backers: 0n, protocolFee: 0n, evaluator: 0n });
  });
  it('every ending\'s legs sum to what the job held', () => {
    for (const c of BUILT) {
      const p = dev.plan(c.id, args(c.via));
      if (!p.ending) continue;
      const l = p.legs as EndingLegs;
      const accepted = !['cancelled', 'lapsed'].includes(p.ending);
      const held = QUOTE.price + QUOTE.premium + QUOTE.evaluatorFee + (accepted ? QUOTE.deposit : 0n) + l.fromPool;
      expect(p.held, label(c)).toBe(held);
      expect(l.buyer + l.seller + l.backers + l.protocolFee + l.evaluator, label(c)).toBe(held);
    }
  });
  it('a sweep\'s legs are the accrued protocol fee; a pool round trip ends no job', () => {
    expect(dev.plan('layer-sweep', args()).legs).toEqual({ protocolFee: 16_947n });
    expect(dev.plan('layer-sweep', args(undefined, { accrued: 50_841n })).legs).toEqual({ protocolFee: 50_841n });
    const pool = dev.plan('pool-deposit-withdraw', args(undefined, { amount: 5_000_000n }));
    expect([pool.ending, pool.legs, pool.jobId, pool.outlay]).toEqual([null, null, null, 5_000_000n]);
  });
  it('the devnet ledger: where the run recorded the ending, the plan\'s legs are the fixture\'s', () => {
    const JOBS: Record<number, { id: CaseId; via?: Via }> = { 1: { id: 'delivered-accepted' }, 2: { id: 'cheated' }, 3: { id: 'rejected', via: 'finalize' },
      4: { id: 'no-show' }, 5: { id: 'rejection-overturned' }, 6: { id: 'rejected', via: 'arbitrated' }, 7: { id: 'rejected', via: 'stale' },
      8: { id: 'offer-cancelled' }, 9: { id: 'offer-lapsed' }, 10: { id: 'auto-complete' } };
    expect(RUN.chainId).toBe(36927);
    expect(Object.fromEntries(Object.entries(RUN.quote).filter(([k]) => k !== 'record')))
      .toEqual({ price: 1_000_000, premium: 111_750, toBackers: 94_803, toLayer: 16_947, deposit: 1_111_750, compensation: 111_750, evaluatorFee: 10_000 });
    const n = (e: Ev | undefined, k: string): bigint => (e ? BigInt(e[k] as number) : 0n);
    let swept = 0n;
    for (const j of RUN.ledger) {
      const c = JOBS[j.job]!, ev = (name: string) => j.events.find((e) => e.event === name);
      const cheat = ev('Cheated');
      const p = dev.plan(c.id, args(c.via, cheat ? { loss: n(cheat, 'loss') } : {}));
      const l = p.legs as EndingLegs, s = ev('Settled')!;
      expect([l.seller, l.buyer, l.backers, l.evaluator], `job ${j.job} ${label(c)}`)
        .toEqual([n(s, 'toSeller'), n(s, 'toBuyer') + n(cheat, 'fromPool'), n(s, 'toPool'), n(s, 'toEvaluator')]);
      expect(l.protocolFee).toBe(n(ev('PremiumSplit'), 'toLayer'));
      expect(l.fromPool).toBe(n(cheat, 'fromPool'));
      swept += l.protocolFee;
    }
    expect(dev.plan('layer-sweep', args(undefined, { accrued: swept })).legs).toEqual({ protocolFee: BigInt(RUN.hookEvents.find((e) => e.event === 'LayerFeesSwept')!.amount as number) });
  });
  it('waits: the review, dispute and arbitration windows of the net, and the deadline', () => {
    const w = (id: CaseId, via?: Via) => dev.plan(id, args(via)).steps.filter((s) => s.waits).map((s) => [s.fn, s.waits, s.seconds ?? s.at]);
    expect(w('auto-complete')).toEqual([['claimAutoComplete', 'review', 60]]);
    expect(w('rejected', 'finalize')).toEqual([['finalizeReject', 'dispute', 60]]);
    expect(w('rejected', 'stale')).toEqual([['settleStaleDispute', 'arbitration', 120]]);
    expect(w('no-show')).toEqual([['expire', 'deadline', 1_800_000_660]]);
    expect(w('offer-lapsed')).toEqual([['expire', 'deadline', 1_800_000_660]]);
    expect(w('delivered-accepted')).toEqual([]);
  });
});

describe('_PLAYGROUND_NETS_v1_ gates', () => {
  const gate = (o: Record<string, unknown>): string | null => {
    try { playground({ ...BASE_OPTS, ...o } as PlaygroundOptions); return null; } catch (e) { return e instanceof PlaygroundGateError ? e.gate : `other: ${String(e)}`; }
  };
  it('Base needs allowMainnet, a budget above 0, and two green devnet runs', () => {
    expect(gate({})).toBeNull();
    expect(gate({ allowMainnet: undefined })).toBe('allowMainnet');
    expect(gate({ allowMainnet: 'yes' as never })).toBe('allowMainnet');
    expect(gate({ budget: undefined })).toBe('budget');
    expect(gate({ budget: { perRunUnits: 0n } })).toBe('budget');
    expect(gate({ budget: { perRunUnits: 5 as never } })).toBe('budget');
    expect(gate({ devnetGreen: undefined })).toBe('devnetGreen');
    expect(gate({ devnetGreen: { market: MARKET, runs: ['devnet-run-1'] } })).toBe('devnetGreen');
    expect(gate({ devnetGreen: { market: MARKET, runs: ['devnet-run-1', 'devnet-run-1'] } })).toBe('devnetGreen');
    expect(gate({ devnetGreen: { market: 'workflow-nodes', runs: GREEN.runs } })).toBe('market');
  });
  it('Base plans only for the market the green runs were of, and within the budget', () => {
    expect(() => base.plan('auto-complete', args(undefined, { market: 'x402-base' }))).toThrow(PlaygroundGateError);
    const small = playground({ ...BASE_OPTS, budget: { perRunUnits: 1_000_000n } });
    expect(() => small.plan('no-show', args())).toThrow(/moves 2233500 units .* above the budget of 1000000/);
    expect(small.plan('layer-sweep', args()).outlay).toBe(0n);
  });
  it('the devnet opens without the gates; a market Moonbeam does not list on is refused', () => {
    expect(dev.net.id).toBe('devnet');
    expect(() => dev.plan('auto-complete', args(undefined, { market: 'bitagent-base' }))).toThrow(/not one Moonbeam lists on/);
    expect(() => dev.plan('rejected', args())).toThrow(/needs \{ via \}/);
    const { loss: _l, ...noLoss } = args();
    expect(() => dev.plan('cheated', noLoss)).toThrow(/loss/);
  });
});

describe('_PLAYGROUND_NETS_v1_ not built', () => {
  for (const id of ['seller-payout', 'grade-top-up'] as const) {
    it(`${id}: not_built on both nets, no steps, with its reason`, () => {
      for (const pg of [dev, base]) {
        const p = pg.plan(id, { market: MARKET } as PlanArgs);
        expect([p.status, p.steps, p.legs, p.reason]).toEqual(['not_built', [], null, CASES[id].reason]);
        expect(p.lights.every((l) => !l.expected)).toBe(true);
      }
    });
  }
  it('the reasons', () => {
    expect(CASES['seller-payout'].reason).toBe('the payout purpose has no devnet vault yet');
    expect(CASES['grade-top-up'].reason).toBe('no devnet grades vault');
  });
});

describe('_PLAYGROUND_NETS_v1_ runs through ports (fakes)', () => {
  const on = (r: { lights: readonly { light: string; on: boolean }[] }) => Object.fromEntries(r.lights.map((l) => [l.light, l.on]));
  it('delivered-accepted turns all five lights on, every step with its tx and events', async () => {
    const ports = fakePorts();
    const { parties: _p, ...noParties } = args();
    const r = await dev.run('delivered-accepted', noParties, ports);
    expect(r.status).toBe('ran');
    expect(on(r)).toEqual({ listed: true, bought: true, delivered: true, settled: true, paid: true });
    expect(r.steps.every((s) => s.tx && s.ok)).toBe(true);
    expect(r.steps.filter((s) => s.ack).map((s) => s.fn)).toEqual(['postVerdict']);
    expect(ports.log.filter((l) => l.startsWith('stream.sign'))).toEqual(['stream.sign postVerdict coord:devnet.evaluate']);
    expect(ports.log[0]).toBe('wallet.parties');
    expect((r.legs as EndingLegs).seller).toBe(2_111_750n);
  });
  it('no ack for the settle step: Settled and Paid stay off', async () => {
    const r = await dev.run('delivered-accepted', args(), fakePorts({ withhold: ['settled'] }));
    expect(on(r)).toEqual({ listed: true, bought: true, delivered: true, settled: false, paid: false });
    expect(r.lights.find((l) => l.light === 'settled')!.why).toMatch(/no settled ack/);
  });
  it('an ack without its chain event turns nothing on; a step with no tx stops the run', async () => {
    const r = await dev.run('delivered-accepted', args(), fakePorts({ noTxFor: 'submit' }));
    expect(r.status).toBe('stopped');
    expect(r.stopped).toMatchObject({ fn: 'submit' });
    expect(on(r)).toEqual({ listed: true, bought: true, delivered: false, settled: false, paid: false });
  });
  it('waits are chain time (waitUntil), never a sleep; a no-show never delivers or pays', async () => {
    const ports = fakePorts();
    const t0 = ports.clock.now;
    const r = await dev.run('auto-complete', args(), ports);
    expect(ports.log).toContain('chain.waitUntil review');
    expect(ports.clock.now).toBe(t0 + 61);
    expect(on(r)).toEqual({ listed: true, bought: true, delivered: true, settled: true, paid: true });
    const ns = await dev.run('no-show', args(), fakePorts());
    expect(on(ns)).toEqual({ listed: true, bought: true, delivered: false, settled: true, paid: false });
    expect(ns.steps.map((s) => s.signer).at(-1)).toBe('coord:devnet.keeper');
  });
  it('a not-built case runs nothing', async () => {
    const ports = fakePorts();
    const r = await dev.run('seller-payout', { market: MARKET } as never, ports);
    expect([r.status, r.steps.length, ports.log]).toEqual(['not_built', 0, []]);
  });
});

describe('_PLAYGROUND_NETS_v1_ docs', () => {
  const doc = playgroundDoc();
  it('docs/playground.md is the generated table (node scripts/gen-playground.mjs)', () => {
    expect(readFileSync(join(__dirname, '..', 'docs', 'playground.md'), 'utf8')).toBe(doc);
  });
  it('it has the role × net table, every case with its steps, and the gaps', () => {
    expect(doc).toContain('| evaluator | `coord:devnet.evaluate` | **none yet** (gap) |');
    expect(doc).toContain('| keeper | `coord:devnet.keeper` | `coord:keeper.end` |');
    for (const id of CASE_IDS) expect(doc).toContain(`### \`${id}\``);
    expect(doc).toContain('**base**, arbitrator: no coord sign purpose yet');
    expect(doc).not.toMatch(/\bthe layer\b|taifoon|\bn8n\b|0x[0-9a-fA-F]{40}/i);
  });
});

// the plan type is exported for callers
const _plan: Plan | null = null; void _plan;

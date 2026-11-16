/**
 * The playground: one organized switch between the devnet (chain 36927) and Base (chain 8453).
 *
 * Every cover case of a covered job (./cases) is one plan with the same steps on both networks; only the network's signers,
 * chain id and addresses differ (./nets). The devnet is open. Base refuses until its gates are met: `allowMainnet: true`, a
 * per-run budget above 0, and two green devnet runs of the market. A Base case whose steps need a role Base has no signer for
 * yet (the evaluator and the arbitrator) is refused, naming the gap.
 *
 *   const pg = playground({ net: 'devnet', placement })
 *   const plan = pg.plan('delivered-accepted', { market: 'erc8183-base', quote, salt, parties, deadline })   // pure
 *   const out = await pg.run('delivered-accepted', args, ports)                                              // through ports
 *
 * Every Moonbeam-signed step (evaluator, arbitrator, keeper, payout) is signed by a `coord:*` ref: a sign request on the coord
 * pipe, never a key. User steps are `wallet:*`. Nothing here makes a network call; the ports do, and only fakes ship.
 */
import { assertEconomyChain, jobIdFor, legsOf } from '../economy/index.js';
import type { EconomyCall, EconomyQuote, EndingLegs } from '../economy/index.js';
import { isAddress, isHex32, keccakHex } from '../onboard/index.js';
import type { Address, Hex } from '../onboard/index.js';
import { listsOn, MOONBEAM_LISTS_ON } from '../market/venues.js';
import { buildCalls, CASES, isCaseId, LIGHT_IDS, stepsOf } from './cases.js';
import type { CaseId, LightId, Stage, Via, Wait } from './cases.js';
import { checkPlacement, gapsOf, netOf, windowsOf } from './nets.js';
import type { Gap, Net, NetId, Placement, SignerRef, SignerRole } from './nets.js';
import type { Ack, ChainEvent, Ports, RunStepResult } from './ports.js';

export * from './nets.js';
export * from './cases.js';
export * from './ports.js';
export { playgroundDoc } from './doc.js';

// ── gates ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Gate = 'allowMainnet' | 'budget' | 'devnetGreen' | 'signer' | 'market';

/** A refusal of a gate of Base (or of a run's budget): which gate, and why. */
export class PlaygroundGateError extends Error {
  override name = 'PlaygroundGateError';
  constructor(readonly gate: Gate, message: string, readonly gap?: Gap) { super(`refused (${gate}): ${message}`); }
}

/** Two devnet runs of the market that went green, by run id: the proof Base asks for before it opens. */
export interface DevnetGreen { market: string; runs: readonly string[] }

export interface PlaygroundOptions {
  net: NetId;
  placement: Placement;
  /** Base only: the caller's explicit yes to a chain with value */
  allowMainnet?: boolean;
  /** the most units one run may move from the user's wallets (Base: required, above 0) */
  budget?: { perRunUnits: bigint };
  /** Base only: two green devnet run ids of the market */
  devnetGreen?: DevnetGreen;
  /**
   * TESTS ONLY: fill a role the net has no signer for with a `coord:test.*` ref, so a test can compare a refused case's
   * structure across nets. It never replaces a signer the table names, and takes no other kind of ref.
   */
  __testOnlySigners?: Partial<Record<SignerRole, `coord:test.${string}`>>;
}

// ── plans ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Parties { buyer: Address; seller: Address; backer?: Address }

export interface PlanArgs {
  /** the market the sale came through: one Moonbeam lists on */
  market: string;
  quote: EconomyQuote;
  salt: Hex;
  parties: Parties;
  /** the job's deadline, unix seconds (chain time) */
  deadline: number;
  /** `rejected` only: how the rejection stands */
  via?: Via;
  /** `cheated` only: the adjudicated loss */
  loss?: bigint;
  /** the delivery's digest and the verdict's (default: derived from the job id) */
  evidenceDigest?: Hex;
  verdictDigest?: Hex;
  /** `layer-sweep`: the protocol fees accrued on the hook (default: one completed job's) */
  accrued?: bigint;
  /** `pool-deposit-withdraw`: the deposit (default: the price) and the shares redeemed (default: the deposit, a share price of 1) */
  amount?: bigint;
  shares?: bigint;
}
export type RunArgs = Omit<PlanArgs, 'parties'> & { parties?: Parties };

export interface PlanStep {
  stage: Stage;
  fn: string;
  role: SignerRole;
  signer: SignerRef;
  call: EconomyCall;
  waits?: Wait;
  /** for a window: its length in seconds; for the deadline: the unix second it passes */
  seconds?: number;
  at?: number;
  /** this step's transaction settles the job */
  ends?: true;
  /** what the chain shows once the step went through */
  expects: { events: readonly string[]; opens?: { seller: Address }; transfers?: readonly { to: Address; units: bigint }[] };
}

/** One light of a sale, and the reads that turn it on: an ack on the coord pipe plus a chain event. */
export interface PlanLight {
  light: LightId;
  read: string;
  ack: LightId;
  event: string;
  /** false: this case never turns it on (a no-show never delivers) */
  expected: boolean;
  /** who acks it, where a network purpose does (paid: the payout purpose) */
  by?: SignerRef | null;
}

/** The accrued protocol fees a sweep sends to the fee payee. */
export interface SweepLegs { protocolFee: bigint }

export interface Plan {
  net: NetId;
  chainId: number;
  case: CaseId;
  via?: Via;
  market: string;
  status: 'planned' | 'not_built';
  reason?: string;
  ending: string | null;
  jobId: Hex | null;
  steps: readonly PlanStep[];
  legs: EndingLegs | SweepLegs | null;
  /** what the job held: price + premium + evaluator fee, plus the deposit once accepted, plus the pool's payment on a cheat */
  held: bigint | null;
  /** the units the run moves from the user's wallets */
  outlay: bigint;
  lights: readonly PlanLight[];
}

const READS: Record<LightId, { read: string; event: string }> = {
  listed: { read: 'GET /v1/listed', event: 'JobOpened' },
  bought: { read: 'the fund call’s ack (openJobWithEconomy)', event: 'EconomyCommitted' },
  delivered: { read: 'the delivery event (Submitted)', event: 'Submitted' },
  settled: { read: 'the sale run’s settled stage', event: 'Settled' },
  paid: { read: 'the payout ack plus the chain transfer to the seller', event: 'Transfer' },
};
const SELLER_PAID = new Set(['completed', 'auto_completed', 'dispute_seller_won']);

const tag = (s: string, jobId: Hex): Hex => keccakHex(new TextEncoder().encode(`moonbeam.playground.${s}:${jobId}`));
const addr = (v: unknown, what: string): Address => { if (!isAddress(v)) throw new TypeError(`${what} is not an address: ${String(v)}`); return v; };

export interface Playground {
  readonly net: Readonly<Net>;
  readonly placement: Readonly<Placement>;
  /** the signers this playground signs with (the table's) */
  readonly signers: Readonly<Record<SignerRole, SignerRef | null>>;
  readonly gaps: readonly Gap[];
  plan(caseId: CaseId, args: PlanArgs): Plan;
  run(caseId: CaseId, args: RunArgs, ports: Ports): Promise<RunResult>;
}

export function playground(o: PlaygroundOptions): Playground {
  const net = netOf(o.net);
  if (net.id === 'devnet') assertEconomyChain(net.chainId);
  else {
    if (o.allowMainnet !== true) throw new PlaygroundGateError('allowMainnet', `${net.name} (chain ${net.chainId}) has value: pass { allowMainnet: true }`);
    if (!o.budget || typeof o.budget.perRunUnits !== 'bigint' || o.budget.perRunUnits <= 0n)
      throw new PlaygroundGateError('budget', `${net.name} needs a budget { perRunUnits: bigint } above 0`);
    const g = o.devnetGreen;
    const runs = new Set((g?.runs ?? []).filter((r) => typeof r === 'string' && r.trim() !== ''));
    if (!g || typeof g.market !== 'string' || runs.size < 2)
      throw new PlaygroundGateError('devnetGreen', `${net.name} opens after two green devnet runs of the market: devnetGreen named ${runs.size}`);
    if (!listsOn(g.market)) throw new PlaygroundGateError('market', `devnetGreen.market ${g.market} is not a market Moonbeam lists on (${MOONBEAM_LISTS_ON.join(', ')})`);
  }
  if (o.budget !== undefined && (typeof o.budget.perRunUnits !== 'bigint' || o.budget.perRunUnits <= 0n))
    throw new PlaygroundGateError('budget', 'a budget is { perRunUnits: bigint } above 0');
  const placement = checkPlacement(net, o.placement);
  const windows = windowsOf(net, placement);

  const signers: Record<SignerRole, SignerRef | null> = { ...net.signers };
  for (const [role, ref] of Object.entries(o.__testOnlySigners ?? {}) as [SignerRole, string][]) {
    if (!/^coord:test\.[a-z0-9.-]+$/.test(ref)) throw new TypeError(`__testOnlySigners.${role} must be a coord:test.* ref`);
    if (signers[role] !== null) throw new TypeError(`__testOnlySigners.${role}: ${net.id} already names its signer (${signers[role]}); a test ref only fills a gap`);
    signers[role] = ref as SignerRef;
  }
  Object.freeze(signers);
  const gaps = Object.freeze(gapsOf(net));
  const allowMainnet = net.id !== 'devnet';

  function plan(caseId: CaseId, a: PlanArgs): Plan {
    if (!isCaseId(caseId)) throw new RangeError(`not a case: ${String(caseId)}`);
    if (!a || typeof a.market !== 'string' || !listsOn(a.market)) throw new RangeError(`market ${String(a?.market)} is not one Moonbeam lists on (${MOONBEAM_LISTS_ON.join(', ')})`);
    if (net.id !== 'devnet' && a.market !== o.devnetGreen!.market)
      throw new PlaygroundGateError('devnetGreen', `the green devnet runs are of ${o.devnetGreen!.market}, not ${a.market}`);
    const def = CASES[caseId];
    const lights = (expected: readonly LightId[]): PlanLight[] => LIGHT_IDS.map((l) => ({
      light: l, read: READS[l].read, ack: l, event: READS[l].event, expected: expected.includes(l), ...(l === 'paid' ? { by: signers.payout } : {}) }));
    const base = { net: net.id, chainId: net.chainId, case: caseId, market: a.market } as const;
    if (def.status === 'not_built')
      return { ...base, status: 'not_built', reason: def.reason!, ending: null, jobId: null, steps: [], legs: null, held: null, outlay: 0n, lights: lights([]) };

    const templates = stepsOf(caseId, a.via);
    for (const t of templates) {
      if (signers[t.role] === null) {
        const gap = gaps.find((g) => g.role === t.role)!;
        throw new PlaygroundGateError('signer', `${net.name} has no signer for the ${t.role} yet (no coord sign purpose); it blocks ${gap.blocks.map((b) => b.via ? `${b.case} (${b.via})` : b.case).join(', ')}`, gap);
      }
    }
    const buyer = addr(a.parties?.buyer, 'parties.buyer'), seller = addr(a.parties?.seller, 'parties.seller');
    const backer = addr(a.parties?.backer ?? a.parties?.buyer, 'parties.backer');
    if (!isHex32(a.salt)) throw new TypeError(`salt is not 32 bytes: ${String(a.salt)}`);
    if (!Number.isSafeInteger(a.deadline) || a.deadline <= 0) throw new RangeError('deadline must be unix seconds');
    const quote = { ...a.quote, coverCap: a.quote.coverCap ?? a.quote.price };
    const jobId = jobIdFor({ chainId: net.chainId, hook: placement.hook, buyer, salt: a.salt });
    const amount = a.amount ?? quote.price, shares = a.shares ?? amount;
    const calls = buildCalls(caseId, a.via, {
      chainId: net.chainId, allowMainnet, hook: placement.hook, token: placement.token, judgeAdapter: placement.judgeAdapter, pool: placement.pool,
      buyer, seller, backer, quote, salt: a.salt, jobId, deadline: a.deadline, reviewS: windows.reviewS, disputeS: windows.disputeS,
      evidenceDigest: a.evidenceDigest ?? tag('evidence', jobId), verdictDigest: a.verdictDigest ?? tag('verdict', jobId),
      ...(a.loss !== undefined ? { loss: a.loss } : {}), amount, shares,
    });
    if (calls.length !== templates.length || calls.some((c, i) => c.step !== templates[i]!.fn || c.signer !== templates[i]!.role))
      throw new Error(`internal: ${caseId} built ${calls.map((c) => c.step).join(',')} for ${templates.map((t) => t.fn).join(',')}`);

    const job = def.ending !== null;
    const legs: EndingLegs | SweepLegs | null = def.ending
      ? legsOf(def.ending, quote, a.loss !== undefined ? { loss: a.loss } : {})
      : caseId === 'layer-sweep' ? { protocolFee: a.accrued ?? quote.protocolFee } : null;
    const accepted = job && !['cancelled', 'lapsed'].includes(def.ending!);
    const fromPool = legs && 'fromPool' in legs ? legs.fromPool : 0n;
    const held = job ? quote.price + quote.premium + quote.evaluatorFee + (accepted ? quote.deposit : 0n) + fromPool : null;
    const outlay = job ? quote.price + quote.premium + quote.evaluatorFee + (accepted ? quote.deposit : 0n)
      : caseId === 'pool-deposit-withdraw' ? amount : 0n;
    if (o.budget && outlay > o.budget.perRunUnits)
      throw new PlaygroundGateError('budget', `${caseId} moves ${outlay} units from the user's wallets, above the budget of ${o.budget.perRunUnits} per run`);

    const sellerPaid = def.ending !== null && SELLER_PAID.has(def.ending) && legs !== null && 'seller' in legs;
    const steps: PlanStep[] = templates.map((t, i) => {
      const w: Partial<Pick<PlanStep, 'waits' | 'seconds' | 'at'>> = !t.waits ? {}
        : t.waits === 'deadline' ? { waits: t.waits, at: a.deadline }
        : { waits: t.waits, seconds: t.waits === 'review' ? windows.reviewS : t.waits === 'dispute' ? windows.disputeS : windows.arbitrationS };
      return Object.freeze({
        stage: t.stage, fn: t.fn, role: t.role, signer: signers[t.role]!, call: Object.freeze(calls[i]!), ...w, ...(t.ends ? { ends: true as const } : {}),
        expects: Object.freeze({ events: t.emits,
          ...(t.fn === 'openJobWithEconomy' ? { opens: { seller } } : {}),
          ...(t.ends && sellerPaid ? { transfers: Object.freeze([{ to: seller, units: (legs as EndingLegs).seller }]) } : {}) }),
      });
    });
    return {
      ...base, ...(a.via !== undefined ? { via: a.via } : {}), status: 'planned', ending: def.ending, jobId: job ? jobId : null,
      steps: Object.freeze(steps), legs, held, outlay, lights: Object.freeze(lights(def.lights)),
    };
  }

  async function run(caseId: CaseId, a: RunArgs, ports: Ports): Promise<RunResult> {
    let parties = a.parties;
    if (!parties && CASES[caseId]?.status === 'planned') {
      if (!ports.wallet.parties) throw new TypeError('pass { parties }, or a wallet port that names them');
      parties = await ports.wallet.parties();
    }
    const p = plan(caseId, { ...a, parties: parties ?? (undefined as never) });
    return runPlan(p, ports);
  }

  return Object.freeze({ net, placement, signers, gaps, plan, run });
}

// ── runs ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RunLight { light: LightId; on: boolean; ack: Ack | null; event: ChainEvent | null; why?: string }
export interface RunResult {
  plan: Plan;
  status: 'ran' | 'stopped' | 'not_built';
  steps: readonly RunStepResult[];
  /** the step the run stopped at, and why */
  stopped?: { step: number; fn: string; why: string };
  legs: Plan['legs'];
  lights: readonly RunLight[];
}

const has = (evs: readonly ChainEvent[], name: string): ChainEvent | undefined => evs.find((e) => e.name === name);

/** Execute a plan through ports: wallet steps by the wallet, coord steps by sign requests on the stream, each window waited
 *  for on chain time. A light turns on only from its ack on the stream plus its event on chain. */
export async function runPlan(p: Plan, ports: Ports): Promise<RunResult> {
  const off = (why: string): RunLight[] => LIGHT_IDS.map((l) => ({ light: l, on: false, ack: null, event: null, why }));
  if (p.status === 'not_built') return { plan: p, status: 'not_built', steps: [], legs: null, lights: off(p.reason ?? 'not built') };
  const done: RunStepResult[] = [];
  let stopped: RunResult['stopped'];
  for (const [i, s] of p.steps.entries()) {
    if (s.waits) await ports.chain.waitUntil({ window: s.waits, ...(s.seconds !== undefined ? { seconds: s.seconds } : {}), ...(s.at !== undefined ? { at: s.at } : {}), after: done.at(-1)?.tx ?? null });
    const { tx, ack } = s.signer.startsWith('wallet:') ? { ...(await ports.wallet.sign(s)), ack: null } : await ports.stream.sign(s);
    const events = tx ? await ports.chain.event(tx) : [];
    const missing = s.expects.events.filter((e) => !has(events, e));
    const ok = tx !== null && missing.length === 0;
    done.push({ ...s, tx, ack, events, ok });
    if (!ok) { stopped = { step: i, fn: s.fn, why: tx === null ? `no transaction for ${s.fn} (${s.signer})` : `${s.fn} showed no ${missing.join(', ')}` }; break; }
  }
  const receipt = await ports.stream.settle(p, done);
  const ackOf = (l: LightId): Ack | null => receipt?.acks.find((x) => x.stage === l) ?? null;
  const stepOf = (fn: string): RunStepResult | undefined => done.find((s) => s.fn === fn && s.ok);
  const ending = done.find((s) => s.ends && s.ok);
  const lights: RunLight[] = [];
  for (const pl of p.lights) {
    const ack = ackOf(pl.light);
    const L = (event: ChainEvent | null | undefined, why?: string): RunLight =>
      ({ light: pl.light, on: pl.expected && ack !== null && !!event && !why, ack, event: event ?? null, ...(why ? { why } : !pl.expected ? { why: `${p.case} never turns it on` } : !ack ? { why: `no ${pl.light} ack on the stream` } : !event ? { why: `no ${pl.event} event on chain` } : {}) });
    switch (pl.light) {
      case 'listed': {
        const open = stepOf('openJobWithEconomy'), ev = open && has(open.events, 'JobOpened');
        const seller = ev?.args?.['seller'];
        lights.push(L(ev, ev && typeof seller === 'string' && open!.expects.opens && seller.toLowerCase() !== open!.expects.opens.seller.toLowerCase() ? 'the job names another seller' : undefined));
        break;
      }
      case 'bought': { const open = stepOf('openJobWithEconomy'); lights.push(L(open && has(open.events, 'EconomyCommitted'))); break; }
      case 'delivered': { const sub = stepOf('submit'); lights.push(L(sub && has(sub.events, 'Submitted'))); break; }
      case 'settled': lights.push(L(ending && has(ending.events, 'Settled'))); break;
      case 'paid': {
        const settled = lights.find((x) => x.light === 'settled');
        const want = ending?.expects.transfers?.[0];
        let ev: ChainEvent | undefined;
        if (ack?.tx && want) ev = (await ports.chain.event(ack.tx)).find((e) => e.name === 'Transfer'
          && String(e.args?.['to']).toLowerCase() === want.to.toLowerCase() && e.args?.['value'] === want.units);
        lights.push(L(ev, pl.expected && !settled?.on ? 'not settled' : ack && !ack.tx ? 'the payout ack names no transfer' : undefined));
        break;
      }
    }
  }
  return { plan: p, status: stopped ? 'stopped' : 'ran', steps: done, ...(stopped ? { stopped } : {}), legs: p.legs, lights };
}

/**
 * The cover cases: the rows of the design table. Each built case is a fixed sequence of steps `[stage, fn, role]`, the same on
 * every network; `buildCalls` fills in the calls (calldata, target, chain) from the economy builders for one network's
 * placement. A case that is not built has no steps and says why: no plan is faked for it.
 *
 * This module names roles, never signers: who signs a role on a network is the table of ./nets.
 */
import {
  accept, cancelOpen, claimAutoComplete, complete, dispute, expire, finalizeReject, findCheated, openJobWithEconomy,
  poolDeposit, poolRedeem, reject, resolveDispute, settleStaleDispute, submit, sweepLayerFees,
} from '../economy/index.js';
import type { EconomyCall, EconomyEnding, EconomyQuote, EconomyRole } from '../economy/index.js';
import type { Address, Hex } from '../onboard/index.js';

export type CaseId =
  | 'delivered-accepted' | 'auto-complete' | 'no-show' | 'rejected' | 'rejection-overturned' | 'cheated'
  | 'offer-cancelled' | 'offer-lapsed' | 'layer-sweep' | 'pool-deposit-withdraw' | 'seller-payout' | 'grade-top-up';
export const CASE_IDS: readonly CaseId[] = Object.freeze([
  'delivered-accepted', 'auto-complete', 'no-show', 'rejected', 'rejection-overturned', 'cheated',
  'offer-cancelled', 'offer-lapsed', 'layer-sweep', 'pool-deposit-withdraw', 'seller-payout', 'grade-top-up',
] as const);

/** How a rejection stands: undisputed (finalize), the arbitrator for the buyer (arbitrated), or nobody ruled (stale). */
export type Via = 'finalize' | 'arbitrated' | 'stale';
export const VIAS: readonly Via[] = Object.freeze(['finalize', 'arbitrated', 'stale']);

/** The stage a step belongs to. */
export type Stage = 'buy' | 'accept' | 'deliver' | 'decide' | 'dispute' | 'rule' | 'end' | 'sweep' | 'back' | 'withdraw';
/** A window a step waits for on chain time before it can be sent. */
export type Wait = 'review' | 'dispute' | 'deadline' | 'arbitration';

/** One step of a case, network-free. `ends`: this step's transaction settles the job (the hook's Settled event). */
export interface StepTemplate {
  stage: Stage;
  fn: string;
  role: EconomyRole;
  waits?: Wait;
  ends?: true;
  /** the events the step's transaction shows on chain when it went through */
  emits: readonly string[];
}

/** The lights of a sale, in order. */
export type LightId = 'listed' | 'bought' | 'delivered' | 'settled' | 'paid';
export const LIGHT_IDS: readonly LightId[] = Object.freeze(['listed', 'bought', 'delivered', 'settled', 'paid']);

export interface CaseDef {
  id: CaseId;
  title: string;
  status: 'planned' | 'not_built';
  /** why a case is not built */
  reason?: string;
  /** the ending `legsOf` pays out; null for a case that ends no job */
  ending: EconomyEnding | null;
  /** the variants of the case, for `rejected` */
  vias?: readonly Via[];
  /** the lights this case can turn on (a no-show never delivers; only a seller-paid ending pays) */
  lights: readonly LightId[];
}

const T = (stage: Stage, fn: string, role: EconomyRole, emits: readonly string[], x: { waits?: Wait; ends?: true } = {}): StepTemplate =>
  Object.freeze({ stage, fn, role, emits: Object.freeze([...emits]), ...x });

const BUY = [T('buy', 'approve', 'buyer', ['Approval']), T('buy', 'openJobWithEconomy', 'buyer', ['JobOpened', 'EconomyCommitted'])];
const ACCEPT = [T('accept', 'approve', 'seller', ['Approval']), T('accept', 'accept', 'seller', ['JobAccepted', 'JobCovered'])];
const DELIVER = [T('deliver', 'submit', 'seller', ['Submitted'])];
const JOB = [...BUY, ...ACCEPT, ...DELIVER];
const REJECT = T('decide', 'postVerdict', 'evaluator', ['VerdictPosted', 'RejectProposed']);
const DISPUTE = T('dispute', 'dispute', 'seller', ['DisputeOpened']);

const STEPS: Record<Exclude<CaseId, 'rejected' | 'seller-payout' | 'grade-top-up'>, readonly StepTemplate[]> & { rejected: Record<Via, readonly StepTemplate[]> } = {
  'delivered-accepted': [...JOB, T('decide', 'postVerdict', 'evaluator', ['VerdictPosted', 'Settled'], { ends: true })],
  'auto-complete': [...JOB, T('end', 'claimAutoComplete', 'keeper', ['AutoCompleted', 'Settled'], { waits: 'review', ends: true })],
  'no-show': [...BUY, ...ACCEPT, T('end', 'expire', 'keeper', ['Expired', 'Settled'], { waits: 'deadline', ends: true })],
  rejected: {
    finalize: [...JOB, REJECT, T('end', 'finalizeReject', 'keeper', ['Rejected', 'Settled'], { waits: 'dispute', ends: true })],
    arbitrated: [...JOB, REJECT, DISPUTE, T('rule', 'resolveDispute', 'arbitrator', ['DisputeResolved', 'Settled'], { ends: true })],
    stale: [...JOB, REJECT, DISPUTE, T('end', 'settleStaleDispute', 'keeper', ['Rejected', 'Settled'], { waits: 'arbitration', ends: true })],
  },
  'rejection-overturned': [...JOB, REJECT, DISPUTE, T('rule', 'resolveDispute', 'arbitrator', ['DisputeResolved', 'Settled'], { ends: true })],
  cheated: [...JOB, T('rule', 'findCheated', 'arbitrator', ['Cheated', 'Settled'], { ends: true })],
  'offer-cancelled': [...BUY, T('end', 'cancelOpen', 'buyer', ['OpenCancelled', 'Settled'], { ends: true })],
  'offer-lapsed': [...BUY, T('end', 'expire', 'keeper', ['Expired', 'Settled'], { waits: 'deadline', ends: true })],
  'layer-sweep': [T('sweep', 'sweepLayerFees', 'keeper', ['LayerFeesSwept'])],
  'pool-deposit-withdraw': [T('back', 'approve', 'backer', ['Approval']), T('back', 'deposit', 'backer', ['Deposit']), T('withdraw', 'redeem', 'backer', ['Withdraw'])],
};
for (const v of Object.values(STEPS)) Object.freeze(v);
Object.freeze(STEPS);

const JOB_LIGHTS: readonly LightId[] = ['listed', 'bought', 'settled'];
const SALE_LIGHTS: readonly LightId[] = LIGHT_IDS;
const C = (d: CaseDef): CaseDef => Object.freeze({ ...d, lights: Object.freeze([...d.lights]), ...(d.vias ? { vias: Object.freeze([...d.vias]) } : {}) });

/** The design table. */
export const CASES: Readonly<Record<CaseId, CaseDef>> = Object.freeze({
  'delivered-accepted': C({ id: 'delivered-accepted', title: 'Delivered and accepted: the evaluator completes it through the judge adapter', status: 'planned', ending: 'completed', lights: SALE_LIGHTS }),
  'auto-complete': C({ id: 'auto-complete', title: 'Delivered, no decision: anyone completes it after the review window', status: 'planned', ending: 'auto_completed', lights: SALE_LIGHTS }),
  'no-show': C({ id: 'no-show', title: 'Accepted, never delivered: it expires after the deadline', status: 'planned', ending: 'no_show', lights: JOB_LIGHTS }),
  rejected: C({ id: 'rejected', title: 'Delivered and rejected: the rejection stands', status: 'planned', ending: 'rejected', vias: VIAS, lights: ['listed', 'bought', 'delivered', 'settled'] }),
  'rejection-overturned': C({ id: 'rejection-overturned', title: 'Rejected, disputed, and the arbitrator rules for the seller', status: 'planned', ending: 'dispute_seller_won', lights: SALE_LIGHTS }),
  cheated: C({ id: 'cheated', title: 'Delivered, and the arbitrator finds the seller cheated on a loss', status: 'planned', ending: 'cheated', lights: ['listed', 'bought', 'delivered', 'settled'] }),
  'offer-cancelled': C({ id: 'offer-cancelled', title: 'An offer the buyer withdraws before anyone accepts it', status: 'planned', ending: 'cancelled', lights: JOB_LIGHTS }),
  'offer-lapsed': C({ id: 'offer-lapsed', title: 'An offer nobody accepted: it expires after the deadline', status: 'planned', ending: 'lapsed', lights: JOB_LIGHTS }),
  'layer-sweep': C({ id: 'layer-sweep', title: 'The accrued protocol fees go to the fee payee the hook names', status: 'planned', ending: null, lights: [] }),
  'pool-deposit-withdraw': C({ id: 'pool-deposit-withdraw', title: 'A backer deposits into the coverage pool, then redeems', status: 'planned', ending: null, lights: [] }),
  'seller-payout': C({ id: 'seller-payout', title: 'The seller signs a claim intent and the payout releases from the vault', status: 'not_built', reason: 'the payout purpose has no devnet vault yet', ending: null, lights: [] }),
  'grade-top-up': C({ id: 'grade-top-up', title: 'A grade top-up', status: 'not_built', reason: 'no devnet grades vault', ending: null, lights: [] }),
} satisfies Record<CaseId, CaseDef>);

export function isCaseId(v: unknown): v is CaseId { return typeof v === 'string' && (CASE_IDS as readonly string[]).includes(v); }

/** A built case's steps, network-free. `rejected` needs its `via`; a case that is not built has none. */
export function stepsOf(id: CaseId, via?: Via): readonly StepTemplate[] {
  if (!isCaseId(id)) throw new RangeError(`not a case: ${String(id)} (one of ${CASE_IDS.join(', ')})`);
  if (CASES[id].status !== 'planned') return [];
  if (id === 'rejected') {
    if (via === undefined || !VIAS.includes(via)) throw new RangeError(`the rejected case needs { via }: one of ${VIAS.join(', ')}`);
    return STEPS.rejected[via];
  }
  if (via !== undefined) throw new RangeError(`only the rejected case takes a via (${id} got ${String(via)})`);
  return STEPS[id as keyof typeof STEPS] as readonly StepTemplate[];
}

/** The roles a built case's steps are signed by, in first-use order. */
export function rolesOf(id: CaseId, via?: Via): EconomyRole[] {
  return [...new Set(stepsOf(id, via ?? (id === 'rejected' ? 'finalize' : undefined)).map((s) => s.role))];
}

// ── the calls ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Everything the calls of one case need, for one network. */
export interface CallContext {
  chainId: number;
  /** pass-through to the economy builders' chain guard: true on Base, once its gates are met */
  allowMainnet: boolean;
  hook: Address; token: Address; judgeAdapter: Address; pool: Address;
  buyer: Address; seller: Address; backer: Address;
  quote: Required<Pick<EconomyQuote, 'coverCap'>> & EconomyQuote;
  salt: Hex; jobId: Hex; deadline: number;
  reviewS: number; disputeS: number;
  evidenceDigest: Hex; verdictDigest: Hex;
  loss?: bigint;
  /** the backer's deposit, and the shares it redeems */
  amount: bigint; shares: bigint;
}

/** The calls of one step of a built case, from the economy builders. One call per template step, in order. */
export function buildCalls(id: CaseId, via: Via | undefined, x: CallContext): EconomyCall[] {
  const g = { chainId: x.chainId, ...(x.allowMainnet ? { allowMainnet: true } : {}) };
  const j = { ...g, hook: x.hook, jobId: x.jobId };
  const q = x.quote;
  const open = () => openJobWithEconomy({ ...g, hook: x.hook, salt: x.salt,
    terms: { seller: x.seller, token: x.token, price: q.price, premium: q.premium, deposit: q.deposit, deadline: x.deadline,
      pool: x.pool, coverCap: q.coverCap, evaluator: x.judgeAdapter, evaluatorFee: q.evaluatorFee, reviewWindow: x.reviewS, disputeWindow: x.disputeS },
    econ: { toBackers: q.toBackers, protocolFee: q.protocolFee, compensation: q.compensation } });
  const acc = () => accept({ ...j, token: x.token, deposit: q.deposit });
  const sub = () => submit({ ...j, evidenceDigest: x.evidenceDigest });
  const job = () => [...open(), ...acc(), ...sub()];
  const rej = () => reject({ ...g, adapter: x.judgeAdapter, jobId: x.jobId, verdictDigest: x.verdictDigest });
  const loss = (): bigint => { if (x.loss === undefined) throw new TypeError('the cheated case needs the adjudicated { loss }'); return x.loss; };
  switch (id) {
    case 'delivered-accepted': return [...job(), ...complete({ ...g, adapter: x.judgeAdapter, jobId: x.jobId, digest: x.verdictDigest })];
    case 'auto-complete': return [...job(), ...claimAutoComplete(j)];
    case 'no-show': return [...open(), ...acc(), ...expire(j)];
    case 'rejected':
      switch (via) {
        case 'finalize': return [...job(), ...rej(), ...finalizeReject(j)];
        case 'arbitrated': return [...job(), ...rej(), ...dispute(j), ...resolveDispute({ ...j, sellerWins: false })];
        case 'stale': return [...job(), ...rej(), ...dispute(j), ...settleStaleDispute(j)];
        default: throw new RangeError(`the rejected case needs { via }: one of ${VIAS.join(', ')}`);
      }
    case 'rejection-overturned': return [...job(), ...rej(), ...dispute(j), ...resolveDispute({ ...j, sellerWins: true })];
    case 'cheated': return [...job(), ...findCheated({ ...j, loss: loss() })];
    case 'offer-cancelled': return [...open(), ...cancelOpen(j)];
    case 'offer-lapsed': return [...open(), ...expire(j)];
    case 'layer-sweep': return sweepLayerFees({ ...g, hook: x.hook });
    case 'pool-deposit-withdraw': return [...poolDeposit({ ...g, pool: x.pool, asset: x.token, amount: x.amount, receiver: x.backer }),
      ...poolRedeem({ ...g, pool: x.pool, shares: x.shares, owner: x.backer })];
    default: throw new RangeError(`${id} is not built: it has no calls`);
  }
}

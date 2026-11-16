/**
 * The assured-job economy, as unsigned calls: every call of the assurance hook V5.1 a job's parties sign, from the buyer's
 * `openJobWithEconomy` to the last keeper call, plus the coverage pool's ERC-4626 `deposit` and `redeem`, and `legsOf`, who
 * receives what at each ending of a job opened with economy terms.
 *
 * Nothing here signs, holds a key or reads a chain. Every builder takes the hook (or adapter, or pool) address and the chain id
 * from the caller and returns calls in the SDK's `UnsignedCall` shape, each naming the role that signs it:
 *
 *   buyer       opens the job (openJobWithEconomy), withdraws an offer nobody accepted (cancelOpen)
 *   seller      accepts it (its deposit), delivers it (submit / submitWithDelivery), disputes a rejection (dispute)
 *   evaluator   the job's named evaluator: completes or rejects a delivered job, directly or through the judge adapter's
 *               postVerdict. The buyer never rejects a job opened this way (the hook reverts BuyerCannotReject)
 *   arbitrator  a hook arbitrator: rules on a disputed job (resolveDispute), finds a seller cheated (findCheated)
 *   keeper      anyone, once a window or a deadline has passed: finalizeReject, settleStaleDispute, expire,
 *               claimAutoComplete, and sweepLayerFees (it sends the accrued protocol fees to the fee payee the hook names)
 *   backer      a coverage pool's depositor: deposit, redeem
 *
 * The chain guard: the builders build for the devnet (chain 36927) only. Any other chain is refused unless the caller passes
 * `{ allowMainnet: true }`; nothing in this module sets it.
 *
 * Every number a job is opened with (premium, its two legs, the deposit, the compensation) comes from the quote of the
 * seller's record (`quoteEconomy`, the jev-wilson quote); the hook only checks owner-set bounds. The premium's two legs are
 * the backers' (`toBackers`, paid to the pool on a completion) and the protocol fee (`protocolFee`, accrued on the hook and
 * swept to its fee payee).
 */
import { encodeFunction, encodeParams } from '../abi/index.js';
import { isAddress, isHex32, keccakHex, hexToBytes } from '../onboard/index.js';
import type { Address, Hex, UnsignedCall } from '../onboard/index.js';

// ── roles, calls, the chain guard ───────────────────────────────────────────────────────────────────────────────────────

/** Who signs an economy call. `keeper` is anyone (the call has no sender check); `backer` is a coverage pool's depositor. */
export type EconomyRole = 'buyer' | 'seller' | 'evaluator' | 'arbitrator' | 'keeper' | 'backer';
export const ECONOMY_ROLES: readonly EconomyRole[] = Object.freeze(['buyer', 'seller', 'evaluator', 'arbitrator', 'keeper', 'backer']);

/** One unsigned call: the SDK's `UnsignedCall`, with the economy's signer roles. */
export type EconomyCall = Omit<UnsignedCall, 'signer'> & { signer: EconomyRole };

/** The chains the economy builders build for without `allowMainnet`: the devnet. */
export const ECONOMY_CHAIN_IDS: readonly number[] = Object.freeze([36927]);

export interface ChainOptions {
  /** build for a chain other than the devnet (a chain with value). Nothing in this SDK sets it. */
  allowMainnet?: boolean;
}

export class EconomyChainError extends RangeError {
  override name = 'EconomyChainError';
  constructor(readonly chainId: number) {
    super(`refused: chain ${chainId} is not the devnet (${ECONOMY_CHAIN_IDS.join(', ')}); the economy builders build for it only when you pass { allowMainnet: true }`);
  }
}

/** Refuse any chain but the devnet, unless `allowMainnet`. Throws on a chain id that is not a positive integer. */
export function assertEconomyChain(chainId: number, o: ChainOptions = {}): void {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new RangeError(`not a chain id: ${String(chainId)}`);
  if (!ECONOMY_CHAIN_IDS.includes(chainId) && o.allowMainnet !== true) throw new EconomyChainError(chainId);
}

// ── the functions encoded here ──────────────────────────────────────────────────────────────────────────────────────────

const JOB_TERMS = '(address seller,address token,uint256 price,uint256 premium,uint256 deposit,uint64 deadline,uint64 challengeWindow,address pool,uint256 coverCap,address evaluator,uint256 evaluatorFee,uint32 reviewWindow,uint32 disputeWindow,bytes32 paymentRef)';
// the hook names the second leg of the premium otherwise; the name does not enter the encoding
const ECON_TERMS = '(uint256 toBackers,uint256 protocolFee,uint256 compensation)';
const SPEC = '(bytes32 digest,string uri)';

/** Every function this module encodes, by signature (names are for reading; selectors hash the types). Checked against the
 *  hook's compiled ABI in test/economy.test.ts. */
export const ECONOMY_SIGNATURES = Object.freeze({
  // the hook
  openJobWithEconomy: `openJobWithEconomy(bytes32 salt,${JOB_TERMS} t,${ECON_TERMS} e,${SPEC} spec)`,
  accept: 'accept(bytes32 jobId)',
  submit: 'submit(bytes32 jobId,bytes32 evidenceDigest)',
  submitWithDelivery: 'submitWithDelivery(bytes32 jobId,bytes32 evidenceDigest,string deliveryURI)',
  complete: 'complete(bytes32 jobId)',
  reject: 'reject(bytes32 jobId,bytes32 verdictDigest)',
  finalizeReject: 'finalizeReject(bytes32 jobId)',
  dispute: 'dispute(bytes32 jobId)',
  resolveDispute: 'resolveDispute(bytes32 jobId,bool sellerWins)',
  settleStaleDispute: 'settleStaleDispute(bytes32 jobId)',
  findCheated: 'findCheated(bytes32 jobId,uint256 loss)',
  expire: 'expire(bytes32 jobId)',
  claimAutoComplete: 'claimAutoComplete(bytes32 jobId)',
  cancelOpen: 'cancelOpen(bytes32 jobId)',
  sweepLayerFees: 'sweepLayerFees()',
  // the judge adapter
  postVerdict: 'postVerdict(bytes32 jobId,uint8 verdict,uint8 mode,bytes32 digest)',
  // the coverage pool (ERC-4626) and its asset (ERC-20)
  deposit: 'deposit(uint256 assets,address receiver)',
  redeem: 'redeem(uint256 shares,address receiver,address owner)',
  approve: 'approve(address spender,uint256 amount)',
} as const);

/** The judge adapter's verdict codes (postVerdict): conformant completes the job, the other two propose a rejection. */
export const VERDICT = Object.freeze({ conformant: 1, nonconformant: 2, malformed: 3 } as const);
/** How the verdict was reached: deterministic (a proof anyone recomputes) or calibrated (a model's attestation). */
export const VERDICT_MODE = Object.freeze({ deterministic: 1, calibrated: 2 } as const);

/** The hook's `Settled(jobId, ending, …)` ending codes. */
export const SETTLED_ENDING = Object.freeze({ 1: 'completed', 2: 'expired', 3: 'rejected', 4: 'cheated', 5: 'auto_completed', 6: 'dispute_seller_won', 7: 'open_cancelled' } as const);

/** The hook's limits that hold on every build (the devnet build has shorter minimum windows; the hook checks those). */
export const HOOK_LIMITS = Object.freeze({ maxEvaluatorFeeBps: 1_000, maxUriBytes: 512, maxWindowS: 30 * 86_400, maxDeadlineS: 365 * 86_400 } as const);

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';
const ZERO_32: Hex = `0x${'0'.repeat(64)}`;
const UINT64 = (1n << 64n) - 1n;
const UINT120 = (1n << 120n) - 1n;
const UINT256 = (1n << 256n) - 1n;

// ── small checks ────────────────────────────────────────────────────────────────────────────────────────────────────────

function addr(v: unknown, what: string): Address {
  if (!isAddress(v)) throw new TypeError(`${what} is not an address: ${String(v)}`);
  return v;
}
function b32(v: unknown, what: string): Hex {
  if (!isHex32(v)) throw new TypeError(`${what} is not 32 bytes: ${String(v)}`);
  return v;
}
function units(v: unknown, what: string, max: bigint = UINT256): bigint {
  if (typeof v !== 'bigint' || v < 0n || v > max) throw new RangeError(`${what} must be a bigint from 0 to ${max}`);
  return v;
}
const byteLength = (s: string): number => new TextEncoder().encode(s).length;

const mk = (chainId: number, to: Address, data: Hex, step: string, signer: EconomyRole, effect: string): EconomyCall =>
  ({ chainId, to, data, value: '0x0', step, signer, effect });

interface Target extends ChainOptions { chainId: number }
interface OnHook extends Target { hook: Address; jobId: Hex }

function onHook(a: OnHook): { chainId: number; hook: Address; jobId: Hex } {
  assertEconomyChain(a.chainId, a);
  return { chainId: a.chainId, hook: addr(a.hook, 'hook'), jobId: b32(a.jobId, 'jobId') };
}
function approveCall(chainId: number, token: Address, spender: Address, amount: bigint, signer: EconomyRole, effect: string): EconomyCall {
  return mk(chainId, token, encodeFunction(ECONOMY_SIGNATURES.approve, [spender, amount]), 'approve', signer, effect);
}

// ── the job's terms ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Everything a job is agreed on (the hook's JobTerms). `pool` zero = uninsured (then premium and coverCap are 0);
 *  `evaluator` zero = hook evaluators decide (then `evaluatorFee` is 0); `paymentRef` zero = no x402 receipt recorded. */
export interface JobTerms {
  seller: Address;
  token: Address;
  price: bigint;
  premium: bigint;
  deposit: bigint;
  /** unix seconds */
  deadline: number | bigint;
  challengeWindow?: number | bigint;
  pool?: Address;
  coverCap?: bigint;
  evaluator?: Address;
  evaluatorFee?: bigint;
  /** seconds the buyer has to look at a delivery before anyone may claim the auto-completion */
  reviewWindow: number;
  /** seconds the seller has to dispute a rejection */
  disputeWindow: number;
  paymentRef?: Hex;
}

/** The premium's two legs and the compensation (the hook's EconTerms), from the quote of the seller's record. */
export interface EconTerms {
  /** the backers' leg: paid to the pool on a completion */
  toBackers: bigint;
  /** the protocol fee: accrued on the hook on a completion, swept to its fee payee */
  protocolFee: bigint;
  /** paid to the buyer from the seller's deposit on a no-show and on a rejection that stands */
  compensation: bigint;
}

/** What the buyer commits about the task: keccak256 of its exact bytes and where they are published ("" = digest only). */
export interface SpecCommit { digest: Hex; uri?: string }

/** The id `openJobWithEconomy(salt, …)` returns: keccak256(abi.encode(chainId, hook, buyer, salt)). The buyer is the signer. */
export function jobIdFor(a: { chainId: number; hook: Address; buyer: Address; salt: Hex }): Hex {
  const enc = encodeParams(['uint256', 'address', 'address', 'bytes32'], [BigInt(a.chainId), addr(a.hook, 'hook'), addr(a.buyer, 'buyer'), b32(a.salt, 'salt')]);
  return keccakHex(hexToBytes(enc));
}

/** The hook's pure checks of a job's terms, before anything is signed (the bounds the owner sets, and the chain's clock, are
 *  checked by the hook). Returns the normalised terms or throws, naming the hook's revert. */
function checkTerms(t: JobTerms, e: EconTerms): Required<JobTerms> {
  const seller = addr(t.seller, 'terms.seller'), token = addr(t.token, 'terms.token');
  const pool = addr(t.pool ?? ZERO_ADDRESS, 'terms.pool'), evaluator = addr(t.evaluator ?? ZERO_ADDRESS, 'terms.evaluator');
  const price = units(t.price, 'terms.price'), premium = units(t.premium, 'terms.premium'), deposit = units(t.deposit, 'terms.deposit');
  const coverCap = units(t.coverCap ?? 0n, 'terms.coverCap'), evaluatorFee = units(t.evaluatorFee ?? 0n, 'terms.evaluatorFee');
  const deadline = units(BigInt(t.deadline), 'terms.deadline', UINT64), challengeWindow = units(BigInt(t.challengeWindow ?? 0), 'terms.challengeWindow', UINT64);
  const paymentRef = b32(t.paymentRef ?? ZERO_32, 'terms.paymentRef');
  units(e.toBackers, 'econ.toBackers'); units(e.protocolFee, 'econ.protocolFee', UINT120); units(e.compensation, 'econ.compensation', UINT120);
  if (seller === ZERO_ADDRESS || token === ZERO_ADDRESS) throw new RangeError('the seller and the token must be set (ZeroAddress)');
  if (price === 0n) throw new RangeError('the price must be positive');
  if (deposit <= price) throw new RangeError(`the deposit must be above the price (DepositNotAbovePrice: ${deposit} ≤ ${price})`);
  if (evaluator !== ZERO_ADDRESS && evaluator.toLowerCase() === seller.toLowerCase()) throw new RangeError('the evaluator cannot be the seller (EvaluatorIsSeller)');
  if (evaluatorFee !== 0n) {
    if (evaluator === ZERO_ADDRESS) throw new RangeError('an evaluator fee needs a named evaluator (FeeToSelf)');
    const max = (price * BigInt(HOOK_LIMITS.maxEvaluatorFeeBps)) / 10_000n;
    if (evaluatorFee > max) throw new RangeError(`the evaluator fee is above ${HOOK_LIMITS.maxEvaluatorFeeBps} bps of the price (FeeTooHigh: ${evaluatorFee} > ${max})`);
  }
  for (const [k, w] of [['reviewWindow', t.reviewWindow], ['disputeWindow', t.disputeWindow]] as const)
    if (!Number.isInteger(w) || w <= 0 || w > HOOK_LIMITS.maxWindowS) throw new RangeError(`terms.${k} must be whole seconds, at most ${HOOK_LIMITS.maxWindowS} (BadWindow)`);
  if (e.toBackers + e.protocolFee !== premium) throw new RangeError(`the premium's legs must sum to the premium (EconomyTerms(1): ${e.toBackers} + ${e.protocolFee} ≠ ${premium})`);
  if (pool === ZERO_ADDRESS) {
    if (premium !== 0n) throw new RangeError('an uninsured job (no pool) carries no premium (EconomyTerms(2))');
    if (coverCap !== 0n) throw new RangeError('a cover cap needs a pool (CoverWithoutPool)');
  } else {
    if (e.toBackers === 0n) throw new RangeError('an insured job pays its backers a leg (EconomyTerms(4))');
    if (coverCap === 0n) throw new RangeError('a pool needs a cover cap (PoolWithoutCover)');
  }
  if (e.compensation > deposit || e.compensation > price) throw new RangeError('the compensation is at most the price and the deposit (EconomyTerms(5))');
  return { seller, token, price, premium, deposit, deadline, challengeWindow, pool, coverCap, evaluator, evaluatorFee, reviewWindow: t.reviewWindow, disputeWindow: t.disputeWindow, paymentRef };
}

// ── the buyer ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The buyer opens a job with the terms its quote gave: approve the hook for exactly price + premium + evaluator fee, then
 * openJobWithEconomy(salt, terms, econ, spec). No deposit moves until the seller accepts. The job id is
 * `jobIdFor({ chainId, hook, buyer, salt })`.
 */
export function openJobWithEconomy(a: OnHookNoJob & { salt: Hex; terms: JobTerms; econ: EconTerms; spec?: SpecCommit }): EconomyCall[] {
  assertEconomyChain(a.chainId, a);
  const hook = addr(a.hook, 'hook'), salt = b32(a.salt, 'salt');
  const t = checkTerms(a.terms, a.econ);
  const digest = b32(a.spec?.digest ?? ZERO_32, 'spec.digest'), uri = a.spec?.uri ?? '';
  if (byteLength(uri) > HOOK_LIMITS.maxUriBytes) throw new RangeError(`the task URI is over ${HOOK_LIMITS.maxUriBytes} bytes (URITooLong)`);
  if (digest === ZERO_32 && uri !== '') throw new RangeError('a task URI needs its digest (SpecDigestZero)');
  const escrow = t.price + t.premium + t.evaluatorFee;
  const data = encodeFunction(ECONOMY_SIGNATURES.openJobWithEconomy, [salt,
    [t.seller, t.token, t.price, t.premium, t.deposit, t.deadline, t.challengeWindow, t.pool, t.coverCap, t.evaluator, t.evaluatorFee, BigInt(t.reviewWindow), BigInt(t.disputeWindow), t.paymentRef],
    [a.econ.toBackers, a.econ.protocolFee, a.econ.compensation],
    [digest, uri]]);
  return [
    approveCall(a.chainId, t.token, hook, escrow, 'buyer', `Allow the hook to take exactly ${escrow} units: the price, the premium and the evaluator fee. Nothing moves yet.`),
    mk(a.chainId, hook, data, 'openJobWithEconomy', 'buyer', `Open the job for ${t.seller}: escrow ${escrow} units with its economy terms (backers ${a.econ.toBackers}, protocol fee ${a.econ.protocolFee}, compensation ${a.econ.compensation}). The seller sees them before it accepts.`),
  ];
}
interface OnHookNoJob extends Target { hook: Address }

/** The buyer withdraws an offer nobody accepted: price, premium and evaluator fee come back. */
export function cancelOpen(a: OnHook): EconomyCall[] {
  const { chainId, hook, jobId } = onHook(a);
  return [mk(chainId, hook, encodeFunction(ECONOMY_SIGNATURES.cancelOpen, [jobId]), 'cancelOpen', 'buyer', 'Withdraw the offer: the price, the premium and the evaluator fee come back to you.')];
}

// ── the seller ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The named seller takes the job: approve the hook for exactly its deposit, then accept(jobId). The pool reserves cover now. */
export function accept(a: OnHook & { token: Address; deposit: bigint }): EconomyCall[] {
  const { chainId, hook, jobId } = onHook(a);
  const token = addr(a.token, 'token'), deposit = units(a.deposit, 'deposit');
  if (deposit === 0n) throw new RangeError('the deposit must be positive');
  return [
    approveCall(chainId, token, hook, deposit, 'seller', `Allow the hook to take exactly your deposit, ${deposit} units. Nothing moves yet.`),
    mk(chainId, hook, encodeFunction(ECONOMY_SIGNATURES.accept, [jobId]), 'accept', 'seller', 'Accept the job: your deposit is escrowed and the pool reserves its cover.'),
  ];
}

/** The seller delivers, before the deadline: submit(jobId, evidenceDigest). The review window starts. */
export function submit(a: OnHook & { evidenceDigest: Hex }): EconomyCall[] {
  const { chainId, hook, jobId } = onHook(a);
  return [mk(chainId, hook, encodeFunction(ECONOMY_SIGNATURES.submit, [jobId, b32(a.evidenceDigest, 'evidenceDigest')]), 'submit', 'seller', 'Deliver: record the digest of the work. The review window starts.')];
}

/** submit plus where the delivered bytes are published (an https:// or ipfs:// URI, at most 512 bytes). */
export function submitWithDelivery(a: OnHook & { evidenceDigest: Hex; deliveryURI: string }): EconomyCall[] {
  const { chainId, hook, jobId } = onHook(a);
  const n = byteLength(a.deliveryURI ?? '');
  if (n === 0) throw new RangeError('the delivery URI is empty (DeliveryURIEmpty)');
  if (n > HOOK_LIMITS.maxUriBytes) throw new RangeError(`the delivery URI is over ${HOOK_LIMITS.maxUriBytes} bytes (URITooLong)`);
  return [mk(chainId, hook, encodeFunction(ECONOMY_SIGNATURES.submitWithDelivery, [jobId, b32(a.evidenceDigest, 'evidenceDigest'), a.deliveryURI]), 'submitWithDelivery', 'seller',
    'Deliver: record the digest of the work and where it is published. The review window starts.')];
}

/** The seller answers a rejection inside the dispute window; the arbitrator then has its window to rule. */
export function dispute(a: OnHook): EconomyCall[] {
  const { chainId, hook, jobId } = onHook(a);
  return [mk(chainId, hook, encodeFunction(ECONOMY_SIGNATURES.dispute, [jobId]), 'dispute', 'seller', 'Dispute the rejection: an arbitrator rules, or the rejection stands once its window passes.')];
}

// ── the evaluator ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where an evaluator's decision goes: straight to the hook (the evaluator the job names, or a hook evaluator when it names
 *  none), or through the judge adapter the job names as its evaluator (postVerdict, signed by an evaluator the adapter
 *  registered), which then calls the hook. */
export type DecisionRoute = { hook: Address; adapter?: undefined } | { adapter: Address; hook?: undefined };
function routeOf(r: DecisionRoute): { kind: 'hook' | 'adapter'; to: Address } {
  if (r.hook !== undefined && r.adapter !== undefined) throw new TypeError('pass the hook or the judge adapter, not both');
  if (r.adapter !== undefined) return { kind: 'adapter', to: addr(r.adapter, 'adapter') };
  if (r.hook !== undefined) return { kind: 'hook', to: addr(r.hook, 'hook') };
  throw new TypeError('pass the hook, or the judge adapter the job names as its evaluator');
}
const modeOf = (m: keyof typeof VERDICT_MODE | undefined): number => VERDICT_MODE[m ?? 'deterministic'];

/**
 * A delivered job is done right: the seller receives the price and its deposit back, the backers their leg, the protocol fee
 * accrues, and the evaluator fee goes to the job's evaluator. Through the adapter: postVerdict(jobId, conformant, mode, digest).
 * `as: 'buyer'` is the buyer's own completion, allowed only on a job that names no evaluator.
 */
export function complete(a: Target & DecisionRoute & { jobId: Hex; digest?: Hex; mode?: keyof typeof VERDICT_MODE; as?: 'evaluator' | 'buyer' }): EconomyCall[] {
  assertEconomyChain(a.chainId, a);
  const jobId = b32(a.jobId, 'jobId'), r = routeOf(a);
  if (r.kind === 'adapter') {
    if (a.as === 'buyer') throw new RangeError('the judge adapter takes verdicts from its registered evaluators only (NotEvaluator)');
    const data = encodeFunction(ECONOMY_SIGNATURES.postVerdict, [jobId, VERDICT.conformant, modeOf(a.mode), b32(a.digest, 'digest')]);
    return [mk(a.chainId, r.to, data, 'postVerdict', 'evaluator', 'Post the conformant verdict: the adapter records its digest and completes the job (the seller is paid).')];
  }
  const signer: EconomyRole = a.as === 'buyer' ? 'buyer' : 'evaluator';
  return [mk(a.chainId, r.to, encodeFunction(ECONOMY_SIGNATURES.complete, [jobId]), 'complete', signer, 'Complete the delivered job: the seller is paid, the backers receive their leg.')];
}

/**
 * The job's evaluator proposes a rejection of a delivered job: reject(jobId, verdictDigest), or through the adapter
 * postVerdict(jobId, nonconformant | malformed, mode, digest). Nothing moves yet: the seller may dispute inside its window;
 * otherwise the rejection stands (finalizeReject) and the buyer receives the compensation. The buyer cannot reject.
 */
export function reject(a: Target & DecisionRoute & { jobId: Hex; verdictDigest: Hex; malformed?: boolean; mode?: keyof typeof VERDICT_MODE; as?: 'evaluator' | 'buyer' }): EconomyCall[] {
  assertEconomyChain(a.chainId, a);
  if (a.as === 'buyer') throw new RangeError('the buyer cannot reject a job opened with economy terms (BuyerCannotReject): complete it, or let the review window run into claimAutoComplete');
  const jobId = b32(a.jobId, 'jobId'), digest = b32(a.verdictDigest, 'verdictDigest'), r = routeOf(a);
  if (r.kind === 'adapter') {
    const data = encodeFunction(ECONOMY_SIGNATURES.postVerdict, [jobId, a.malformed ? VERDICT.malformed : VERDICT.nonconformant, modeOf(a.mode), digest]);
    return [mk(a.chainId, r.to, data, 'postVerdict', 'evaluator', `Post the ${a.malformed ? 'malformed' : 'nonconformant'} verdict: the adapter records its digest and proposes the rejection; the seller may dispute it.`)];
  }
  return [mk(a.chainId, r.to, encodeFunction(ECONOMY_SIGNATURES.reject, [jobId, digest]), 'reject', 'evaluator', 'Propose the rejection: the seller may dispute it inside its window.')];
}

// ── the arbitrator ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Rule on a disputed job, inside the arbitration window. Seller wins: the completion payout (the evaluator fee goes back to
 *  the buyer). Buyer wins: the rejection stands, with the compensation. */
export function resolveDispute(a: OnHook & { sellerWins: boolean }): EconomyCall[] {
  const { chainId, hook, jobId } = onHook(a);
  if (typeof a.sellerWins !== 'boolean') throw new TypeError('sellerWins must be true or false');
  return [mk(chainId, hook, encodeFunction(ECONOMY_SIGNATURES.resolveDispute, [jobId, a.sellerWins]), 'resolveDispute', 'arbitrator',
    a.sellerWins ? 'Rule for the seller: the job completes and the seller is paid.' : 'Rule for the buyer: the rejection stands and the buyer receives the compensation.')];
}

/** Find a delivered job's seller cheated, on an adjudicated loss: the buyer is paid from the deposit first, then from the pool,
 *  never more than the cover cap the job reserved. */
export function findCheated(a: OnHook & { loss: bigint }): EconomyCall[] {
  const { chainId, hook, jobId } = onHook(a);
  const loss = units(a.loss, 'loss');
  return [mk(chainId, hook, encodeFunction(ECONOMY_SIGNATURES.findCheated, [jobId, loss]), 'findCheated', 'arbitrator',
    `Find the seller cheated, on a loss of ${loss} units: the buyer is paid from the deposit, then from the pool up to the cover cap.`)];
}

// ── the keeper (anyone) ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Nobody disputed a rejection in time: it stands, and the buyer receives the compensation. Anyone, once the window passed. */
export function finalizeReject(a: OnHook): EconomyCall[] {
  const { chainId, hook, jobId } = onHook(a);
  return [mk(chainId, hook, encodeFunction(ECONOMY_SIGNATURES.finalizeReject, [jobId]), 'finalizeReject', 'keeper', 'End the undisputed rejection: it stands and the buyer receives the compensation.')];
}

/** The arbitrator never ruled: the rejection stands. Anyone, once the arbitration window passed. */
export function settleStaleDispute(a: OnHook): EconomyCall[] {
  const { chainId, hook, jobId } = onHook(a);
  return [mk(chainId, hook, encodeFunction(ECONOMY_SIGNATURES.settleStaleDispute, [jobId]), 'settleStaleDispute', 'keeper', 'End the dispute nobody ruled on: the rejection stands.')];
}

/** Past the deadline: an offer never accepted comes back to the buyer; an accepted job never delivered is a no-show (the buyer
 *  receives its escrow and the compensation from the deposit). A delivered job never expires: see claimAutoComplete. */
export function expire(a: OnHook): EconomyCall[] {
  const { chainId, hook, jobId } = onHook(a);
  return [mk(chainId, hook, encodeFunction(ECONOMY_SIGNATURES.expire, [jobId]), 'expire', 'keeper', 'End the job past its deadline: the buyer’s escrow comes back, with the compensation if the seller accepted and never delivered.')];
}

/** The review window of a delivered job passed with no decision: the delivery stands (the evaluator fee goes back to the buyer). */
export function claimAutoComplete(a: OnHook): EconomyCall[] {
  const { chainId, hook, jobId } = onHook(a);
  return [mk(chainId, hook, encodeFunction(ECONOMY_SIGNATURES.claimAutoComplete, [jobId]), 'claimAutoComplete', 'keeper', 'Complete the delivered job after its review window: the seller is paid.')];
}

/** Send the hook's accrued protocol fees to the fee payee the hook names. The caller picks when, never where. */
export function sweepLayerFees(a: Target & { hook: Address }): EconomyCall[] {
  assertEconomyChain(a.chainId, a);
  return [mk(a.chainId, addr(a.hook, 'hook'), encodeFunction(ECONOMY_SIGNATURES.sweepLayerFees, []), 'sweepLayerFees', 'keeper', 'Send the accrued protocol fees to the fee payee the hook names.')];
}

// ── the backer (the coverage pool, ERC-4626) ────────────────────────────────────────────────────────────────────────────

/** Back a seller: approve the pool for exactly `amount` of its asset, then deposit(amount, receiver). Shares at today's price. */
export function poolDeposit(a: Target & { pool: Address; asset: Address; amount: bigint; receiver: Address }): EconomyCall[] {
  assertEconomyChain(a.chainId, a);
  const pool = addr(a.pool, 'pool'), asset = addr(a.asset, 'asset'), receiver = addr(a.receiver, 'receiver'), amount = units(a.amount, 'amount');
  if (amount === 0n) throw new RangeError('amount must be positive');
  return [
    approveCall(a.chainId, asset, pool, amount, 'backer', `Allow the pool to take exactly ${amount} units. Nothing moves yet.`),
    mk(a.chainId, pool, encodeFunction(ECONOMY_SIGNATURES.deposit, [amount, receiver]), 'deposit', 'backer', `Deposit ${amount} units; the pool mints shares at today’s price.`),
  ];
}

/** Leave a pool: redeem(shares, receiver, owner). The pool pays today's value of the shares, up to what no job holds. */
export function poolRedeem(a: Target & { pool: Address; shares: bigint; owner: Address; receiver?: Address }): EconomyCall[] {
  assertEconomyChain(a.chainId, a);
  const pool = addr(a.pool, 'pool'), owner = addr(a.owner, 'owner'), receiver = addr(a.receiver ?? a.owner, 'receiver'), shares = units(a.shares, 'shares');
  if (shares === 0n) throw new RangeError('shares must be positive');
  return [mk(a.chainId, pool, encodeFunction(ECONOMY_SIGNATURES.redeem, [shares, receiver, owner]), 'redeem', 'backer', `Redeem ${shares} shares at today’s value.`)];
}

// ── who receives what ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A job's money terms, as its quote gave them and the job committed them. */
export interface EconomyQuote {
  price: bigint;
  premium: bigint;
  toBackers: bigint;
  protocolFee: bigint;
  deposit: bigint;
  compensation: bigint;
  evaluatorFee: bigint;
  /** the cover cap the job reserved in its pool (needed for `cheated`) */
  coverCap?: bigint;
}

/** The endings of a job opened with economy terms. */
export type EconomyEnding =
  | 'completed'           // the evaluator completed it (directly or through the adapter)
  | 'auto_completed'      // claimAutoComplete after the review window
  | 'dispute_seller_won'  // a rejection overturned by the arbitrator
  | 'rejected'            // a rejection that stands: finalizeReject, the arbitrator for the buyer, or settleStaleDispute
  | 'no_show'             // accepted, never delivered, expired
  | 'cancelled'           // an offer the buyer withdrew (cancelOpen)
  | 'lapsed'              // an offer never accepted, expired
  | 'cheated';            // findCheated on an adjudicated loss
export const ECONOMY_ENDINGS: readonly EconomyEnding[] = Object.freeze(['completed', 'auto_completed', 'dispute_seller_won', 'rejected', 'no_show', 'cancelled', 'lapsed', 'cheated']);

/** Who receives what at one ending, in token units. `buyer` counts every unit the buyer receives (on a cheat, the pool's
 *  payment too: `fromPool`); `protocolFee` is what accrues on the hook for the fee payee. */
export interface EndingLegs {
  buyer: bigint;
  seller: bigint;
  backers: bigint;
  protocolFee: bigint;
  evaluator: bigint;
  /** of the buyer's: the compensation from the seller's deposit */
  compensation: bigint;
  /** of the buyer's: the evaluator fee refunded */
  feeRefunded: bigint;
  /** of the buyer's, on a cheat: from the deposit, and from the pool (paid by the pool, not the hook) */
  fromDeposit: bigint;
  fromPool: bigint;
}

/**
 * The hook's payout at one ending for a job's committed terms (the hook's own arithmetic, V5.1). `cheated` needs the
 * adjudicated `loss` and the quote's `coverCap`; the pool is assumed to hold the cap it reserved (it reserved it at accept).
 * The legs always sum to what the job held: price + premium + evaluator fee, plus the deposit once accepted, plus `fromPool`.
 */
export function legsOf(ending: EconomyEnding, q: EconomyQuote, o: { loss?: bigint } = {}): EndingLegs {
  const P = units(q.price, 'price'), pi = units(q.premium, 'premium'), b = units(q.toBackers, 'toBackers'), fee = units(q.protocolFee, 'protocolFee');
  const D = units(q.deposit, 'deposit'), c = units(q.compensation, 'compensation'), E = units(q.evaluatorFee, 'evaluatorFee');
  if (b + fee !== pi) throw new RangeError(`the premium's legs must sum to the premium (${b} + ${fee} ≠ ${pi})`);
  if (c > D || c > P) throw new RangeError('the compensation is at most the price and the deposit');
  const L = (buyer: bigint, seller: bigint, x: Partial<EndingLegs> = {}): EndingLegs =>
    ({ buyer, seller, backers: 0n, protocolFee: 0n, evaluator: 0n, compensation: 0n, feeRefunded: 0n, fromDeposit: 0n, fromPool: 0n, ...x });
  // a completion: the seller gets P + D; with a pool the premium splits into its legs, without one it goes back to the buyer
  const pooled = b > 0n;
  const done = (feeToEvaluator: boolean): EndingLegs => {
    const back = (pooled ? 0n : pi) + (feeToEvaluator ? 0n : E);
    return L(back, P + D, { backers: pooled ? b : 0n, protocolFee: pooled ? fee : 0n, evaluator: feeToEvaluator ? E : 0n, feeRefunded: feeToEvaluator ? 0n : E });
  };
  switch (ending) {
    case 'completed': return done(true);
    case 'auto_completed': case 'dispute_seller_won': return done(false);
    case 'rejected': return L(P + pi + c, D - c, { evaluator: E, compensation: c });
    case 'no_show': return L(P + pi + c + E, D - c, { compensation: c, feeRefunded: E });
    case 'cancelled': case 'lapsed': return L(P + pi + E, 0n, { feeRefunded: E });
    case 'cheated': {
      if (o.loss === undefined) throw new TypeError('legsOf(\'cheated\') needs the adjudicated { loss }');
      if (q.coverCap === undefined) throw new TypeError('legsOf(\'cheated\') needs the quote\'s coverCap');
      const loss = units(o.loss, 'loss'), cap = units(q.coverCap, 'coverCap');
      const fromDeposit = loss < D ? loss : D, rest = loss - fromDeposit, fromPool = pooled ? (rest < cap ? rest : cap) : 0n;
      return L(P + pi + E + fromDeposit + fromPool, D - fromDeposit, { feeRefunded: E, fromDeposit, fromPool });
    }
    default: throw new RangeError(`not an ending: ${String(ending)}`);
  }
}

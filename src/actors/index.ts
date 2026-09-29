import { applyBps, clampToZero, formatUnits, min, ZERO } from '../core/money.js';
import type { Bps, Money } from '../core/money.js';
import { maxDoubtPayout, poolLossPerFailure, settle } from '../core/settle.js';
import type { JobTerms, Ledger, Role, Verdict } from '../core/types.js';

/**
 * Per-actor arithmetic.
 *
 * Everything here is derived from `settle()` rather than restated, so no actor
 * can be shown a number that disagrees with how the job would actually settle.
 * Each function answers one question a participant actually asks before
 * committing capital.
 */

const ALL_VERDICTS: readonly Verdict[] = ['doneRight', 'notDelivered', 'rejected', 'cheated'];

/** This actor's position under one verdict. */
export function positionUnder(role: Role, terms: JobTerms, verdict: Verdict): Money {
  return settle({ terms, verdict }).ledger[role];
}

/** This actor's position under every verdict — the whole risk picture at once. */
export function positionsByVerdict(role: Role, terms: JobTerms): Readonly<Record<Verdict, Money>> {
  const out = {} as Record<Verdict, Money>;
  for (const verdict of ALL_VERDICTS) out[verdict] = positionUnder(role, terms, verdict);
  return Object.freeze(out);
}

/** The worst this actor can do on a single job. Negative means a loss. */
export function worstCase(role: Role, terms: JobTerms): Money {
  const positions = Object.values(positionsByVerdict(role, terms));
  return positions.reduce((worst, p) => (p < worst ? p : worst), positions[0] ?? ZERO);
}

/** The best this actor can do on a single job. */
export function bestCase(role: Role, terms: JobTerms): Money {
  const positions = Object.values(positionsByVerdict(role, terms));
  return positions.reduce((best, p) => (p > best ? p : best), positions[0] ?? ZERO);
}

// ── Client ────────────────────────────────────────────────────────────────

/**
 * Damage the client would bear alone.
 *
 * Cover is limited by what is actually bonded. If the loss a job can cause
 * exceeds the deposit plus the pool, the excess falls on the client and no
 * escrow anywhere shows them that number before they commit.
 */
export function coverGap(terms: JobTerms): Money {
  return clampToZero(terms.damage - (terms.deposit + terms.poolCapital));
}

/** What the client actually recovers if cheating is established. */
export function recoveryFor(terms: JobTerms): Money {
  return positionUnder('client', terms, 'cheated');
}

// ── Provider ──────────────────────────────────────────────────────────────

/** Capital the provider must post to take this job. */
export function capitalRequired(terms: JobTerms): Money {
  return terms.deposit;
}

export type Decision = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Can this provider take the job with the capital it has free? */
export function canAccept(terms: JobTerms, freeCapital: Money): Decision {
  if (freeCapital < terms.deposit) {
    // Formatted, not raw. This string is shown to whoever is deciding whether
    // to take the job, and printing `200000000` for 200 USDC is off by six
    // orders of magnitude — the same defect already fixed in onboarding.
    return {
      ok: false,
      reason: `deposit of ${formatUnits(terms.deposit)} exceeds free capital of ${formatUnits(freeCapital)}`,
    };
  }
  return { ok: true };
}

// ── Evaluator ─────────────────────────────────────────────────────────────

/**
 * Whether an action requires a verified proof.
 *
 * Refusing to pay is always safe, so rejection needs no proof. Releasing
 * someone else's money is not safe, so approval does. Encoding the asymmetry
 * here — rather than leaving it in a comment — means an integrator cannot
 * invert it by accident.
 */
export function proofRequiredFor(action: 'approve' | 'reject'): boolean {
  return action === 'approve';
}

export function bondAtRisk(terms: JobTerms): Money {
  return terms.evaluatorBond;
}

// ── Pool / backer ─────────────────────────────────────────────────────────

export interface Exposure {
  readonly committed: Money;
  readonly capital: Money;
  readonly utilisation: number;
  readonly solvent: boolean;
}

/**
 * Exposure across jobs that could fail together.
 *
 * `runSeason` averages over a period and assumes failures are independent.
 * This asks the question that actually ends pools: what if several of the jobs
 * standing behind the same capital fail at once?
 */
export function poolExposure(terms: JobTerms, concurrentJobs: number, capital: Money): Exposure {
  // Was `clampToZero(min(damage - deposit, poolCapital))` — the same quantity
  // `settle` computes, restated. It happened to agree; two of the four sites
  // that restated it did not.
  const perJob = poolLossPerFailure(terms);
  const committed = perJob * BigInt(Math.max(0, Math.trunc(concurrentJobs)));
  const utilisation = capital > ZERO ? Number(committed) / Number(capital) : 0;
  return { committed, capital, utilisation, solvent: committed <= capital };
}

/** Could the pool honour this many simultaneous failures? */
export function solventUnder(capital: Money, terms: JobTerms, simultaneousFailures: number): boolean {
  return poolExposure(terms, simultaneousFailures, capital).solvent;
}

// ── Doubter ───────────────────────────────────────────────────────────────

export interface DoubtQuote {
  readonly fee: Money;
  readonly maxPayout: Money;
  /** True when the position is larger than the bonded capital behind the job. */
  readonly capped: boolean;
  /** Failure probability at which the position is break-even. */
  readonly breakEvenProbability: number;
}

/**
 * Price a doubt position.
 *
 * `capped` is the number a doubter most needs and is least likely to work out:
 * sizing above the bonded capital buys coverage that cannot pay out, so the fee
 * on the excess is spent for nothing.
 */
export function doubtQuote(terms: JobTerms, notional: Money, feeBps: Bps): DoubtQuote {
  const fee = applyBps(notional, feeBps);
  const cap = maxDoubtPayout(terms);
  const maxPayout = min(notional, cap);
  const breakEvenProbability = maxPayout > ZERO ? Number(fee) / Number(maxPayout) : 1;
  return { fee, maxPayout, capped: notional > cap, breakEvenProbability };
}

/** Does a doubt position size stay within what can actually pay out? */
export function sizeWithinCap(terms: JobTerms, notional: Money): boolean {
  return notional <= maxDoubtPayout(terms);
}

// ── Challenger ────────────────────────────────────────────────────────────

export interface ChallengeQuote {
  readonly winAmount: Money;
  readonly loseAmount: Money;
  readonly breakEvenProbability: number;
}

/** What a challenge pays, what it costs, and the odds at which it is worth taking. */
export function challengeQuote(terms: JobTerms, bond: Money): ChallengeQuote {
  const winAmount = terms.evaluatorBond;
  const loseAmount = bond;
  const total = Number(winAmount) + Number(loseAmount);
  return {
    winAmount,
    loseAmount,
    breakEvenProbability: total > 0 ? Number(loseAmount) / total : 1,
  };
}

export function worthChallenging(terms: JobTerms, bond: Money, probabilityOfWinning: number): boolean {
  return probabilityOfWinning > challengeQuote(terms, bond).breakEvenProbability;
}

export type { Ledger };

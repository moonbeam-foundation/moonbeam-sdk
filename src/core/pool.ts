import { clampToZero, min, ZERO } from './money.js';
import type { Bps, Money } from './money.js';
import { poolLossPerFailure } from './settle.js';

/**
 * Pool economics over a season.
 *
 * This module exists to answer one question that prose kept getting wrong:
 * at what failure rate does a coverage pool stop making money? A published
 * clearing fee is a claim about the failure rate the market expects. If the
 * fee a pool charges implies a different break-even than the fee the auction
 * clears at, the two numbers are describing different economies — and until
 * this is computed, nothing catches that.
 */

export interface SeasonInput {
  /** Jobs the pool backed over the period. */
  readonly jobs: number;
  /** Premium earned per job graded good. */
  readonly premiumPerJob: Money;
  /** Share of jobs that ended in `cheated`. 0.006 = 0.6%. */
  readonly failureRate: number;
  /** Consequential loss per failure. */
  readonly damagePerFailure: Money;
  /** Provider bond, consumed before the pool pays anything. */
  readonly depositPerJob: Money;
  /**
   * Capital standing behind the provider — the ceiling on what the pool can
   * lose per failure.
   *
   * Optional because omitting it is a meaningful statement: "model an
   * uncapped loss". But omitting it also means this projection can exceed what
   * `settle` would ever pay, so `capped` on the result says which you got.
   */
  readonly poolCapital?: Money;
}

export interface SeasonResult {
  readonly failures: number;
  readonly premiumEarned: Money;
  /** Loss absorbed by the cheating providers themselves. */
  readonly absorbedByDeposits: Money;
  /** Loss that reached the pool. */
  readonly paidByPool: Money;
  readonly net: Money;
  readonly profitable: boolean;
  /**
   * Whether the per-failure loss was capped at pool capital.
   *
   * False means no capital was supplied, so `paidByPool` is an uncapped
   * projection that can exceed anything `settle` would actually pay. A caller
   * comparing a season against real settlements must check this before
   * treating the two as the same quantity.
   */
  readonly capped: boolean;
}

function assertRate(rate: number, label: string): void {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new RangeError(`${label} must be a rate between 0 and 1, got ${rate}`);
  }
}

export function runSeason(input: SeasonInput): SeasonResult {
  assertRate(input.failureRate, 'failureRate');
  if (!Number.isInteger(input.jobs) || input.jobs < 0) {
    throw new RangeError(`jobs must be a non-negative integer, got ${input.jobs}`);
  }

  const failures = Math.round(input.jobs * input.failureRate);
  const good = input.jobs - failures;
  const premiumEarned = input.premiumPerJob * BigInt(good);

  const perFailureFromDeposit = min(input.damagePerFailure, input.depositPerJob);

  // Derived through the settlement core rather than restated here. This line
  // used to be a bare `clampToZero(damage - deposit)`, which ignored the pool
  // capital ceiling that `settle` enforces — so a season could project a loss
  // the protocol cannot actually pay.
  // A sentinel "infinite capital" value would make the uncapped path go through
  // the same call and look tidier, but it would also mean a real caller passing
  // a very large capital silently took the uncapped branch. The two cases are
  // genuinely different questions, so they are two visible branches.
  const capped = input.poolCapital !== undefined;
  const perFailureFromPool = capped
    ? poolLossPerFailure({
        pay: ZERO,
        premium: input.premiumPerJob,
        deposit: input.depositPerJob,
        evaluatorBond: ZERO,
        poolCapital: input.poolCapital as Money,
        damage: input.damagePerFailure,
      })
    : clampToZero(input.damagePerFailure - input.depositPerJob);

  const absorbedByDeposits = perFailureFromDeposit * BigInt(failures);
  const paidByPool = perFailureFromPool * BigInt(failures);
  const net = premiumEarned - paidByPool;

  return {
    failures,
    premiumEarned,
    absorbedByDeposits,
    paidByPool,
    net,
    profitable: net > ZERO,
    capped,
  };
}

/**
 * The failure rate at which a pool exactly breaks even.
 *
 * Returns `null` when the pool cannot lose (the provider deposit always covers
 * the damage in full), because there is then no rate at which it goes negative.
 */
export function breakEvenFailureRate(
  premiumPerJob: Money,
  damagePerFailure: Money,
  depositPerJob: Money,
  poolCapital?: Money,
): number | null {
  // Named `lossPerFailure`, not `poolLossPerFailure`: the latter shadowed the
  // imported function of that name, so the shared definition was invisible here
  // even after it existed.
  const lossPerFailure =
    poolCapital === undefined
      ? clampToZero(damagePerFailure - depositPerJob)
      : poolLossPerFailure({
          pay: ZERO,
          premium: premiumPerJob,
          deposit: depositPerJob,
          evaluatorBond: ZERO,
          poolCapital,
          damage: damagePerFailure,
        });
  if (lossPerFailure === ZERO) return null;
  // premium * (1 - r) = loss * r  ->  r = premium / (premium + loss)
  const premium = Number(premiumPerJob);
  const loss = Number(lossPerFailure);
  return premium / (premium + loss);
}

/** A clearing fee in bps read as the failure rate the market is pricing. */
export function impliedFailureRate(clearingFeeBps: Bps): number {
  return clearingFeeBps / 10_000;
}

/**
 * Does a published clearing fee agree with what the pool actually needs?
 *
 * `tolerance` is a ratio: 0.5 accepts the implied rate landing within half an
 * order of magnitude of break-even. A mismatch is not necessarily a bug — a
 * pool may deliberately price in a margin — but an *order-of-magnitude* gap
 * means the two figures were authored against different assumptions.
 */
export function clearingFeeIsCoherent(
  clearingFeeBps: Bps,
  premiumPerJob: Money,
  damagePerFailure: Money,
  depositPerJob: Money,
  tolerance = 0.5,
): boolean {
  const breakEven = breakEvenFailureRate(premiumPerJob, damagePerFailure, depositPerJob);
  if (breakEven === null) return true;
  const implied = impliedFailureRate(clearingFeeBps);
  if (implied === 0) return false;
  const ratio = implied / breakEven;
  return ratio >= tolerance && ratio <= 1 / tolerance;
}

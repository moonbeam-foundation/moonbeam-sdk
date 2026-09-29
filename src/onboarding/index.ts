import { clampToZero, formatUnits, min, ZERO } from '../core/money.js';
import type { Money } from '../core/money.js';
import { ACTORS } from '../core/actors.js';
import type { JobTerms, Role } from '../core/types.js';
import { breakEvenFailureRate } from '../core/pool.js';
import { coverGap, doubtQuote, poolExposure } from '../actors/index.js';
import { MIN_JOBS_FOR_A_RECORD } from '../actors/track-record.js';
import type { TrackRecord } from '../actors/track-record.js';
import { maxDoubtPayout } from '../core/settle.js';

/**
 * Safe onboarding — the checks that run before someone commits capital.
 *
 * Every actor here can lose money, and most of the ways they lose it are
 * knowable in advance: a position larger than the capital that could pay it, a
 * pool already committed past its own reserves, cover that stops short of the
 * damage a job can cause. None of that is exotic — it is arithmetic somebody
 * has to do, and the cost of not doing it falls entirely on the newcomer.
 *
 * So the SDK does it, and refuses rather than warns where the risk is one a
 * participant almost certainly did not intend to take.
 *
 * The design rule here: a `block` is for things nobody would knowingly agree
 * to (paying a fee that cannot pay out, joining a pool that is already
 * insolvent). A `caution` is for real risk that is nonetheless a legitimate
 * choice. Blocking a legitimate choice would be paternalism; letting an
 * unintended loss through would be negligence.
 */

export type Severity = 'block' | 'caution' | 'note';

export interface Finding {
  readonly severity: Severity;
  /** Short, specific, and about *this* participant's money. */
  readonly message: string;
  /** What to do about it. Absent when there is nothing to do. */
  readonly remedy?: string;
}

export interface Readiness {
  readonly role: Role;
  /** False when at least one finding is a `block`. */
  readonly safe: boolean;
  readonly findings: readonly Finding[];
  /** What this role must put up, restated from the registry so it is unmissable. */
  readonly youBond: string;
  /** What this role can lose. Never empty — every earner risks something. */
  readonly youRisk: string;
}

/**
 * Amounts in findings are formatted, not raw.
 *
 * These messages are read by whoever is about to commit capital. Printing
 * `4000` when the figure is 0.004 USDC is worse than printing nothing — it
 * looks like a number the reader can reason about, and it is off by six orders
 * of magnitude.
 */
const amt = (value: Money): string => formatUnits(value);

function assess(role: Role, findings: readonly Finding[]): Readiness {
  const spec = ACTORS[role];
  return {
    role,
    safe: !findings.some((f) => f.severity === 'block'),
    findings,
    youBond: spec.bonds,
    youRisk: spec.risks,
  };
}

// ── Client ────────────────────────────────────────────────────────────────

export interface ClientIntent {
  readonly terms: JobTerms;
  /** What a failure would actually cost this buyer, if they know. */
  readonly trueLoss?: Money;
}

/**
 * Cover is bounded by what is bonded. A buyer who believes they are fully
 * covered, when the loss a job can cause exceeds the deposit plus the pool, is
 * carrying the difference without having agreed to.
 */
export function readinessForClient(intent: ClientIntent): Readiness {
  const findings: Finding[] = [];
  const { terms } = intent;
  const gap = coverGap(terms);

  if (gap > ZERO) {
    findings.push({
      severity: 'caution',
      message: `cover stops ${amt(gap)} short of the damage this job can cause`,
      remedy: 'treat the shortfall as self-insured, or find a pool with more capital behind it',
    });
  }

  if (intent.trueLoss !== undefined && intent.trueLoss > terms.damage) {
    findings.push({
      severity: 'caution',
      message: `your stated loss exceeds the damage cover of ${amt(terms.damage)}`,
      remedy: 'raise the damage cover, or accept that the excess is uninsured',
    });
  }

  if (terms.premium === ZERO) {
    // Free cover is not a bargain — it means the underwriter earns nothing and
    // has no reason to honour it.
    findings.push({
      severity: 'block',
      message: 'the premium rounds to zero, so nobody is being paid to carry this risk',
      remedy: 'this job is too small to insure meaningfully',
    });
  }

  findings.push({
    severity: 'note',
    message: 'a rejection refunds you but pays no damage cover — only an adjudication does',
  });

  return assess('client', findings);
}

// ── Provider ──────────────────────────────────────────────────────────────

export interface ProviderIntent {
  readonly terms: JobTerms;
  readonly freeCapital: Money;
  /** Capital already committed as deposits on other open jobs. */
  readonly committed?: Money;
}

export function readinessForProvider(intent: ProviderIntent): Readiness {
  const findings: Finding[] = [];
  const { terms, freeCapital } = intent;
  const committed = intent.committed ?? ZERO;

  if (freeCapital < terms.deposit) {
    findings.push({
      severity: 'block',
      message: `this job needs a ${amt(terms.deposit)} deposit and you have ${amt(freeCapital)} free`,
      remedy: 'free up capital or take a smaller job',
    });
  }

  // Taking work whose deposit is most of what you have means one adverse
  // adjudication ends your ability to work at all.
  const afterThisJob = clampToZero(freeCapital - terms.deposit);
  if (freeCapital >= terms.deposit && afterThisJob < terms.deposit) {
    findings.push({
      severity: 'caution',
      message: 'this deposit leaves you unable to take another job of the same size',
      remedy: 'keep a reserve so one job cannot end your ability to work',
    });
  }

  if (committed > ZERO && terms.deposit > committed) {
    findings.push({
      severity: 'note',
      message: 'this single deposit exceeds everything you have locked across all other jobs',
    });
  }

  findings.push({
    severity: 'note',
    message: 'being graded bad costs you nothing beyond the job; only an adjudication forfeits the deposit',
  });

  return assess('provider', findings);
}

// ── Evaluator ─────────────────────────────────────────────────────────────

export interface EvaluatorIntent {
  readonly terms: JobTerms;
  readonly freeCapital: Money;
  /** Whether this evaluator can produce a verifiable proof for an approval. */
  readonly canProve: boolean;
}

export function readinessForEvaluator(intent: EvaluatorIntent): Readiness {
  const findings: Finding[] = [];
  const { terms, freeCapital, canProve } = intent;

  if (freeCapital < terms.evaluatorBond) {
    findings.push({
      severity: 'block',
      message: `issuing verdicts here needs a ${amt(terms.evaluatorBond)} bond and you have ${amt(freeCapital)}`,
    });
  }

  if (!canProve) {
    // Not a block: an evaluator that can only reject is still useful, and
    // rejecting is always safe. It just cannot ever release funds.
    findings.push({
      severity: 'caution',
      message: 'without a verifiable proof you can reject but never approve',
      remedy: 'approving releases someone else’s money, so it requires proof; rejecting never does',
    });
  }

  if (terms.evaluatorBond > terms.pay) {
    findings.push({
      severity: 'caution',
      message: 'your bond is larger than the job is worth, so one overturned call costs more than the fee could repay',
    });
  }

  findings.push({
    severity: 'note',
    message: 'silence is not an escape: the deadline resolves the job without you',
  });

  return assess('evaluator', findings);
}

// ── Backer ───────────────────────────────────────────────────────

export interface BackerIntent {
  readonly terms: JobTerms;
  readonly backing: Money;
  readonly poolCapital: Money;
  /** Jobs the pool already stands behind. */
  readonly openJobs: number;
  /** Failure rate the backer expects, as a fraction. */
  readonly expectedFailureRate?: number;
  /**
   * Records of the workers this pool actually backs.
   *
   * The single most useful thing a backer can supply, and the one the market
   * average cannot substitute for — see the concentration finding below.
   */
  readonly workers?: readonly TrackRecord[];
}

/**
 * The check a first-time backer most needs: whether the pool they are joining
 * could already fail to honour its commitments. Joining an over-committed pool
 * means buying into a loss that has already been incurred.
 */
export function readinessForBacker(intent: BackerIntent): Readiness {
  const findings: Finding[] = [];
  const { terms, backing, poolCapital, openJobs } = intent;

  const exposure = poolExposure(terms, openJobs, poolCapital);
  if (!exposure.solvent) {
    findings.push({
      severity: 'block',
      message: `this pool has committed ${amt(exposure.committed)} against ${amt(poolCapital)} of capital`,
      remedy: 'the shortfall already exists; joining would buy into it',
    });
  } else if (exposure.utilisation > 0.8) {
    findings.push({
      severity: 'caution',
      message: `the pool is ${(exposure.utilisation * 100).toFixed(0)}% committed, so a bad run leaves little headroom`,
    });
  }

  if (backing > ZERO && poolCapital > ZERO) {
    const share = Number(backing) / Number(poolCapital + backing);
    if (share > 0.5) {
      findings.push({
        severity: 'caution',
        message: 'you would be most of this pool, so its failures are effectively yours alone',
        remedy: 'spread across pools, or accept concentrated exposure knowingly',
      });
    }
  }

  if (intent.expectedFailureRate !== undefined) {
    // Was a hand-derivation of the same formula `breakEvenFailureRate` holds —
    // this module did not import `core/pool.ts` at all, so the two agreed by
    // coincidence rather than by construction, and neither capped the loss at
    // pool capital. Now it asks the one function that owns the answer.
    const breakEven = breakEvenFailureRate(
      terms.premium,
      terms.damage,
      terms.deposit,
      terms.poolCapital,
    );
    if (breakEven !== null && intent.expectedFailureRate > breakEven) {
      findings.push({
        severity: 'caution',
        message: `at the failure rate you expect this pool loses money — it breaks even at ${(breakEven * 100).toFixed(2)}%`,
        remedy: 'the premium is too low for the risk as you see it',
      });
    }
  }

  // A record for the workers actually backed beats any market figure, so when
  // one is supplied it is assessed instead of guessed at.
  if (intent.workers && intent.workers.length > 0) {
    const thin = intent.workers.filter((w) => !w.sufficient);
    const worst = intent.workers.reduce((a, b) => (b.nonDeliveryRate > a.nonDeliveryRate ? b : a));

    if (worst.sufficient && worst.nonDeliveryRate > 0.5) {
      findings.push({
        severity: 'block',
        message: `this pool backs a worker that failed to deliver ${(worst.nonDeliveryRate * 100).toFixed(1)}% of ${worst.matured} jobs`,
        remedy: 'a worker at that rate does not become safe by being pooled with better ones',
      });
    } else if (worst.sufficient && worst.nonDeliveryRate > 0.2) {
      findings.push({
        severity: 'caution',
        message: `the weakest worker here failed ${(worst.nonDeliveryRate * 100).toFixed(1)}% of ${worst.matured} jobs`,
      });
    }

    if (thin.length > 0) {
      // A worker with three clean jobs has not demonstrated anything, and a
      // point estimate of 0% would say it had.
      findings.push({
        severity: 'caution',
        message: `${thin.length} of ${intent.workers.length} workers have fewer than ${MIN_JOBS_FOR_A_RECORD} matured jobs, so their records prove little either way`,
      });
    }
  } else {
    findings.push({
      severity: 'caution',
      message: 'no worker records supplied, so this check could only use market-wide figures',
      remedy: 'pass the track records of the workers this pool backs — the aggregate describes no individual worker',
    });
  }

  findings.push({
    severity: 'note',
    message: 'exit is slower than claims settle, so you cannot withdraw ahead of a loss you agreed to cover',
  });

  // Measured on live agent traffic, and worth saying explicitly because the
  // headline number is alarming until you know what it does not mean: about a
  // fifth of settled agent jobs never deliver. None of that touches a pool —
  // an expiry refunds and pays no cover — but a newcomer who has seen the
  // failure rate and not the mapping will reasonably assume the worst.
  findings.push({
    severity: 'note',
    message:
      `on live traffic ${(OBSERVED_NON_DELIVERY_RANGE.low * 100).toFixed(0)}–${(OBSERVED_NON_DELIVERY_RANGE.high * 100).toFixed(0)}% of funded jobs never deliver, ` +
      'and none of it reaches you: only an adjudicated finding draws on cover',
  });

  // The spread is composition, not variance, and that changes the advice from
  // "expect noise" to "the average is meaningless". One provider produced 70%
  // of observed jobs and failed 99.6% of them; everyone else fails about 10%.
  findings.push({
    severity: 'caution',
    message:
      'that spread is which workers were busy, not a market rate: one provider produced ' +
      `${(OBSERVED_PROVIDER_CONCENTRATION.topProviderShare * 100).toFixed(0)}% of observed jobs and failed ` +
      `${(OBSERVED_PROVIDER_CONCENTRATION.topProviderNonDelivery * 100).toFixed(1)}% of them, while everyone else failed about ` +
      `${(OBSERVED_PROVIDER_CONCENTRATION.nonDeliveryExcludingTop * 100).toFixed(0)}%`,
    remedy: 'ask which workers this pool backs — an average across both populations describes neither',
  });

  // Adverse selection is the specific danger, and it is not obvious: the
  // agents most eager for cover are the ones least able to deliver without it.
  findings.push({
    severity: 'caution',
    message: 'a pool that backs workers indiscriminately is adversely selected, not diversified',
    remedy: 'unreliable workers have the most to gain from being covered, so they seek cover hardest',
  });

  return assess('pool', findings);
}

// ── Doubter ───────────────────────────────────────────────────────────────

export interface DoubterIntent {
  readonly terms: JobTerms;
  readonly notional: Money;
  readonly feeBps: number;
}

export function readinessForDoubter(intent: DoubterIntent): Readiness {
  const findings: Finding[] = [];
  const { terms, notional, feeBps } = intent;
  const quote = doubtQuote(terms, notional, feeBps);

  if (quote.capped) {
    const wasted = notional - maxDoubtPayout(terms);
    findings.push({
      severity: 'block',
      message: `${amt(wasted)} of this position can never pay out — the cap is ${amt(quote.maxPayout)}`,
      remedy: `size at or below ${amt(maxDoubtPayout(terms))}`,
    });
  }

  if (quote.fee === ZERO && notional > ZERO) {
    // A free position is not a gift: it means the fee rounded away, and a
    // market where doubt costs nothing is one where doubt means nothing.
    findings.push({
      severity: 'caution',
      message: 'the fee rounds to zero, so this position costs you nothing and signals nothing',
    });
  }

  findings.push({
    severity: 'note',
    message: `you break even at a ${(quote.breakEvenProbability * 100).toFixed(3)}% failure rate`,
  });
  findings.push({
    severity: 'note',
    message: 'a rejection is not a win: only an adjudicated finding pays doubt',
  });

  return assess('doubter', findings);
}

// ── Challenger ────────────────────────────────────────────────────────────

export interface ChallengerIntent {
  readonly terms: JobTerms;
  readonly bond: Money;
  /** The challenger's own estimate of winning, as a fraction. */
  readonly confidence?: number;
}

export function readinessForChallenger(intent: ChallengerIntent): Readiness {
  const findings: Finding[] = [];
  const { terms, bond } = intent;

  if (terms.evaluatorBond === ZERO) {
    findings.push({
      severity: 'block',
      message: 'the evaluator has no bond, so a successful challenge would pay nothing',
    });
  }

  // The payout is fixed at the evaluator's bond, so bonding more than that is
  // strictly worse: it cannot increase the win and only raises the loss.
  if (bond > terms.evaluatorBond && terms.evaluatorBond > ZERO) {
    findings.push({
      severity: 'block',
      message: `bonding ${amt(bond)} to win at most ${amt(terms.evaluatorBond)} loses money even when you are right`,
      remedy: `bond no more than ${amt(terms.evaluatorBond)}`,
    });
  }

  const total = Number(terms.evaluatorBond) + Number(bond);
  const breakEven = total > 0 ? Number(bond) / total : 1;

  if (intent.confidence !== undefined && intent.confidence <= breakEven) {
    findings.push({
      severity: 'caution',
      message: `you need better than ${(breakEven * 100).toFixed(1)}% confidence and you gave ${(intent.confidence * 100).toFixed(1)}%`,
    });
  }

  findings.push({
    severity: 'note',
    message: `a wrong challenge forfeits the whole ${amt(bond)}`,
  });

  return assess('challenger', findings);
}

/** Only the findings that stop someone committing. */
export function blockers(readiness: Readiness): readonly Finding[] {
  return readiness.findings.filter((f) => f.severity === 'block');
}

/** A one-line summary suitable for a prompt or a log. */
export function summarise(readiness: Readiness): string {
  const blocking = blockers(readiness);
  if (blocking.length > 0) {
    return `not safe to proceed as ${readiness.role}: ${blocking.map((f) => f.message).join('; ')}`;
  }
  const cautions = readiness.findings.filter((f) => f.severity === 'caution');
  return cautions.length > 0
    ? `safe to proceed as ${readiness.role}, with ${cautions.length} caution(s)`
    : `safe to proceed as ${readiness.role}`;
}

export const MIN_SAFE_POOL_HEADROOM = 0.2;

/**
 * The observed range of non-delivery on live agent traffic — a range, not a
 * rate, because it is not stable.
 *
 * Measured on Base across six consecutive ~70-hour windows (August 2026,
 * 15,498 logs, every one decoded, 2,250 funded and matured jobs). Non-delivery
 * ran from **8% to 84%** depending on the window, and two windows a week apart
 * had confidence intervals that did not overlap.
 *
 * An earlier draft of this file exported a single figure of 57.8%. That number
 * was correctly measured on one window and would still have been misleading,
 * because a reader would reasonably have taken it as *the* failure rate. It is
 * not: it is one draw from a distribution ten times wider than itself.
 *
 * The consequence for a pool is the important part. A pool priced for the good
 * end of this range is insolvent at the bad end, and the range is wide enough
 * that no fixed premium spans it. What protects a pool is not a well-chosen
 * rate — it is that non-delivery does not draw on cover at all.
 */
export const OBSERVED_NON_DELIVERY_RANGE = Object.freeze({
  low: 0.08,
  high: 0.843,
  windows: 6,
  jobs: 2_250,
  note: 'August 2026, Base; six ~70h windows; CIs of adjacent windows do not overlap',
});

/**
 * Why that range is so wide — and why it is not a market rate at all.
 *
 * Breaking the same traffic down by provider rather than by time: of 1,366
 * matured jobs across 41 providers, a single provider accounted for 955 of
 * them and failed to deliver 99.6%. Excluding that one address, non-delivery
 * across everybody else is about 10%.
 *
 * So the market is not one rate with noise around it. It is two populations —
 * agents that deliver almost always, and agents that almost never do — and a
 * window's "failure rate" is mostly a measure of which of them happened to be
 * busy. The 8–84% swing was composition, not time.
 *
 * The consequence for pricing is the whole point. A pool cannot price this
 * market, because there is no market rate to price: the same fee is either
 * far too high for a reliable worker or nowhere near enough for an unreliable
 * one. What a pool can price is a *worker*. A pool that backs indiscriminately
 * is not diversified, it is adversely selected — the unreliable agents are
 * exactly the ones with most to gain from cover.
 */
export const OBSERVED_PROVIDER_CONCENTRATION = Object.freeze({
  providers: 41,
  jobs: 1_366,
  /** Share of all jobs from the single busiest provider. */
  topProviderShare: 0.7,
  /** That provider's non-delivery rate. */
  topProviderNonDelivery: 0.996,
  /** Non-delivery across everyone else. */
  nonDeliveryExcludingTop: 0.1,
  note: 'August 2026, Base, 396k blocks; bimodal — not one rate with variance',
});

/**
 * The observed range of rejection — work delivered and graded bad.
 *
 * Also unstable (0.6%–23%), but note where it sits: rejection at its *typical*
 * level is roughly what a pool could absorb, whereas non-delivery is not, even
 * at its best. That asymmetry is the argument for settling the two differently.
 */
export const OBSERVED_REJECTION_RANGE = Object.freeze({
  low: 0.006,
  high: 0.23,
  windows: 6,
  note: 'same sample; rejection and non-delivery move independently',
});

export { min };

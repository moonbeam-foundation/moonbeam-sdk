import type { Address } from '../acp/hex.js';
import { sameAddress } from '../acp/hex.js';
import type { Clock } from '../core/clock.js';
import type { TaskState } from '../acp/lifecycle.js';
import { toOutcome } from '../acp/outcome.js';
import { wilson, Z } from '@taifoon/jev-wilson';

/**
 * A single worker's record, computed from decoded history.
 *
 * This exists because the market average turned out to be useless. Measured on
 * live traffic, one provider produced 70% of all jobs and failed 99.6% of them
 * while everybody else failed around 10% — so an aggregate rate describes
 * neither population, and a pool quoting one is quoting a number that applies
 * to no worker it might actually back.
 *
 * The unit that *is* meaningful is a worker. This module computes it from the
 * same decoded events everything else uses, so a backer can ask about the
 * counterparty rather than about the market.
 */

export interface TrackRecord {
  readonly provider: Address;
  /** Jobs that were funded and whose deadline has passed. */
  readonly matured: number;
  readonly delivered: number;
  readonly expired: number;
  readonly rejected: number;
  /** Share of matured jobs that never delivered. */
  readonly nonDeliveryRate: number;
  /** Share delivered but graded bad. */
  readonly rejectionRate: number;
  /**
   * Wilson 95% interval on the non-delivery rate.
   *
   * A worker with three jobs and no failures has not demonstrated
   * reliability, and a point estimate would imply it had. The interval makes
   * a thin record look thin.
   */
  readonly nonDeliveryInterval: readonly [number, number];
  /** False when the sample is too small to support any conclusion. */
  readonly sufficient: boolean;
}

/** Below this, a record is an anecdote rather than evidence. */
export const MIN_JOBS_FOR_A_RECORD = 20;

/**
 * Wilson score interval — deliberately not the textbook normal approximation,
 * which produces impossible bounds (below 0, above 1) exactly where these
 * records live: very high and very low rates on small samples. The one
 * implementation, shared with the premium curve, so the numbers never drift.
 */
export const WILSON_Z = Z;
/**
 * The 95 % Wilson score interval on k events in n trials: @taifoon/jev-wilson's `wilson`, the same arithmetic as
 * /v1/pools/quote. [0, 1] when n is 0. Kept as a name for the studio's folds and the onboard module.
 */
export function wilsonScore(k: number, n: number, z: number = WILSON_Z): [number, number] {
  return wilson(k, n, z);
}

/** Was this job funded and given its full time to deliver? */
function isMatured(state: TaskState, nowSeconds: number): boolean {
  const funded =
    state.escrow !== 'none' ||
    state.work === 'funded' ||
    state.work === 'submitted' ||
    state.work === 'graded' ||
    state.work === 'expired';
  return funded && state.deadline !== undefined && state.deadline < nowSeconds;
}

/** Build one worker's record from decoded job history. */
export function trackRecordFor(
  provider: Address,
  history: readonly TaskState[],
  clock: Clock,
): TrackRecord {
  let delivered = 0;
  let expired = 0;
  let rejected = 0;

  for (const state of history) {
    if (!sameAddress(state.provider, provider)) continue;
    if (!isMatured(state, clock.now)) continue;
    const outcome = toOutcome(state, clock);
    switch (outcome.verdict) {
      case 'doneRight':
        delivered += 1;
        break;
      case 'rejected':
        rejected += 1;
        break;
      case 'notDelivered':
        expired += 1;
        break;
      default:
        break;
    }
  }

  const matured = delivered + expired + rejected;
  return {
    provider,
    matured,
    delivered,
    expired,
    rejected,
    nonDeliveryRate: matured === 0 ? 0 : expired / matured,
    rejectionRate: matured === 0 ? 0 : rejected / matured,
    nonDeliveryInterval: wilson(expired, matured),
    sufficient: matured >= MIN_JOBS_FOR_A_RECORD,
  };
}

/** Every worker in the history, worst record first. */
export function trackRecords(history: readonly TaskState[], clock: Clock): readonly TrackRecord[] {
  const providers = new Set<Address>();
  for (const state of history) if (state.provider) providers.add(state.provider);
  return [...providers]
    .map((provider) => trackRecordFor(provider, history, clock))
    .filter((record) => record.matured > 0)
    .sort((a, b) => b.nonDeliveryRate - a.nonDeliveryRate);
}

export interface ConcentrationReport {
  readonly providers: number;
  readonly jobs: number;
  /** Share of all jobs from the single busiest worker. */
  readonly topShare: number;
  /**
   * True when one worker dominates enough that an aggregate rate is really
   * a statement about that worker.
   */
  readonly dominated: boolean;
  readonly topProvider?: Address;
}

/** Above this share, the average is mostly one participant's behaviour. */
export const DOMINANCE_THRESHOLD = 0.4;

/**
 * Is an aggregate over this history meaningful, or is it one worker?
 *
 * Worth running before quoting any market-wide rate. On live traffic this
 * returns `dominated: true`, which is why the SDK does not publish a single
 * failure rate.
 */
export function concentrationOf(history: readonly TaskState[], clock: Clock): ConcentrationReport {
  const records = trackRecords(history, clock);
  const jobs = records.reduce((total, record) => total + record.matured, 0);
  const busiest = records.reduce<TrackRecord | undefined>(
    (best, record) => (best === undefined || record.matured > best.matured ? record : best),
    undefined,
  );
  const topShare = jobs === 0 || !busiest ? 0 : busiest.matured / jobs;
  // With few workers a large share is arithmetic, not dominance — with two
  // workers somebody necessarily holds at least half. Dominance means holding
  // much more than an even split would give, which is what makes an average a
  // statement about one participant.
  const evenShare = records.length === 0 ? 1 : 1 / records.length;
  return {
    providers: records.length,
    jobs,
    topShare,
    dominated: topShare >= DOMINANCE_THRESHOLD && topShare > evenShare * 1.5,
    ...(busiest ? { topProvider: busiest.provider } : {}),
  };
}

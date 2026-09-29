import type { JobTerms, Verdict } from '../core/types.js';

/**
 * The adapter port.
 *
 * An adapter's whole job is translation: take whatever a host protocol calls
 * its job, and say what it is in assurance terms — a price, a judge, a
 * deadline. It does not settle anything; settlement is the core's business.
 *
 * A caution worth keeping in the code: one adapter is a hypothetical seam, two
 * is a real one. This interface is deliberately minimal because it currently
 * has exactly one implementation (ACP). Resist widening it to fit a second
 * protocol until that protocol actually exists and its shape is known — the
 * cheapest time to fix an interface is before anyone depends on it.
 */
export interface AssuranceAdapter<HostJob, HostOutcome> {
  /** Stable identifier for the host protocol, e.g. "acp". */
  readonly protocol: string;

  /**
   * Express a host protocol's job as insurable terms.
   *
   * Returns `null` when the job cannot be insured as presented — an unpriced
   * job, a missing deadline, a bond below policy. Returning null rather than
   * throwing keeps "not insurable" an ordinary answer instead of an error path,
   * because most jobs on a host protocol will not be insured.
   */
  toTerms(job: HostJob, policy: CoveragePolicy): JobTerms | null;

  /** Map the host's own outcome onto a settlement verdict. */
  toVerdict(outcome: HostOutcome): Verdict;
}

/**
 * What an underwriter is willing to cover, independent of any host protocol.
 *
 * Kept separate from the adapter so the same policy can be applied across
 * protocols, and so changing appetite never means editing an adapter.
 */
export interface CoveragePolicy {
  /** Premium charged on the job price, in basis points. */
  readonly premiumBps: number;
  /** Provider bond required, as basis points of the job price. */
  readonly depositBps: number;
  /** Evaluator bond required, as basis points of the job price. */
  readonly evaluatorBondBps: number;
  /** Capital standing behind the provider for this job. */
  readonly poolCapital: bigint;
  /** Largest job price the policy will cover. Bigger jobs are declined. */
  readonly maxJobValue: bigint;
  /**
   * Consequential loss covered, as basis points of the job price.
   * This is the part a bare escrow refund does not address.
   */
  readonly damageCoverBps: number;
}

import { applyBps } from '../core/money.js';
import type { JobTerms, Verdict } from '../core/types.js';
import type { AssuranceAdapter, CoveragePolicy } from './port.js';

/**
 * Adapter for the Agent Commerce Protocol (ACP).
 *
 * ACP runs a job through four phases — Request, Negotiation, Transaction,
 * Evaluation — across three roles: Client, Provider, Evaluator. Payment sits in
 * an escrow wallet and is released when the evaluator approves; if the provider
 * misses the SLA or the job expires, escrow refunds the client.
 *
 * That covers the price of the job. What it does not cover is the *cost of the
 * failure* — the campaign that missed its slot, the fill that never happened —
 * and it leaves the evaluator with no capital behind its verdict. Those two
 * gaps are what this adapter hands to the assurance core.
 */

/** ACP job phases, in lifecycle order. */
export type AcpPhase =
  | 'request'
  | 'negotiation'
  | 'transaction'
  | 'evaluation'
  | 'completed'
  | 'rejected'
  | 'expired';

/** The subset of an ACP job the adapter needs. Deliberately structural. */
export interface AcpJob {
  readonly id: string;
  /** Agreed price in USDC minor units (6 decimals). */
  readonly priceUsdc: bigint;
  readonly phase: AcpPhase;
  /** Hash of the cryptographically signed Proof of Agreement. */
  readonly proofOfAgreement?: string;
  /** Unix seconds by which the provider must deliver. */
  readonly slaDeadline?: number;
}

/**
 * What the evaluator said.
 *
 * `score` is optional because ACP evaluators approve or reject; a numeric score
 * is extra signal some evaluators provide. When present it is advisory only —
 * `approved` is the field that settles the job. A rejection that a challenger
 * later overturns is handled by the core, not here.
 */
export interface AcpEvaluation {
  readonly approved: boolean;
  readonly score?: number;
  readonly reasoning?: string;
  /** True when the job ended by SLA expiry rather than a verdict. */
  readonly expired?: boolean;
}

/** A sensible starting policy: 1% premium, 40% provider bond, small caps. */
export const DEFAULT_ACP_POLICY: CoveragePolicy = Object.freeze({
  premiumBps: 100,
  depositBps: 4_000,
  evaluatorBondBps: 2_500,
  poolCapital: 5_000_000_000n, // 5,000 USDC
  maxJobValue: 1_000_000_000n, // 1,000 USDC — Phase 2 opens with small caps
  damageCoverBps: 7_000,
});

/**
 * Phases at which a job can still be insured.
 *
 * Cover must be bought before the outcome is known. Once a job is in evaluation
 * or beyond, the answer is already being decided, so insuring it would be
 * writing cover against a known result.
 */
const INSURABLE_PHASES: ReadonlySet<AcpPhase> = new Set<AcpPhase>([
  'request',
  'negotiation',
  'transaction',
]);

export const acpAdapter: AssuranceAdapter<AcpJob, AcpEvaluation> = {
  protocol: 'acp',

  toTerms(job: AcpJob, policy: CoveragePolicy): JobTerms | null {
    if (job.priceUsdc <= 0n) return null;
    if (job.priceUsdc > policy.maxJobValue) return null;

    // Below a certain size the premium rounds away to nothing and the cover
    // becomes free — an underwriter would then be carrying real damage
    // exposure for zero income, at whatever volume an attacker cares to
    // generate. Rounding down is correct (never mint a unit nobody funded), so
    // the fix belongs here: decline the job rather than insure it for free.
    // Live agent jobs are genuinely this small, so this is not hypothetical.
    if (applyBps(job.priceUsdc, policy.premiumBps) <= 0n) return null;
    if (!INSURABLE_PHASES.has(job.phase)) return null;
    // No signed agreement means no agreed terms to grade against, so there is
    // nothing an evaluator could be held to.
    if (!job.proofOfAgreement) return null;
    // No deadline means a job can never be "late", and the deadline is what
    // resolves a job when an evaluator goes silent.
    if (job.slaDeadline === undefined) return null;

    return {
      pay: job.priceUsdc,
      premium: applyBps(job.priceUsdc, policy.premiumBps),
      deposit: applyBps(job.priceUsdc, policy.depositBps),
      evaluatorBond: applyBps(job.priceUsdc, policy.evaluatorBondBps),
      poolCapital: policy.poolCapital,
      damage: applyBps(job.priceUsdc, policy.damageCoverBps),
    };
  },

  toVerdict(outcome: AcpEvaluation): Verdict {
    // SLA expiry is ACP's own refund path: everyone walks back whole. It is
    // explicitly NOT cheating — nobody is punished for a job that expired.
    if (outcome.expired) return 'notDelivered';
    // A bare rejection is `rejected`, never `cheated`. An evaluator can refuse
    // without posting proof and without cost, so its refusal alone cannot
    // charge a coverage pool. `cheated` is reserved for the one on-chain fact
    // where a neutral third party found against the provider — an adjudication
    // in the client's favour (see acp/outcome.ts).
    return outcome.approved ? 'doneRight' : 'rejected';
  },
};

/** Whether an ACP job is eligible for cover under a policy. */
export function isInsurable(job: AcpJob, policy: CoveragePolicy = DEFAULT_ACP_POLICY): boolean {
  return acpAdapter.toTerms(job, policy) !== null;
}

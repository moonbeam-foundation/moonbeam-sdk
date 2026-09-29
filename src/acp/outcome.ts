import { expiryOf } from '../core/clock.js';
import type { Clock } from '../core/clock.js';
import type { Verdict } from '../core/types.js';
import { sameAddress } from './hex.js';
import { phaseOf } from './lifecycle.js';
import type { TaskState } from './lifecycle.js';

/**
 * Turning task state into a settlement verdict — or admitting it cannot yet.
 *
 * The rule that governs this file: a verdict moves money, so it is only
 * produced from a fact that actually settles the question. Where the chain has
 * said something ambiguous ("an arbitrator decided" without saying for whom),
 * the answer is `pending`, never a guess.
 */

export type OutcomeBasis =
  | 'evaluatorApproved'
  | 'evaluatorRejected'
  | 'proofVerifiedApproval'
  | 'proofVerifiedRejection'
  | 'requesterReleased'
  | 'refundedOnTimeout'
  | 'closedSettled'
  | 'closedTimeout'
  | 'expired'
  | 'adjudicatedForProvider'
  | 'adjudicatedForClient';

export type PendingReason =
  | 'notStarted'
  | 'awaitingFunding'
  | 'awaitingDelivery'
  | 'awaitingGrading'
  /** Mutually exclusive facts were folded in; the log set cannot be trusted. */
  | 'contradictory'
  /** The deadline has passed but nobody has claimed the refund yet. */
  | 'refundClaimable'
  /** A dispute is open; an arbitrator has not resolved it. */
  | 'awaitingAdjudication'
  /** Closed as adjudicated, but the winner is not known from these events. */
  | 'adjudicationWinnerUnknown'
  /** A close reason this build does not recognise. */
  | 'unrecognisedCloseReason';

export interface SettledOutcome {
  readonly verdict: Verdict;
  readonly basis: OutcomeBasis;
  /** Absent when settled. Present in the type so the union narrows cleanly. */
  readonly pending?: undefined;
}

export interface PendingOutcome {
  readonly verdict: null;
  readonly pending: PendingReason;
  readonly basis?: undefined;
}

export type AcpOutcome = SettledOutcome | PendingOutcome;

/**
 * Map task state onto a verdict.
 *
 * Precedence runs from the most authoritative fact downward: an adjudication by
 * a neutral arbitrator beats an evaluator's grade, which beats a bare escrow
 * movement, which beats a timeout.
 */
export function toOutcome(state: TaskState, clock: Clock): AcpOutcome {
  const phase = phaseOf(state, clock);

  // A job whose logs contradict each other has no settlement. Picking one of
  // two mutually exclusive terminals would be an inference, and an inference
  // must never move money.
  if (phase === 'contradictory') return { verdict: null, pending: 'contradictory' };

  // A dispute freezes the job until an arbitrator rules, and outranks any
  // grade already recorded.
  if (phase === 'awaitingAdjudication' && !state.adjudicatedWinner) {
    return { verdict: null, pending: 'awaitingAdjudication' };
  }

  // 1. Adjudication — the only neutral finding in the system.
  //
  // An arbitrator resolves a *held* escrow. If the escrow already released or
  // refunded, a later adjudication is a replay or a reorg artefact, not a new
  // ruling — and acting on it would re-open a finished job into a pool payout.
  // A close reason of `settled` or `timeout` is the task space recording that
  // the job finished without arbitration, so a later adjudication contradicts
  // it rather than supersedes it.
  const closedWithoutArbitration = state.closeReason === 'settled' || state.closeReason === 'timeout';
  if (state.adjudicatedWinner && closedWithoutArbitration) {
    return { verdict: null, pending: 'contradictory' };
  }

  if (state.adjudicatedWinner && state.escrow !== 'released' && state.escrow !== 'refunded') {
    if (state.provider && sameAddress(state.adjudicatedWinner, state.provider)) {
      return { verdict: 'doneRight', basis: 'adjudicatedForProvider' };
    }
    if (state.client && sameAddress(state.adjudicatedWinner, state.client)) {
      // The one verdict that draws on the deposit and the coverage pool: a
      // third party with nothing to gain from the job found against the provider.
      return { verdict: 'cheated', basis: 'adjudicatedForClient' };
    }
    return { verdict: null, pending: 'adjudicationWinnerUnknown' };
  }


  // 2. A grade from an evaluator.
  if (state.approved === true) {
    return state.verification === 'independent'
      ? { verdict: 'doneRight', basis: 'proofVerifiedApproval' }
      : { verdict: 'doneRight', basis: 'evaluatorApproved' };
  }
  if (state.approved === false) {
    // Graded bad — but rejection is free and unproven, so it refunds without
    // charging the pool. Only an adjudication makes it `cheated`.
    return state.verification === 'independent'
      ? { verdict: 'rejected', basis: 'proofVerifiedRejection' }
      : { verdict: 'rejected', basis: 'evaluatorRejected' };
  }

  // 3. Escrow movements with no grade attached.
  if (state.escrow === 'released') {
    // Note this is weaker than a verdict: release() is called by the requester,
    // not by a judge. It is the buyer declaring satisfaction, which is enough
    // to owe no cover, but it is not an adjudicated finding.
    return { verdict: 'doneRight', basis: 'requesterReleased' };
  }
  if (state.escrow === 'refunded') {
    return { verdict: 'notDelivered', basis: 'refundedOnTimeout' };
  }

  // 4. Task-space closure.
  if (state.work === 'closed') {
    switch (state.closeReason) {
      case 'settled':
        return { verdict: 'doneRight', basis: 'closedSettled' };
      case 'timeout':
        return { verdict: 'notDelivered', basis: 'closedTimeout' };
      case 'adjudicated':
        // Reason 2 says an arbitrator decided, but not for whom. The paired
        // Adjudicated(winner) event is required and was not in these events.
        return { verdict: null, pending: 'adjudicationWinnerUnknown' };
      default:
        return { verdict: null, pending: 'unrecognisedCloseReason' };
    }
  }
  if (state.work === 'expired') {
    return { verdict: 'notDelivered', basis: 'expired' };
  }

  // 5. Still in flight — say where it is rather than inventing an outcome.
  const expiry = expiryOf(state.deadline, clock);
  if (state.escrow === 'locked' && expiry.state === 'expired') {
    // Refunds are claimable, not automatic: AcpEscrow.refundOnTimeout must be
    // called. Until someone calls it the money is still locked.
    return { verdict: null, pending: 'refundClaimable' };
  }
  if (state.work === 'submitted') return { verdict: null, pending: 'awaitingGrading' };
  if (state.escrow === 'locked' || state.work === 'funded') {
    return { verdict: null, pending: 'awaitingDelivery' };
  }
  return { verdict: null, pending: 'notStarted' };
}

export function isSettled(outcome: AcpOutcome): outcome is SettledOutcome {
  return outcome.verdict !== null;
}

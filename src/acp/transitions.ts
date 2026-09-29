/**
 * The transition table — the one place that says what a job may do next.
 *
 * Before this module existed the lifecycle was implicit: monotonic ranks in the
 * fold said *what may follow what*, an if-branch cascade in the outcome said
 * *which fact wins*, and a third set of branches said *who may act*. Three
 * partial machines, none of them owning legality, and they disagreed.
 *
 * Ranks alone cannot express the rule that actually matters here. A lifecycle
 * is not a line, it is a shape with several ends: an escrow can be released, or
 * refunded, or adjudicated, and those are *mutually exclusive* rather than
 * ordered. A total order has no way to say "these two may never both be true",
 * so a tie between them silently degenerated into last-write-wins — and the
 * arrival order of logs decided who got paid.
 *
 * So this table answers two separate questions:
 *
 *   ranks       — what may follow what   (progress)
 *   terminality — what may coexist       (exclusivity)
 *
 * Only the first was ever written down.
 */

import type { EscrowStatus, WorkStatus } from './lifecycle-types.js';

/**
 * How far along the escrow is. Higher supersedes lower.
 *
 * The three terminals share rank 3 because none of them follows another —
 * they are alternative endings, not stages. `conflicts()` below is what stops
 * two of them being folded into the same job.
 */
export const ESCROW_RANK: Readonly<Record<EscrowStatus, number>> = Object.freeze({
  none: 0,
  locked: 1,
  disputed: 2,
  released: 3,
  refunded: 3,
  adjudicated: 3,
});

export const WORK_RANK: Readonly<Record<WorkStatus, number>> = Object.freeze({
  none: 0,
  open: 1,
  funded: 2,
  submitted: 3,
  graded: 4,
  expired: 4,
  closed: 5,
});

/**
 * Escrow states from which no further escrow movement is possible.
 *
 * Reaching one of these is the escrow's last word. A second terminal arriving
 * afterwards is not a later truth — it is a contradiction, and the fold must
 * say so rather than overwrite.
 */
export const ESCROW_TERMINALS: ReadonlySet<EscrowStatus> = new Set<EscrowStatus>([
  'released',
  'refunded',
  'adjudicated',
]);

/** Work states from which no further grading is possible. */
export const WORK_TERMINALS: ReadonlySet<WorkStatus> = new Set<WorkStatus>(['graded', 'expired', 'closed']);

export function isEscrowTerminal(status: EscrowStatus): boolean {
  return ESCROW_TERMINALS.has(status);
}

export function isWorkTerminal(status: WorkStatus): boolean {
  return WORK_TERMINALS.has(status);
}

/**
 * Do these two escrow states contradict each other?
 *
 * True when both are terminal and they differ — the escrow cannot have both
 * released to the provider and refunded to the client. Anything else is either
 * progress or a repeat.
 */
export function escrowConflicts(a: EscrowStatus, b: EscrowStatus): boolean {
  return a !== b && isEscrowTerminal(a) && isEscrowTerminal(b);
}

export function workConflicts(a: WorkStatus, b: WorkStatus): boolean {
  if (a === b) return false;
  // `closed` is a wrapper around an already-decided job rather than a rival
  // ending, so it may follow a grade or an expiry without contradicting it.
  if (a === 'closed' || b === 'closed') return false;
  return isWorkTerminal(a) && isWorkTerminal(b);
}

/**
 * What happens when a new status is folded onto an existing one.
 *
 * `advance`   — the new status supersedes the old.
 * `keep`      — the old status stands (the new one is stale or a repeat).
 * `conflict`  — both are terminal and mutually exclusive; neither can be
 *               trusted, and the caller must record the contradiction rather
 *               than silently pick one.
 */
export type Resolution = 'advance' | 'keep' | 'conflict';

export function resolveEscrow(current: EscrowStatus, incoming: EscrowStatus): Resolution {
  if (escrowConflicts(current, incoming)) return 'conflict';
  return ESCROW_RANK[incoming] > ESCROW_RANK[current] ? 'advance' : 'keep';
}

export function resolveWork(current: WorkStatus, incoming: WorkStatus): Resolution {
  if (workConflicts(current, incoming)) return 'conflict';
  return WORK_RANK[incoming] > WORK_RANK[current] ? 'advance' : 'keep';
}

/**
 * Grades are mutually exclusive too, and were previously plain
 * last-write-wins with no rank at all — so a replayed approval could overturn
 * a rejection, or the reverse, purely on arrival order.
 */
export function resolveGrade(current: boolean | undefined, incoming: boolean): Resolution {
  if (current === undefined) return 'advance';
  return current === incoming ? 'keep' : 'conflict';
}

/**
 * Phases of a job, as one value.
 *
 * Three modules used to each reconstruct "where is this job" from six raw
 * fields, with rules that had already drifted apart — "is it disputed" was
 * asked three different ways. Deriving it once means they cannot disagree.
 */
export type Phase =
  | 'notStarted'
  | 'awaitingFunding'
  | 'awaitingDelivery'
  | 'awaitingGrading'
  | 'awaitingAdjudication'
  | 'refundClaimable'
  | 'settled'
  /** Two contradictory terminal facts were folded in; nothing can be concluded. */
  | 'contradictory';

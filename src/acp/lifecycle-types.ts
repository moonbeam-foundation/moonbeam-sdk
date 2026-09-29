/**
 * The two status axes a job moves along.
 *
 * Kept in their own module so the transition table and the fold can both name
 * them without either importing the other.
 */

/** Escrow-side status. Mirrors the escrow contract's own state enum. */
export type EscrowStatus = 'none' | 'locked' | 'released' | 'refunded' | 'disputed' | 'adjudicated';

/** Work-side status, spanning both the task-space statuses and the job states. */
export type WorkStatus = 'none' | 'open' | 'funded' | 'submitted' | 'graded' | 'closed' | 'expired';

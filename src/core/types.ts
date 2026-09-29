import type { Money, Bps } from './money.js';

/**
 * Roles in an insured job.
 *
 * These are ACP's names (Client / Provider / Evaluator) plus the three roles
 * the assurance layer adds. Keeping ACP's vocabulary means an integration does
 * not have to translate on the way in.
 */
export type Role =
  | 'client' // ACP: the buyer agent. Pays for work, and for cover.
  | 'provider' // ACP: the seller agent. Does the work, bonds a deposit.
  | 'evaluator' // ACP: the judge. Bonded; loses the bond if overturned.
  | 'pool' // Assurance: GLMR backers standing behind the provider.
  | 'doubter' // Assurance: takes the other side of the pool.
  | 'challenger'; // Assurance: bonds a claim against one specific verdict.

/**
 * Everyone who can act on a job, including those who never hold a position.
 *
 * `Role` is deliberately narrower: it keys the settlement ledger, so a member
 * of it is somebody money can move to or from. The arbitrator resolves
 * disputes and unresolvable states but takes no share of the escrow, so
 * putting it in `Role` would give it a ledger line that must always be zero —
 * and would let a caller ask what an arbitrator *earned*, which is not a
 * question this system answers.
 *
 * It still has to be nameable: it is the only party who can end three of the
 * four states nobody else can, and a report on who is stranded cannot omit the
 * party who unsticks them.
 */
export type Participant = Role | 'arbitrator';

export const ARBITRATOR = 'arbitrator' as const;

/** Does this participant hold a position in the settlement ledger? */
export function holdsPosition(participant: Participant): participant is Role {
  return participant !== 'arbitrator';
}

/** Whether a role can participate without putting capital at risk. */
export type Obligation = 'obligatory' | 'optional';

export interface ActorSpec {
  readonly role: Role;
  /** Whether taking part in an insured job requires posting capital. */
  readonly obligation: Obligation;
  /** What the role must bond to participate at all. */
  readonly bonds: string;
  /** What it earns when things go right. */
  readonly earns: string;
  /** What it loses when things go wrong. Never empty — every earner risks something. */
  readonly risks: string;
}

/**
 * The terms of one insured job. All amounts in minor units of the settlement
 * asset (see money.ts).
 */
export interface JobTerms {
  /** What the client pays the provider for the work itself. */
  readonly pay: Money;
  /** What the client pays for cover, on top of `pay`. */
  readonly premium: Money;
  /** The provider's own bond. First capital consumed when it cheats. */
  readonly deposit: Money;
  /** The evaluator's bond. Paid to a challenger if its verdict is overturned. */
  readonly evaluatorBond: Money;
  /** Capital standing behind the provider, available to cover a shortfall. */
  readonly poolCapital: Money;
  /**
   * Consequential loss to the client when cheating is established — the cost of
   * the failure, not just the price of the job. Covering this is the whole
   * reason the assurance layer exists: a plain escrow refund does not.
   */
  readonly damage: Money;
}

/**
 * How a job ended.
 *
 * The split between `rejected` and `cheated` is the one that protects a pool.
 * Refusing to pay is free and safe for an evaluator — it requires no proof —
 * so rejections are ordinary events, not evidence of fraud. If every rejection
 * paid out damage cover, a pool would be underwriting quality disputes rather
 * than dishonesty, and its loss rate would track the rejection rate instead of
 * the fraud rate.
 *
 * - `doneRight`    the work was delivered and graded good.
 * - `notDelivered` nothing arrived: the deadline passed, or the job expired.
 * - `rejected`     work arrived and was graded bad. Everything walks back —
 *                  no damage cover, because no neutral party found dishonesty.
 * - `cheated`      a neutral third party found against the provider. The only
 *                  verdict that draws on the deposit and the coverage pool.
 */
export type Verdict = 'doneRight' | 'notDelivered' | 'rejected' | 'cheated';

/** An optional, opt-in position taken against a pool. */
export interface DoubtPosition {
  readonly notional: Money;
  readonly feeBps: Bps;
}

/** An optional, opt-in bonded claim that a specific verdict was wrong. */
export interface ChallengePosition {
  readonly bond: Money;
  /** Whether the challenge succeeded — i.e. the evaluator's call was overturned. */
  readonly upheld: boolean;
}

export interface SettlementInput {
  readonly terms: JobTerms;
  readonly verdict: Verdict;
  readonly doubt?: DoubtPosition;
  readonly challenge?: ChallengePosition;
}

/** Net position per role. Positive is received, negative is paid. */
export type Ledger = Readonly<Record<Role, Money>>;

export interface Settlement {
  readonly ledger: Ledger;
  /** Value locked in escrow for the duration: pay + premium + deposit. */
  readonly locked: Money;
  /** Loss the provider's own deposit could not cover, met by the pool. */
  readonly poolShortfall: Money;
  /** Human-readable trace of each transfer, in order. Useful in tests and UIs. */
  readonly explain: readonly string[];
}

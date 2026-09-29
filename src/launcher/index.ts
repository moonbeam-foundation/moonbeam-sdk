/**
 * The launcher — one insured job, phase by phase, for every party.
 *
 * This module is the spine of the onboarding surface: it says which phases a
 * job passes through, what each party does in each phase, whether they
 * are allowed to start (the readiness checks refuse before capital moves),
 * and how a job's ending is decided — by the trail alone when the chain can
 * show it, by a graded verdict when it cannot.
 *
 * Everything here is pure and browser-safe: no chain, no keys, no hashing.
 * The digest, the stamp and the feedback call live in `adapters/stamp` and run
 * where a hash library exists (a server, a wallet); the launcher only says
 * when they are due.
 */
import { readinessForClient, readinessForProvider, readinessForBacker, readinessForEvaluator, blockers } from '../onboarding/index.js';
import type { ClientIntent, ProviderIntent, BackerIntent, EvaluatorIntent, Readiness } from '../onboarding/index.js';

// ── Phases ────────────────────────────────────────────────────────────────────

export const PHASES = ['discover', 'quote', 'fund', 'submit', 'judge', 'settle', 'trail'] as const;
export type Phase = (typeof PHASES)[number];

export const LAUNCH_ROLES = ['client', 'provider', 'backer', 'evaluator'] as const;
export type LaunchRole = (typeof LAUNCH_ROLES)[number];

/** What a phase means, in the words the surface uses. */
export const PHASE_MEANING: Readonly<Record<Phase, { title: string; what: string }>> = Object.freeze({
  discover: { title: 'Discover', what: 'Find who can do the work: registered agents with a live endpoint and a record you can read.' },
  quote: { title: 'Quote', what: 'Price the job and its guarantee from the seller’s own record: an interval, never a point estimate.' },
  fund: { title: 'Fund', what: 'Lock the price and premium in escrow; the seller locks its deposit. Nothing moves until both are in.' },
  submit: { title: 'Submit', what: 'The seller delivers and pins a digest of the deliverable on chain.' },
  judge: { title: 'Judge', what: 'Decide the ending: from the trail when the chain can show it, from a graded verdict when it cannot.' },
  settle: { title: 'Settle', what: 'The ending moves the money: seller paid or buyer refunded, deposit returned or held.' },
  trail: { title: 'Trail', what: 'The grade, its question and its distribution are pinned by digest where anyone can recompute them.' },
});

/** The phase a party acts in, and what they do there. `null` = they watch. */
export const ROLE_STEPS: Readonly<Record<LaunchRole, Readonly<Record<Phase, string | null>>>> = Object.freeze({
  client: {
    discover: 'Pick a seller from its record, not its rank.',
    quote: 'Read the premium interval; a thin record is priced as unknown, never refused.',
    fund: 'Sign the escrow lock: price plus premium.',
    submit: null,
    judge: 'If the work declared a check, re-run it. Otherwise the grade decides; you sign what it fills in.',
    settle: null,
    trail: 'Keep the digest; it is your receipt.',
  },
  provider: {
    discover: 'Be findable: a card with a live endpoint and the skills you actually deliver.',
    quote: 'Your record sets the premium. Every settled job narrows it.',
    fund: 'Approve and lock your deposit; it must exceed the price.',
    submit: 'Deliver, and pin the deliverable’s digest.',
    judge: null,
    settle: 'Paid on a settled ending; deposit returned on any honest ending.',
    trail: 'Your grades accumulate where the next buyer looks.',
  },
  backer: {
    discover: 'Read a seller’s record before writing cover for it.',
    quote: 'Cover is priced from the record; you earn the premium only on settled receipts.',
    fund: 'Nothing of yours moves at funding.',
    submit: null,
    judge: 'A grade never touches a pool. Only a proven cheat can draw on cover.',
    settle: 'Premium on a settled receipt; cover drawn only on an adjudicated loss, capped at what you wrote.',
    trail: 'Every draw and every premium is on chain with the job it came from.',
  },
  evaluator: {
    discover: null,
    quote: null,
    fund: null,
    submit: null,
    judge: 'Answer one closed question over the sealed evidence with a distribution, or abstain.',
    settle: 'Your digest drives the ending through the adapter; an abstention refunds the buyer and lands on your record.',
    trail: 'Model version, question and answer list pinned with the grade.',
  },
});

// ── Readiness gate ────────────────────────────────────────────────────────────

export type LaunchIntent =
  | { role: 'client'; intent: ClientIntent }
  | { role: 'provider'; intent: ProviderIntent }
  | { role: 'backer'; intent: BackerIntent }
  | { role: 'evaluator'; intent: EvaluatorIntent };

export interface LaunchPlan {
  role: LaunchRole;
  readiness: Readiness;
  /** true when nothing blocks; cautions may remain */
  canStart: boolean;
  steps: ReadonlyArray<{ phase: Phase; title: string; what: string; you: string | null; status: 'ready' | 'blocked' | 'watch' }>;
}

/** The readiness checks for the role, then the phase list with what this party does in each. */
export function launchFor(l: LaunchIntent): LaunchPlan {
  const readiness =
    l.role === 'client' ? readinessForClient(l.intent)
    : l.role === 'provider' ? readinessForProvider(l.intent)
    : l.role === 'backer' ? readinessForBacker(l.intent)
    : readinessForEvaluator(l.intent);
  const canStart = blockers(readiness).length === 0;
  const steps = PHASES.map((phase) => {
    const you = ROLE_STEPS[l.role][phase];
    const status: 'ready' | 'blocked' | 'watch' = you === null ? 'watch' : canStart ? 'ready' : 'blocked';
    return { phase, title: PHASE_MEANING[phase].title, what: PHASE_MEANING[phase].what, you, status };
  });
  return { role: l.role, readiness, canStart, steps };
}

// ── Deciding the ending: the trail first, the judge only when the trail cannot ──

/** The ERC-8183 lifecycle events a trail is made of (names as the standard emits them). */
export type TrailEvent = 'JobCreated' | 'BudgetSet' | 'JobFunded' | 'JobSubmitted' | 'JobCompleted' | 'PaymentReleased' | 'Refunded' | 'JobExpired' | 'JobRejected';

export const ENDINGS = ['delivered_as_specified', 'delivered_with_defects', 'not_delivered', 'cannot_determine'] as const;
export type Ending = (typeof ENDINGS)[number];

export interface Decision {
  ending: Ending;
  /** 'trail' = decided by the events alone (anyone re-derives it); 'judge' = the trail cannot decide, a graded verdict is needed */
  decidedBy: 'trail' | 'judge';
  basis: string;
}

/**
 * The deterministic decoder. The same rules on every chain, in this order:
 *   JobCompleted or PaymentReleased        → delivered as specified (the buyer accepted and the escrow paid)
 *   JobSubmitted then Refunded/JobRejected → delivered with defects (work arrived and was refused)
 *   no submission, then Refunded/Expired   → not delivered (nothing arrived)
 *   JobSubmitted then JobExpired           → the trail cannot say; a grade is needed
 *   anything still open                    → the trail cannot say yet
 * A trail decides the money; it never decides whether the work was good. That is why every
 * undecided case is routed to the judge instead of guessed.
 */
export function endingFromTrail(events: readonly TrailEvent[]): Decision {
  const has = (e: TrailEvent) => events.includes(e);
  if (has('JobCompleted') || has('PaymentReleased')) return { ending: 'delivered_as_specified', decidedBy: 'trail', basis: 'JobCompleted / PaymentReleased fired: the buyer accepted and the escrow paid the seller' };
  if (has('JobSubmitted') && (has('Refunded') || has('JobRejected'))) return { ending: 'delivered_with_defects', decidedBy: 'trail', basis: 'JobSubmitted then Refunded without JobCompleted: work arrived and the buyer refused it' };
  if (!has('JobSubmitted') && (has('Refunded') || has('JobExpired'))) return { ending: 'not_delivered', decidedBy: 'trail', basis: 'Refunded or JobExpired with no JobSubmitted: nothing arrived' };
  if (has('JobSubmitted') && has('JobExpired')) return { ending: 'cannot_determine', decidedBy: 'judge', basis: 'JobSubmitted then JobExpired: work arrived and nobody ruled; the trail cannot say whether it was good' };
  return { ending: 'cannot_determine', decidedBy: 'judge', basis: events.length ? 'the job is still open on chain' : 'no events' };
}

/** A grade as the judge returns it: one closed question, a distribution over the answers, a confidence. */
export interface GradeAnswer { value: Ending; probabilities: Readonly<Partial<Record<Ending, number>>>; confidence: number }

export interface Comparison {
  trail: Decision;
  grade: GradeAnswer;
  /** the grade names the same ending the trail settled */
  agree: boolean;
  /** the grade abstained (cannot_determine) — the right answer when the work is not on chain */
  abstained: boolean;
  /** the grade clears the bar the surface applies before it acts on a grade */
  clearsBar: boolean;
}

export const GRADE_BAR = 0.8;

/** DET against the grade, the comparison the study makes for every real job. */
export function compare(events: readonly TrailEvent[], grade: GradeAnswer, bar = GRADE_BAR): Comparison {
  const trail = endingFromTrail(events);
  const abstained = grade.value === 'cannot_determine';
  return { trail, grade, agree: trail.decidedBy === 'trail' && grade.value === trail.ending, abstained, clearsBar: grade.confidence >= bar && (grade.probabilities[grade.value] ?? 0) >= bar };
}

/** The ending's effect on the money, in the launcher's words (mirrors the settlement rules; a grade never touches a pool). */
export const ENDING_EFFECT: Readonly<Record<Ending, string>> = Object.freeze({
  delivered_as_specified: 'Settled. The seller is paid and gets its deposit back.',
  delivered_with_defects: 'Rejected. The buyer is refunded from escrow. The seller gets its deposit back; bad work is not cheating.',
  not_delivered: 'Rejected. Same as above. The pool pays nothing.',
  cannot_determine: 'No grade. The buyer is refunded, nobody is paid, and the miss lands on the evaluator’s record, not the seller’s.',
});

// ── Cases: what the surface can show, and which kind each one is ──────────────

export type CaseKind = 'trail' | 'graded' | 'attested';

export interface LaunchCase {
  id: string;
  chainId: number;
  kind: CaseKind;
  title: string;
  decision: Decision;
  grade?: GradeAnswer;
  comparison?: Comparison;
}

/** Fold a job row (its events and, if present, its grade) into a case the surface can render. */
export function caseFor(row: { id: string; chainId: number; events: readonly TrailEvent[]; grade?: GradeAnswer; title?: string }): LaunchCase {
  const decision = endingFromTrail(row.events);
  const comparison = row.grade ? compare(row.events, row.grade) : undefined;
  const kind: CaseKind = row.grade && decision.decidedBy === 'judge' ? 'graded' : 'trail';
  const base: LaunchCase = { id: row.id, chainId: row.chainId, kind, title: row.title ?? `job #${row.id} on chain ${row.chainId}`, decision };
  return { ...base, ...(row.grade ? { grade: row.grade } : {}), ...(comparison ? { comparison } : {}) };
}

/** Counts the surface prints above a case list. */
export function summarise(cases: readonly LaunchCase[]): { total: number; byKind: Record<CaseKind, number>; agree: number; abstained: number; disagree: number } {
  const byKind: Record<CaseKind, number> = { trail: 0, graded: 0, attested: 0 };
  let agree = 0, abstained = 0, disagree = 0;
  for (const c of cases) {
    byKind[c.kind]++;
    if (c.comparison) { if (c.comparison.abstained) abstained++; else if (c.comparison.agree) agree++; else disagree++; }
  }
  return { total: cases.length, byKind, agree, abstained, disagree };
}

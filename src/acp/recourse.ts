import { expiryOf } from '../core/clock.js';
import type { Clock } from '../core/clock.js';
import type { Participant, Role } from '../core/types.js';
import type { Address } from './hex.js';
import type { TaskState } from './lifecycle.js';
import { phaseOf } from './lifecycle.js';
import { toOutcome } from './outcome.js';

/**
 * Recourse: what each party can do next, and — more importantly — proof that
 * nobody can be left with nothing to do.
 *
 * A job holds other people's money. If any single party could refuse to act and
 * thereby strand the funds, that party would hold everyone else hostage. The
 * escrow's defence is that the two dangerous silences both have an escape:
 *
 *   - A silent client cannot strand the provider. `release()` is the client's
 *     alone, but the provider can `dispute()` and force an arbitrator to decide.
 *   - A silent provider cannot strand the client. `refundOnTimeout()` is
 *     permissionless once the deadline passes, so anyone at all can unlock the
 *     refund — the client does not need the provider's cooperation, or even the
 *     arbitrator's.
 *   - A silent evaluator cannot strand either. The deadline resolves the job
 *     without a grade.
 *
 * `livenessOf` checks these properties against real state, so a caller can
 * assert them rather than trust them.
 */

export type ActionId =
  | 'fund'
  | 'deliver'
  | 'grade'
  | 'release'
  | 'claimRefund'
  | 'dispute'
  | 'adjudicate'
  | 'challengeVerdict'
  | 'wait';

export interface Action {
  readonly id: ActionId;
  /** Who may take it. `anyone` matters: a permissionless action cannot be blocked. */
  readonly by: Participant | 'anyone';
  readonly why: string;
  /** True when taking it moves money out of escrow. */
  readonly settles: boolean;
}

export interface Recourse {
  /** Everything that can happen next, from any party. */
  readonly available: readonly Action[];
  /** Actions this specific party can take right now. */
  readonly mine: readonly Action[];
  /** Present when the party is waiting on someone else, naming who. */
  readonly blockedOn?: Participant;
  /** The party's guaranteed way out even if everyone else goes silent. */
  readonly guaranteedExit?: Action;
}

const WAIT: Action = { id: 'wait', by: 'anyone', why: 'nothing to do yet', settles: false };

/**
 * Waiting is not recourse.
 *
 * `wait` is `by: 'anyone'`, so counting it as an action a party can take made
 * the stranding check unfalsifiable — every role always had `wait` in `mine`,
 * so "this party has nothing it can do" could never be true, and the liveness
 * proof certified `noLockout` for a job whose funds were genuinely frozen.
 */
function isRealAction(action: Action): boolean {
  return action.id !== 'wait';
}

/** Everything that could be done next on this job, regardless of who you are. */
export function availableActions(state: TaskState, clock: Clock): Action[] {
  const outcome = toOutcome(state, clock);
  if (outcome.verdict !== null) return []; // settled: nothing left to do
  const expiry = expiryOf(state.deadline, clock);
  const actions: Action[] = [];

  const phase = phaseOf(state, clock);

  if (phase === 'awaitingAdjudication') {
    actions.push({
      id: 'adjudicate',
      by: 'arbitrator',
      why: 'a dispute is open and only an arbitrator can resolve it',
      settles: true,
    });
    return actions;
  }

  // An adjudication naming somebody who is neither party leaves the escrow in
  // a terminal state that yields no verdict. Previously every branch below fell
  // through and the job silently became unresolvable, so the arbitrator is
  // named as the only party who can put it right.
  if (state.adjudicatedWinner && toOutcome(state, clock).verdict === null) {
    actions.push({
      id: 'adjudicate',
      by: 'arbitrator',
      why: 'the recorded winner is neither party, so only a corrected ruling can settle this',
      settles: true,
    });
    return actions;
  }

  // Likewise a close reason this build does not recognise: it cannot be turned
  // into a verdict, so say who can resolve it rather than offering nothing.
  if (state.work === 'closed' && toOutcome(state, clock).verdict === null) {
    actions.push({
      id: 'adjudicate',
      by: 'arbitrator',
      why: 'the job closed for a reason this build cannot interpret',
      settles: true,
    });
    return actions;
  }

  if (state.escrow === 'none') {
    actions.push({ id: 'fund', by: 'client', why: 'the job is not funded yet', settles: false });
    return actions;
  }

  if (state.escrow === 'locked') {
    if (state.work !== 'submitted' && state.work !== 'graded') {
      actions.push({ id: 'deliver', by: 'provider', why: 'work has not been delivered', settles: false });
    }
    if (state.work === 'submitted') {
      actions.push({ id: 'grade', by: 'evaluator', why: 'a deliverable is waiting to be graded', settles: false });
      actions.push({ id: 'release', by: 'client', why: 'the client can accept the delivery', settles: true });
    }
    if (expiry.state === 'expired') {
      // The keystone: permissionless, so a silent counterparty cannot block it.
      actions.push({
        id: 'claimRefund',
        by: 'anyone',
        why: 'the deadline has passed and the refund is claimable by anyone',
        settles: true,
      });
    }
    // Either party can always escalate rather than wait forever.
    actions.push({
      id: 'dispute',
      by: 'client',
      why: 'the client can escalate to arbitration',
      settles: false,
    });
    actions.push({
      id: 'dispute',
      by: 'provider',
      why: 'the provider can escalate rather than wait on a silent client',
      settles: false,
    });
  }

  return actions.length > 0 ? actions : [WAIT];
}

/** What a given party can do, what they are waiting on, and their way out. */
export function recourseFor(role: Participant, state: TaskState, clock: Clock): Recourse {
  const available = availableActions(state, clock);
  const mine = available.filter((a) => a.by === role || a.by === 'anyone');

  // A guaranteed exit is an action that settles the job and that this party can
  // take without anyone else's cooperation.
  const guaranteedExit = mine.find((a) => a.settles && (a.by === 'anyone' || a.by === role));

  // Derived from the job's phase rather than from whichever action happened to
  // be pushed first — that made the answer an artefact of source-line order,
  // and told uninvolved roles they were "blocked on" a party at random.
  const blockedOn = mine.some(isRealAction) ? undefined : waitingOn(state, clock) ?? undefined;

  return {
    available,
    mine,
    ...(blockedOn ? { blockedOn } : {}),
    ...(guaranteedExit ? { guaranteedExit } : {}),
  };
}

export interface LivenessReport {
  /** True when no party can strand another's funds by going silent. */
  readonly noLockout: boolean;
  /** Parties with no way to make progress and no escape. Should always be empty. */
  readonly stranded: readonly Role[];
  readonly notes: readonly string[];
  /** Exactly who this report checked. Without it, `noLockout` is unreadable. */
  readonly checked: readonly Role[];
}

/**
 * Who has capital in this job, and therefore who can be stranded.
 *
 * This used to be the literal `['client', 'provider']`, which meant the
 * no-lockout proof — the protocol's headline safety claim — never looked at the
 * evaluator, the pool, the doubter or the challenger. Each of those posts
 * capital (bond, pool capital, doubt fee, challenge bond), so `noLockout: true`
 * was really "neither of two parties is stranded", reported as "nobody is".
 *
 * Which parties are exposed is a property of the job, not a constant: a job
 * whose evaluator has not yet graded cannot strand that evaluator, and
 * reporting on a party that has put up nothing would invent exposure that does
 * not exist.
 *
 * The list stops at the roles a `TaskState` can actually evidence. `TaskState`
 * is folded from Virtuals ACP logs, and the assurance layer (pool, doubter,
 * challenger) does not settle on that ledger — so this state carries no fact
 * about whether cover was bought or a doubt position taken. Deriving those
 * roles from it would mean guessing, and a liveness proof that guesses at who
 * is exposed is worth less than one that says what it checked. `checked` on the
 * report names the covered set so a caller can see the limit rather than infer
 * a stronger claim; extending it is gated on decoding assurance-side events,
 * not on adding names here.
 */
function partiesAtRisk(state: TaskState): Role[] {
  // The client's money and the provider's deposit are both inside a locked
  // escrow; neither can withdraw unilaterally.
  const parties: Role[] = ['client', 'provider'];

  // An evaluator that has graded has put its bond behind a specific verdict and
  // is exposed until the job ends. One that has not graded has posted nothing
  // to this job and is free to walk away.
  if (state.work === 'graded') parties.push('evaluator');

  return parties;
}

/**
 * Check the no-lockout property against real state.
 *
 * A party counts as stranded only if the job is unsettled, they can take no
 * action, and they have no escalation path. Waiting on an arbitrator is not
 * stranding: the dispute has already been raised and an outcome is coming.
 */
export function livenessOf(state: TaskState, clock: Clock): LivenessReport {
  const outcome = toOutcome(state, clock);
  const notes: string[] = [];
  if (outcome.verdict !== null) {
    return {
      noLockout: true,
      stranded: [],
      notes: ['job is settled; no party is waiting'],
      checked: [],
    };
  }

  // Nothing is escrowed yet, so nobody's money is exposed and nobody can be
  // stranded. A provider waiting on a client to fund is simply not engaged: it
  // has committed nothing and can walk away at no cost. Lockout is about funds
  // being held hostage, not about a job that never started.
  if (state.escrow === 'none') {
    return {
      noLockout: true,
      stranded: [],
      notes: ['nothing is escrowed yet: no party has funds exposed, so none can be held hostage'],
      checked: [],
    };
  }

  const parties = partiesAtRisk(state);
  const stranded: Role[] = [];

  for (const role of parties) {
    const r = recourseFor(role, state, clock);
    // `wait` is excluded deliberately: it is the absence of an action, and
    // counting it made this check incapable of ever reporting a stranded party.
    const canAct = r.mine.some(isRealAction);
    const arbitrationPending = r.available.some((a) => a.id === 'adjudicate');
    if (!canAct && !arbitrationPending) {
      stranded.push(role);
    }
  }

  const expiry = expiryOf(state.deadline, clock);
  if (expiry.state === 'expired' && state.escrow === 'locked') {
    notes.push('refund is claimable by anyone: a silent counterparty cannot hold the funds');
  }
  if (state.disputed) {
    notes.push('dispute raised: an arbitrator must resolve it, and either party could raise it');
  }
  if (state.escrow === 'locked' && expiry.state === 'live') {
    notes.push('within the deadline: both parties can still act, and either can escalate');
  }

  notes.push(`checked ${parties.join(', ')}`);
  return { noLockout: stranded.length === 0, stranded, notes, checked: parties };
}

/**
 * Who, if anyone, currently holds the job up.
 *
 * Derived from the job's phase so it cannot disagree with `blockedOn`, which
 * asks the same question. The two used to answer it with independent rules.
 */
export function waitingOn(state: TaskState, clock: Clock): Participant | null {
  switch (phaseOf(state, clock)) {
    case 'settled':
    case 'contradictory':
      return null;
    case 'awaitingAdjudication':
      return 'arbitrator';
    case 'awaitingGrading':
      return 'evaluator';
    case 'awaitingDelivery':
      return 'provider';
    case 'notStarted':
    case 'awaitingFunding':
      return 'client';
    case 'refundClaimable':
      // Nobody is blocking: the refund is permissionless, so anyone may end it.
      return null;
  }
}

/** Convenience for UIs: is this address a party to the job at all? */
export function isParty(state: TaskState, address: Address): boolean {
  const a = address.toLowerCase();
  return [state.client, state.provider, state.evaluator]
    .filter(Boolean)
    .some((p) => p!.toLowerCase() === a);
}

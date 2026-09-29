import { sameAddress, ZERO_ADDRESS } from './hex.js';
import type { Address, Hex32 } from './hex.js';
import type { AcpEvent, CloseReason } from './events.js';
import { expiryOf } from '../core/clock.js';
import type { Clock } from '../core/clock.js';
import { isEscrowTerminal, resolveEscrow, resolveGrade, resolveWork } from './transitions.js';
import type { Phase } from './transitions.js';
import type { EscrowStatus, WorkStatus } from './lifecycle-types.js';

export type { EscrowStatus, WorkStatus };

/**
 * Folding decoded events into the state of one job.
 *
 * The fold is order-insensitive on purpose. Logs arrive out of order across
 * reorgs, paginated queries and multiple sources, so a fold that depended on
 * arrival order would produce different answers for the same chain history.
 * Instead each event sets the facts it knows, and lifecycle *progress* is
 * derived from which facts are present.
 */


/**
 * Who graded the work — the field that measures whether independent evaluation
 * happened at all. On live agent-commerce traffic the overwhelming majority of
 * jobs are `none` or `self`; `independent` is vanishingly rare. That gap is the
 * reason an assurance layer has something to sell.
 */
export type VerificationClass = 'none' | 'self' | 'independent' | 'unknown';

export interface TaskState {
  /** bytes32 task id (Moonbeam ACP) or the decimal job id (Virtuals ACP). */
  readonly id: string;
  readonly escrow: EscrowStatus;
  readonly work: WorkStatus;
  readonly client?: Address;
  readonly provider?: Address;
  readonly evaluator?: Address;
  readonly verification: VerificationClass;
  readonly amount?: bigint;
  /** Unix seconds after which a refund becomes claimable. */
  readonly deadline?: number;
  readonly openedAt?: number;
  readonly deliverableHash?: Hex32;
  readonly closeReason?: CloseReason;
  /** Set only once an arbitrator has actually resolved the dispute. */
  readonly adjudicatedWinner?: Address;
  readonly disputed: boolean;
  readonly disputedBy?: Address;
  /**
   * Mutually exclusive facts that were both folded in.
   *
   * Non-empty means the log set is incoherent — a replayed event, a reorg, or
   * two sources disagreeing. Nothing downstream may settle such a job, because
   * there is no honest answer to give.
   */
  readonly contradictions: readonly string[];
  /** True when an evaluator approved; false when it rejected; undefined when neither. */
  readonly approved?: boolean;
  readonly evaluatorFeePaid?: bigint;
}

const EMPTY: TaskState = Object.freeze({
  id: '',
  escrow: 'none',
  work: 'none',
  verification: 'unknown',
  disputed: false,
  contradictions: Object.freeze([]),
});


function classify(client?: Address, evaluator?: Address): VerificationClass {
  if (!evaluator) return 'unknown';
  if (sameAddress(evaluator, ZERO_ADDRESS)) return 'none';
  if (client && sameAddress(evaluator, client)) return 'self';
  return 'independent';
}

/**
 * Fold events for a single job into one state.
 *
 * Callers must pass events for one job only; mixing ids silently merges two
 * histories. `groupByJob` below does the splitting.
 */
export function foldTask(events: readonly AcpEvent[]): TaskState {
  let s: TaskState = EMPTY;

  const contradictions: string[] = [];

  const set = (patch: Partial<TaskState>): void => {
    // Every status change is put to the transition table. Two mutually
    // exclusive terminals — released and refunded, an approval and a rejection
    // — are a contradiction rather than a later truth, and are recorded instead
    // of silently overwriting. Without this, arrival order picked the verdict.
    const next = { ...s, ...patch };

    if (patch.escrow !== undefined) {
      const resolution = resolveEscrow(s.escrow, patch.escrow);
      if (resolution === 'keep') next.escrow = s.escrow;
      if (resolution === 'conflict') {
        next.escrow = s.escrow;
        contradictions.push(`escrow is both ${s.escrow} and ${patch.escrow}`);
      }
    }

    if (patch.work !== undefined) {
      const resolution = resolveWork(s.work, patch.work);
      if (resolution === 'keep') next.work = s.work;
      if (resolution === 'conflict') {
        next.work = s.work;
        contradictions.push(`work is both ${s.work} and ${patch.work}`);
      }
    }

    if (patch.approved !== undefined) {
      const resolution = resolveGrade(s.approved, patch.approved);
      if (resolution !== 'advance' && s.approved !== undefined) next.approved = s.approved;
      if (resolution === 'conflict') {
        contradictions.push(`graded both approved and rejected`);
      }
    }

    s = next;
  };

  for (const e of events) {
    switch (e.kind) {
      // ── Virtuals ACP ──
      case 'jobCreated':
        set({
          id: e.jobId.toString(),
          work: 'open',
          client: e.client,
          provider: e.provider,
          evaluator: e.evaluator,
          verification: classify(e.client, e.evaluator),
          deadline: e.expiredAt,
        });
        break;
      case 'budgetSet':
        // The agreed price, recorded before funding. Not itself an escrow move.
        set({ id: s.id || e.jobId.toString(), amount: e.amount });
        break;
      case 'jobRefunded':
        // Money returned to the client. A terminal escrow move, so it conflicts
        // with a release rather than superseding it.
        set({ id: s.id || e.jobId.toString(), escrow: 'refunded' });
        break;
      case 'paymentReleased':
        // Payment actually left escrow for the provider.
        set({ id: s.id || e.jobId.toString(), escrow: 'released' });
        break;
      case 'jobFunded':
        set({ id: s.id || e.jobId.toString(), escrow: 'locked', work: 'funded', amount: e.amount });
        break;
      case 'jobSubmitted':
        set({ id: s.id || e.jobId.toString(), work: 'submitted', deliverableHash: e.memoHash, provider: e.provider });
        break;
      case 'jobCompleted':
        set({ id: s.id || e.jobId.toString(), work: 'graded', escrow: 'released', approved: true, evaluator: e.evaluator });
        break;
      case 'jobRejected':
        set({ id: s.id || e.jobId.toString(), work: 'graded', escrow: 'refunded', approved: false, evaluator: e.evaluator });
        break;
      case 'jobExpired':
        set({ id: s.id || e.jobId.toString(), work: 'expired' });
        break;
      case 'evaluatorFeePaid':
        set({ id: s.id || e.jobId.toString(), evaluatorFeePaid: e.amount });
        break;

      // ── Moonbeam ACP: work ──
      case 'taskOpened':
        set({ id: s.id || e.taskId, work: 'open', client: e.requester, provider: e.agent, openedAt: e.openedAt });
        break;
      case 'deliverablePosted':
        set({ id: s.id || e.taskId, work: 'submitted', deliverableHash: e.deliverableHash });
        break;
      case 'taskClosed':
        set({ id: s.id || e.taskId, work: 'closed', closeReason: e.reason });
        break;

      // ── Moonbeam ACP: escrow ──
      case 'locked':
        set({
          id: s.id || e.taskId,
          escrow: 'locked',
          client: e.requester,
          provider: e.agent,
          amount: e.amount,
          deadline: e.deadline,
        });
        break;
      case 'released':
        set({ id: s.id || e.taskId, escrow: 'released', provider: e.agent, deliverableHash: e.deliverableHash });
        break;
      case 'refunded':
        set({ id: s.id || e.taskId, escrow: 'refunded', client: e.requester });
        break;
      case 'adjudicated':
        // The winner is the fact that matters. A close reason of "adjudicated"
        // says a decision happened; only this says which way.
        set({ id: s.id || e.taskId, escrow: 'adjudicated', adjudicatedWinner: e.winner });
        break;

      case 'disputed':
        // A dispute is recorded as its own fact, never written into the escrow
        // status. Folding it into `escrow` made the result depend on whether
        // the dispute or the lock was seen first, and left two fields that
        // could disagree about the same thing.
        set({ id: s.id || e.taskId, disputed: true, disputedBy: e.by });
        break;

      case 'evaluated':
        set({
          id: s.id || e.jobId.toString(),
          work: 'graded',
          approved: e.approved,
          // A proof-verified approval is the strongest grading signal available:
          // the evaluator could not complete the job without a proof that
          // verified on-chain.
          verification: 'independent',
        });
        break;
    }
  }

  // Late-arriving identity can change the classification, so settle it last.
  if (s.verification === 'unknown' && s.evaluator) {
    s = { ...s, verification: classify(s.client, s.evaluator) };
  }
  return contradictions.length > 0 ? { ...s, contradictions } : s;
}

/**
 * Where a job is, as one value.
 *
 * This is the single answer to "is it disputed / expired / settled". Three
 * modules used to reconstruct that from raw fields with rules that had already
 * drifted apart, which is how a job came to be simultaneously settled and
 * waiting on an arbitrator.
 */
export function phaseOf(state: TaskState, clock: Clock): Phase {
  // A contradictory log set has no honest phase, and must never settle.
  if (state.contradictions.length > 0) return 'contradictory';

  // A dispute freezes everything until an arbitrator rules — but only while
  // the escrow is still holding. Once it has paid out, the dispute is history.
  const escrowOpen = !isEscrowTerminal(state.escrow);
  if (state.disputed && escrowOpen) return 'awaitingAdjudication';

  if (isEscrowTerminal(state.escrow) || state.approved !== undefined) return 'settled';
  if (state.work === 'closed' || state.work === 'expired') return 'settled';

  if (state.escrow === 'none') return state.work === 'none' ? 'notStarted' : 'awaitingFunding';

  if (expiryOf(state.deadline, clock).state === 'expired') return 'refundClaimable';
  if (state.work === 'submitted') return 'awaitingGrading';
  return 'awaitingDelivery';
}

/** Split a mixed stream of events into one bucket per job id. */
export function groupByJob(events: readonly AcpEvent[]): Map<string, AcpEvent[]> {
  const out = new Map<string, AcpEvent[]>();
  for (const e of events) {
    const id = 'taskId' in e ? e.taskId : e.jobId.toString();
    const bucket = out.get(id);
    if (bucket) bucket.push(e);
    else out.set(id, [e]);
  }
  return out;
}

/** Fold a mixed stream into one state per job. */
export function foldTasks(events: readonly AcpEvent[]): TaskState[] {
  return [...groupByJob(events).values()].map(foldTask);
}

/** Jobs whose grader was the paying client, or absent entirely. */
export function findSelfGraded(states: readonly TaskState[]): TaskState[] {
  return states.filter((s) => s.verification === 'self' || s.verification === 'none');
}

/** Share of jobs that had a genuinely independent grader. */
export function independentShare(states: readonly TaskState[]): number {
  if (states.length === 0) return 0;
  const independent = states.filter((s) => s.verification === 'independent').length;
  return independent / states.length;
}

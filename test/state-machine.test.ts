import { describe, expect, it } from 'vitest';
import {
  findSelfGraded,
  foldTask,
  foldTasks,
  independentShare,
  livenessOf,
  localClock,
  recourseFor,
  toOutcome,
  waitingOn,
  ZERO_ADDRESS,
} from '../src/index.js';
import type { AcpEvent, TaskState } from '../src/index.js';

const CLIENT = '0x1111111111111111111111111111111111111111' as const;
const PROVIDER = '0x2222222222222222222222222222222222222222' as const;
const EVALUATOR = '0x3333333333333333333333333333333333333333' as const;
const TASK = `0x${'ab'.repeat(32)}` as const;

const DEADLINE = 1_800_000_000;
const BEFORE = localClock(DEADLINE - 1_000);
const AFTER = localClock(DEADLINE + 1_000);

const opened: AcpEvent = { kind: 'taskOpened', taskId: TASK, requester: CLIENT, agent: PROVIDER, openedAt: 1 };
const locked: AcpEvent = {
  kind: 'locked', taskId: TASK, requester: CLIENT, agent: PROVIDER, amount: 100n, deadline: DEADLINE,
};
const delivered: AcpEvent = { kind: 'deliverablePosted', taskId: TASK, deliverableHash: `0x${'cd'.repeat(32)}` };

describe('folding events into state', () => {
  it('is order-insensitive, because logs do not arrive in order', () => {
    const forward = foldTask([opened, locked, delivered]);
    const backward = foldTask([delivered, locked, opened]);
    expect(forward).toEqual(backward);
  });

  it('splits a mixed stream into one state per job', () => {
    const other = { ...opened, taskId: `0x${'ef'.repeat(32)}` } as AcpEvent;
    expect(foldTasks([opened, locked, other])).toHaveLength(2);
  });
});

describe('who graded the work', () => {
  it('marks a zero-address evaluator as ungraded', () => {
    const s = foldTask([
      { kind: 'jobCreated', jobId: 1n, client: CLIENT, provider: PROVIDER, evaluator: ZERO_ADDRESS, expiredAt: DEADLINE, hook: ZERO_ADDRESS },
    ]);
    expect(s.verification).toBe('none');
  });

  it('marks the client grading its own job as self-graded', () => {
    const s = foldTask([
      { kind: 'jobCreated', jobId: 1n, client: CLIENT, provider: PROVIDER, evaluator: CLIENT, expiredAt: DEADLINE, hook: ZERO_ADDRESS },
    ]);
    expect(s.verification).toBe('self');
  });

  it('marks a third-party evaluator as independent', () => {
    const s = foldTask([
      { kind: 'jobCreated', jobId: 1n, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR, expiredAt: DEADLINE, hook: ZERO_ADDRESS },
    ]);
    expect(s.verification).toBe('independent');
  });

  /** The measurement the assurance case rests on. */
  it('measures how much of a population was independently graded', () => {
    const mk = (evaluator: string): AcpEvent => ({
      kind: 'jobCreated', jobId: 1n, client: CLIENT, provider: PROVIDER,
      evaluator: evaluator as `0x${string}`, expiredAt: DEADLINE, hook: ZERO_ADDRESS,
    });
    const states = [foldTask([mk(ZERO_ADDRESS)]), foldTask([mk(CLIENT)]), foldTask([mk(EVALUATOR)])];
    expect(independentShare(states)).toBeCloseTo(1 / 3);
    expect(findSelfGraded(states)).toHaveLength(2);
  });
});

describe('outcomes: only settled facts produce a verdict', () => {
  it('waits while work is in flight', () => {
    expect(toOutcome(foldTask([opened, locked]), BEFORE)).toMatchObject({ verdict: null, pending: 'awaitingDelivery' });
  });

  it('waits for a grade once work is delivered', () => {
    expect(toOutcome(foldTask([opened, locked, delivered]), BEFORE)).toMatchObject({
      verdict: null, pending: 'awaitingGrading',
    });
  });

  it('reports a refund as claimable rather than assuming it happened', () => {
    // refundOnTimeout() must be called; the money is still locked until it is.
    expect(toOutcome(foldTask([opened, locked]), AFTER)).toMatchObject({ verdict: null, pending: 'refundClaimable' });
  });

  it('refuses to guess when an arbitrator decided but the winner is unknown', () => {
    const s = foldTask([opened, locked, { kind: 'taskClosed', taskId: TASK, reason: 'adjudicated', rawReason: 2 }]);
    expect(toOutcome(s, AFTER)).toMatchObject({ verdict: null, pending: 'adjudicationWinnerUnknown' });
  });

  it('freezes on a dispute until an arbitrator speaks', () => {
    const s = foldTask([opened, locked, { kind: 'disputed', taskId: TASK, by: PROVIDER, source: 'ambiguous' }]);
    expect(toOutcome(s, AFTER)).toMatchObject({ verdict: null, pending: 'awaitingAdjudication' });
  });

  it('treats an adjudication for the client as cheating — the one case cover pays', () => {
    const s = foldTask([
      opened, locked,
      { kind: 'disputed', taskId: TASK, by: CLIENT, source: 'ambiguous' },
      { kind: 'adjudicated', taskId: TASK, winner: CLIENT, amount: 100n },
    ]);
    expect(toOutcome(s, AFTER)).toMatchObject({ verdict: 'cheated', basis: 'adjudicatedForClient' });
  });

  it('treats an adjudication for the provider as done right', () => {
    const s = foldTask([
      opened, locked,
      { kind: 'disputed', taskId: TASK, by: PROVIDER, source: 'ambiguous' },
      { kind: 'adjudicated', taskId: TASK, winner: PROVIDER, amount: 100n },
    ]);
    expect(toOutcome(s, AFTER)).toMatchObject({ verdict: 'doneRight', basis: 'adjudicatedForProvider' });
  });

  it('treats a bare rejection as rejected, never as cheating', () => {
    const s = foldTask([
      { kind: 'jobCreated', jobId: 1n, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR, expiredAt: DEADLINE, hook: ZERO_ADDRESS },
      { kind: 'jobRejected', jobId: 1n, evaluator: EVALUATOR, memoHash: `0x${'00'.repeat(32)}` },
    ]);
    const outcome = toOutcome(s, AFTER);
    expect(outcome.verdict).toBe('rejected');
    expect(outcome.verdict).not.toBe('cheated');
  });

  it('records a requester-driven release as weaker than an adjudicated verdict', () => {
    const s = foldTask([opened, locked, delivered, { kind: 'released', taskId: TASK, agent: PROVIDER, amount: 100n, deliverableHash: `0x${'cd'.repeat(32)}` }]);
    expect(toOutcome(s, BEFORE)).toMatchObject({ verdict: 'doneRight', basis: 'requesterReleased' });
  });
});

/**
 * The property that keeps the escrow fair: no party can strand another's money
 * by refusing to act.
 */
describe('no lockout', () => {
  const scenarios: [string, TaskState, ReturnType<typeof localClock>][] = [
    ['funded, work outstanding', foldTask([opened, locked]), BEFORE],
    ['delivered, awaiting grade', foldTask([opened, locked, delivered]), BEFORE],
    ['deadline passed, nobody acted', foldTask([opened, locked]), AFTER],
    ['dispute raised', foldTask([opened, locked, { kind: 'disputed', taskId: TASK, by: PROVIDER, source: 'ambiguous' }]), AFTER],
  ];

  it.each(scenarios)('leaves nobody stranded: %s', (_name, state, clock) => {
    const report = livenessOf(state, clock);
    expect(report.stranded).toEqual([]);
    expect(report.noLockout).toBe(true);
  });

  it('gives the client a way out when the provider goes silent', () => {
    // Past the deadline the refund is permissionless, so the client never needs
    // the provider's cooperation to get its money back.
    const r = recourseFor('client', foldTask([opened, locked]), AFTER);
    expect(r.guaranteedExit?.id).toBe('claimRefund');
    expect(r.guaranteedExit?.by).toBe('anyone');
  });

  it('gives the provider a way out when the client goes silent', () => {
    // release() is the client's alone, so a silent client could otherwise sit on
    // a delivered job forever. dispute() is the provider's escape.
    const r = recourseFor('provider', foldTask([opened, locked, delivered]), BEFORE);
    expect(r.mine.some((a) => a.id === 'dispute')).toBe(true);
  });

  it('lets anyone claim the refund, not just the parties', () => {
    const actions = recourseFor('doubter', foldTask([opened, locked]), AFTER);
    expect(actions.mine.some((a) => a.id === 'claimRefund')).toBe(true);
  });

  it('offers nothing further once the job has settled', () => {
    const s = foldTask([opened, locked, { kind: 'refunded', taskId: TASK, requester: CLIENT, amount: 100n }]);
    expect(recourseFor('client', s, AFTER).available).toEqual([]);
    expect(livenessOf(s, AFTER).noLockout).toBe(true);
  });
});

describe('who is holding things up', () => {
  it('names the provider before delivery', () => {
    expect(waitingOn(foldTask([opened, locked]), BEFORE)).toBe('provider');
  });

  it('names the evaluator after delivery', () => {
    expect(waitingOn(foldTask([opened, locked, delivered]), BEFORE)).toBe('evaluator');
  });

  it('names the arbitrator once disputed', () => {
    const s = foldTask([opened, locked, { kind: 'disputed', taskId: TASK, by: CLIENT, source: 'ambiguous' }]);
    expect(waitingOn(s, BEFORE)).toBe('arbitrator');
  });

  it('names nobody once settled', () => {
    const s = foldTask([opened, locked, { kind: 'refunded', taskId: TASK, requester: CLIENT, amount: 100n }]);
    expect(waitingOn(s, AFTER)).toBeNull();
  });
});

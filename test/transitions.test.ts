import { describe, expect, it } from 'vitest';
import {
  availableActions,
  foldTask,
  livenessOf,
  localClock,
  phaseOf,
  recourseFor,
  toOutcome,
  waitingOn,
} from '../src/index.js';
import type { AcpEvent } from '../src/index.js';

/**
 * Tests for the transition table.
 *
 * These exist because the previous suite tested the fold's order-insensitivity
 * only on events whose ranks strictly increased — the one case where the
 * property cannot fail. Every test here presents facts that conflict.
 */

const C = '0x1111111111111111111111111111111111111111' as const;
const P = '0x2222222222222222222222222222222222222222' as const;
const THIRD = '0x9999999999999999999999999999999999999999' as const;
const T = `0x${'ab'.repeat(32)}` as const;
const DEADLINE = 1_000;
const AFTER = localClock(2_000);
const BEFORE = localClock(500);

const locked: AcpEvent = { kind: 'locked', taskId: T, requester: C, agent: P, amount: 100n, deadline: DEADLINE };
const released: AcpEvent = { kind: 'released', taskId: T, agent: P, amount: 100n, deliverableHash: T };
const refunded: AcpEvent = { kind: 'refunded', taskId: T, requester: C, amount: 100n };
const disputed: AcpEvent = { kind: 'disputed', taskId: T, by: P, source: 'ambiguous' };
const adjClient: AcpEvent = { kind: 'adjudicated', taskId: T, winner: C, amount: 100n };
const adjThird: AcpEvent = { kind: 'adjudicated', taskId: T, winner: THIRD, amount: 100n };
const closedSettled: AcpEvent = { kind: 'taskClosed', taskId: T, reason: 'settled', rawReason: 0 };

describe('mutually exclusive terminals cannot both be believed', () => {
  /**
   * The defect this replaces: released and refunded shared a rank, and the
   * guard used a strict `<`, so whichever arrived last silently won — and the
   * two produce opposite verdicts and opposite ledgers.
   */
  it('records a contradiction instead of picking a winner', () => {
    const state = foldTask([locked, released, refunded]);
    expect(state.contradictions).toHaveLength(1);
    expect(state.contradictions[0]).toContain('released');
    expect(state.contradictions[0]).toContain('refunded');
  });

  it('reaches the same conclusion in either order', () => {
    const forward = toOutcome(foldTask([locked, released, refunded]), AFTER);
    const backward = toOutcome(foldTask([locked, refunded, released]), AFTER);
    expect(forward).toEqual(backward);
    expect(forward.verdict).toBeNull();
  });

  it('refuses to settle a contradictory job', () => {
    expect(toOutcome(foldTask([locked, released, refunded]), AFTER)).toMatchObject({
      verdict: null,
      pending: 'contradictory',
    });
  });

  it('treats an approval and a rejection as contradictory too', () => {
    const created: AcpEvent = {
      kind: 'jobCreated', jobId: 1n, client: C, provider: P, evaluator: THIRD, expiredAt: DEADLINE,
      hook: '0x0000000000000000000000000000000000000000',
    };
    const approved: AcpEvent = { kind: 'jobCompleted', jobId: 1n, evaluator: THIRD, memoHash: T };
    const rejected: AcpEvent = { kind: 'jobRejected', jobId: 1n, evaluator: THIRD, memoHash: T };

    const forward = foldTask([created, approved, rejected]);
    const backward = foldTask([created, rejected, approved]);
    expect(forward.contradictions.length).toBeGreaterThan(0);
    expect(toOutcome(forward, AFTER)).toEqual(toOutcome(backward, AFTER));
  });
});

describe('an adjudication cannot re-open a finished job', () => {
  /**
   * `cheated` forfeits the provider's deposit and draws on the pool, so a
   * replayed adjudication landing on an already-settled job was a live path to
   * charging a pool for a job that completed cleanly.
   */
  it('refuses when the escrow already released', () => {
    expect(toOutcome(foldTask([locked, released, adjClient]), AFTER).verdict).toBeNull();
  });

  it('refuses when the task closed as settled', () => {
    expect(toOutcome(foldTask([locked, closedSettled, adjClient]), AFTER)).toMatchObject({
      verdict: null,
      pending: 'contradictory',
    });
  });

  it('still honours an adjudication on a genuinely held escrow', () => {
    expect(toOutcome(foldTask([locked, disputed, adjClient]), AFTER)).toMatchObject({
      verdict: 'cheated',
      basis: 'adjudicatedForClient',
    });
  });
});

describe('a dispute is its own fact, not an escrow status', () => {
  it('folds the same either side of the lock', () => {
    const a = foldTask([disputed, locked]);
    const b = foldTask([locked, disputed]);
    expect(a).toEqual(b);
    expect(a.escrow).toBe('locked');
    expect(a.disputed).toBe(true);
  });

  /** Previously a job could be settled and waiting on an arbitrator at once. */
  it('never leaves a settled job waiting on an arbitrator', () => {
    const state = foldTask([locked, released, disputed]);
    const outcome = toOutcome(state, AFTER);
    if (outcome.verdict !== null) {
      expect(waitingOn(state, AFTER)).toBeNull();
    }
  });
});

describe('liveness can actually fail', () => {
  /**
   * The check used to be unfalsifiable: `wait` is `by: 'anyone'`, so every role
   * always had it in `mine`, and "this party has nothing it can do" could never
   * be true. It certified noLockout for genuinely frozen funds.
   */
  it('reports stranded parties on an irrecoverable job', () => {
    const report = livenessOf(foldTask([locked, released, refunded]), AFTER);
    expect(report.noLockout).toBe(false);
    expect(report.stranded).toEqual(['client', 'provider']);
  });

  it('does not count waiting as recourse', () => {
    // `wait` is still reported — it is the honest answer to "what can I do" —
    // but it no longer masks the fact that the party has no way to act.
    const state = foldTask([locked, released, refunded]);
    const mine = recourseFor('client', state, AFTER).mine;
    expect(mine.map((a) => a.id)).toEqual(['wait']);
    expect(mine.some((a) => a.id !== 'wait')).toBe(false);
    expect(livenessOf(state, AFTER).stranded).toContain('client');
  });

  it('still passes a healthy job', () => {
    const report = livenessOf(foldTask([locked]), BEFORE);
    expect(report.noLockout).toBe(true);
    expect(report.stranded).toEqual([]);
  });
});

describe('states that used to fall through now name a resolver', () => {
  it('offers arbitration when the recorded winner is neither party', () => {
    const state = foldTask([locked, adjThird]);
    expect(toOutcome(state, AFTER)).toMatchObject({ pending: 'adjudicationWinnerUnknown' });
    expect(availableActions(state, AFTER).map((a) => a.id)).toEqual(['adjudicate']);
  });

  it('offers arbitration on a close reason it cannot interpret', () => {
    const state = foldTask([
      locked,
      { kind: 'taskClosed', taskId: T, reason: 'unknown', rawReason: 9 },
    ]);
    expect(availableActions(state, AFTER).map((a) => a.id)).toEqual(['adjudicate']);
  });
});

describe('phaseOf is the single answer', () => {
  it.each([
    [[], 'notStarted'],
    [[locked], 'awaitingDelivery'],
    [[locked, disputed], 'awaitingAdjudication'],
    [[locked, released], 'settled'],
    [[locked, released, refunded], 'contradictory'],
  ] as const)('classifies %#', (events, expected) => {
    expect(phaseOf(foldTask([...events]), BEFORE)).toBe(expected);
  });

  it('turns a passed deadline into a claimable refund', () => {
    expect(phaseOf(foldTask([locked]), AFTER)).toBe('refundClaimable');
  });

  /** blockedOn used to take available[0], naming a party by source-line order. */
  it('never tells an uninvolved role it is blocked on a party', () => {
    const state = foldTask([locked, { kind: 'deliverablePosted', taskId: T, deliverableHash: T }]);
    expect(recourseFor('doubter', state, BEFORE).blockedOn).toBe('evaluator');
    expect(waitingOn(state, BEFORE)).toBe('evaluator');
  });
});

/**
 * The no-lockout proof must cover everyone with capital in the job.
 *
 * `livenessOf` used to iterate a literal `['client', 'provider']`, so the
 * headline safety claim never looked at the evaluator — which posts a bond
 * behind its verdict. `noLockout: true` therefore meant "neither of two parties
 * is stranded" while reading as "nobody is". `checked` now names the covered
 * set so the claim cannot be read as broader than it is.
 */
describe('liveness covers every exposed party', () => {
  const funded: AcpEvent = { kind: 'jobFunded', jobId: 7n, payer: C, amount: 100n };
  const submitted: AcpEvent = { kind: 'jobSubmitted', jobId: 7n, provider: P, memoHash: T };
  const graded = (approved: boolean): AcpEvent =>
    ({ kind: 'evaluated', jobId: 7n, approved, proofChainId: 8453, proofBlockNumber: 1, eventHash: T });

  it('does not report on an evaluator that has put up nothing', () => {
    const report = livenessOf(foldTask([funded, submitted]), BEFORE);
    expect(report.checked).toEqual(['client', 'provider']);
  });

  /**
   * A single grade settles the job, so nobody is checked and nobody can be
   * stranded — an ended job holds no one hostage. Asserted explicitly because
   * an empty `checked` here is correct, whereas an empty `checked` on an open
   * job would be the bug this suite exists to catch.
   */
  it('checks nobody once a grade has settled the job', () => {
    const state = foldTask([funded, submitted, graded(true)]);
    expect(state.work).toBe('graded');
    const report = livenessOf(state, BEFORE);
    expect(report.noLockout).toBe(true);
    expect(report.checked).toEqual([]);
    expect(report.notes.join(' ')).toContain('settled');
  });

  /**
   * The concrete state the old two-party check could not see: two contradictory
   * grades leave the evaluator's bond behind a verdict the job can never
   * resolve. This reported `noLockout: true` before the check was widened.
   */
  it('catches an evaluator stranded by a job that contradicts itself', () => {
    const state = foldTask([funded, submitted, graded(true), graded(false)]);
    expect(state.contradictions.length).toBeGreaterThan(0);
    const report = livenessOf(state, BEFORE);
    expect(report.checked).toContain('evaluator');
    expect(report.stranded).toContain('evaluator');
    expect(report.noLockout).toBe(false);
  });

  it('never claims no-lockout without saying who it checked', () => {
    const report = livenessOf(foldTask([funded, submitted]), BEFORE);
    expect(report.noLockout).toBe(true);
    expect(report.checked.length).toBeGreaterThan(0);
  });
});

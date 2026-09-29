import { describe, expect, it } from 'vitest';
import {
  availableActions,
  chainClock,
  attestedClock,
  expiryOf,
  foldTask,
  groupByJob,
  isFresh,
  isParty,
  isSettled,
  livenessOf,
  localClock,
  recourseFor,
  toOutcome,
  ZERO_ADDRESS,
} from '../src/index.js';
import type { AcpEvent } from '../src/index.js';

const CLIENT = '0x1111111111111111111111111111111111111111' as const;
const PROVIDER = '0x2222222222222222222222222222222222222222' as const;
const EVALUATOR = '0x3333333333333333333333333333333333333333' as const;
const MEMO = `0x${'cd'.repeat(32)}` as const;
const DEADLINE = 1_800_000_000;
const NOW = localClock(DEADLINE - 100);
const LATE = localClock(DEADLINE + 100);

const created: AcpEvent = {
  kind: 'jobCreated', jobId: 70122n, client: CLIENT, provider: PROVIDER,
  evaluator: EVALUATOR, expiredAt: DEADLINE, hook: ZERO_ADDRESS,
};
const funded: AcpEvent = { kind: 'jobFunded', jobId: 70122n, payer: CLIENT, amount: 1_000_000n };
const submitted: AcpEvent = { kind: 'jobSubmitted', jobId: 70122n, provider: PROVIDER, memoHash: MEMO };

describe('a Virtuals-shaped job, end to end', () => {
  it('walks from creation to an approved completion', () => {
    const state = foldTask([
      created, funded, submitted,
      { kind: 'jobCompleted', jobId: 70122n, evaluator: EVALUATOR, memoHash: MEMO },
      { kind: 'evaluatorFeePaid', jobId: 70122n, evaluator: EVALUATOR, amount: 10_000n },
    ]);
    expect(state.id).toBe('70122');
    expect(state.work).toBe('graded');
    expect(state.approved).toBe(true);
    expect(state.evaluatorFeePaid).toBe(10_000n);

    const outcome = toOutcome(state, NOW);
    expect(isSettled(outcome)).toBe(true);
    expect(outcome).toMatchObject({ verdict: 'doneRight' });
  });

  it('settles an expiry as nobody delivered', () => {
    const state = foldTask([created, funded, { kind: 'jobExpired', jobId: 70122n }]);
    expect(toOutcome(state, LATE)).toMatchObject({ verdict: 'notDelivered', basis: 'expired' });
  });

  it('waits for a grade while a deliverable sits unjudged', () => {
    const state = foldTask([created, funded, submitted]);
    expect(toOutcome(state, NOW)).toMatchObject({ verdict: null, pending: 'awaitingGrading' });
  });

  it('reports nothing started before funding', () => {
    expect(toOutcome(foldTask([]), NOW)).toMatchObject({ verdict: null, pending: 'notStarted' });
  });

  it('treats a proof-verified approval as the strongest grading signal', () => {
    const state = foldTask([
      created, funded, submitted,
      { kind: 'evaluated', jobId: 70122n, approved: true, proofChainId: 8453, proofBlockNumber: 1, eventHash: MEMO },
    ]);
    expect(state.verification).toBe('independent');
    expect(toOutcome(state, NOW)).toMatchObject({ verdict: 'doneRight', basis: 'proofVerifiedApproval' });
  });

  it('treats a proof-verified rejection as rejected, not cheating', () => {
    const state = foldTask([
      created, funded, submitted,
      { kind: 'evaluated', jobId: 70122n, approved: false, proofChainId: 8453, proofBlockNumber: 1, eventHash: MEMO },
    ]);
    expect(toOutcome(state, NOW)).toMatchObject({ verdict: 'rejected', basis: 'proofVerifiedRejection' });
  });
});

describe('actions available at each stage', () => {
  it('asks the client to fund an unfunded job', () => {
    const actions = availableActions(foldTask([created]), NOW);
    expect(actions.map((a) => a.id)).toContain('fund');
  });

  it('offers grading and release once work is delivered', () => {
    const ids = availableActions(foldTask([created, funded, submitted]), NOW).map((a) => a.id);
    expect(ids).toContain('grade');
    expect(ids).toContain('release');
  });

  it('offers nothing once the job is settled', () => {
    const settled = foldTask([created, funded, { kind: 'jobExpired', jobId: 70122n }]);
    expect(availableActions(settled, LATE)).toEqual([]);
  });

  it('leaves only adjudication once a dispute is open', () => {
    const disputed = foldTask([
      created, funded,
      { kind: 'disputed', taskId: `0x${'ab'.repeat(32)}`, by: PROVIDER, source: 'ambiguous' },
    ]);
    const ids = availableActions(disputed, LATE).map((a) => a.id);
    expect(ids).toEqual(['adjudicate']);
  });

  it('tells a bystander they are blocked on someone else', () => {
    const r = recourseFor('evaluator', foldTask([created]), NOW);
    expect(r.mine).toEqual([]);
    expect(r.blockedOn).toBe('client');
  });

  it('keeps the no-lockout guarantee through a Virtuals-shaped flow', () => {
    for (const state of [foldTask([created]), foldTask([created, funded]), foldTask([created, funded, submitted])]) {
      expect(livenessOf(state, NOW).stranded).toEqual([]);
    }
  });
});

describe('parties', () => {
  it('recognises each participant and rejects a stranger', () => {
    const state = foldTask([created]);
    expect(isParty(state, CLIENT)).toBe(true);
    expect(isParty(state, PROVIDER)).toBe(true);
    expect(isParty(state, EVALUATOR)).toBe(true);
    expect(isParty(state, '0x9999999999999999999999999999999999999999')).toBe(false);
  });
});

describe('clocks', () => {
  it('reports remaining time and elapsed time', () => {
    expect(expiryOf(DEADLINE, NOW)).toMatchObject({ state: 'live', secondsRemaining: 100 });
    expect(expiryOf(DEADLINE, LATE)).toMatchObject({ state: 'expired', secondsSince: 100 });
  });

  it('says nothing about expiry when there is no deadline', () => {
    expect(expiryOf(undefined, NOW)).toMatchObject({ state: 'unknown' });
  });

  it('carries its provenance', () => {
    expect(localClock(1).source).toBe('local');
    expect(chainClock(1).source).toBe('chain');
    const attested = attestedClock({
      chainId: 8453, finalizedBlock: 1, timestamp: 500,
      digest: '0x00', signature: '0x00', signer: '0x00',
    });
    expect(attested.source).toBe('attested');
    expect(attested.attestation?.chainId).toBe(8453);
  });

  it('knows when it has gone stale', () => {
    expect(isFresh(localClock(100), 150, 60)).toBe(true);
    expect(isFresh(localClock(100), 200, 60)).toBe(false);
  });
});

describe('grouping', () => {
  it('separates two jobs in one stream', () => {
    const other: AcpEvent = { ...created, jobId: 8n };
    const groups = groupByJob([created, funded, other]);
    expect(groups.size).toBe(2);
    expect(groups.get('70122')).toHaveLength(2);
  });
});

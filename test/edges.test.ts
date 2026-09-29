import { describe, expect, it } from 'vitest';
import {
  ACP_TOPIC0,
  bestCase,
  breakEvenFailureRate,
  canAccept,
  challengeQuote,
  decodeAcpLog,
  doubtQuote,
  foldTask,
  formatUnits,
  livenessOf,
  localClock,
  parseUnits,
  poolExposure,
  positionUnder,
  recourseFor,
  runSeason,
  sameAddress,
  settle,
  toOutcome,
  worstCase,
  worthChallenging,
} from '../src/index.js';
import type { AcpEvent, JobTerms } from '../src/index.js';

const usdc = (v: string) => parseUnits(v);
const pad = (h: string) => h.replace(/^0x/, '').padStart(64, '0');
const TASK = `0x${'ab'.repeat(32)}` as `0x${string}`;
const CLIENT = '0x1111111111111111111111111111111111111111' as const;
const PROVIDER = '0x2222222222222222222222222222222222222222' as const;

const TERMS: JobTerms = {
  pay: usdc('100'), premium: usdc('1'), deposit: usdc('40'),
  evaluatorBond: usdc('25'), poolCapital: usdc('5000'), damage: usdc('70'),
};

describe('money edges', () => {
  it('handles negative amounts symmetrically', () => {
    expect(parseUnits('-1.5')).toBe(-1_500_000n);
    expect(formatUnits(-1_500_000n)).toBe('-1.5');
  });

  it('rejects a value that is not a decimal number', () => {
    expect(() => parseUnits('abc')).toThrow(RangeError);
    expect(() => parseUnits('')).toThrow(RangeError);
  });

  it('rejects a negative basis-point rate', () => {
    const bad = () => doubtQuote(TERMS, usdc('10'), -1);
    expect(bad).toThrow(RangeError);
  });

  it('compares addresses case-insensitively and rejects missing ones', () => {
    expect(sameAddress(CLIENT, CLIENT.toUpperCase())).toBe(true);
    expect(sameAddress(undefined, CLIENT)).toBe(false);
    expect(sameAddress(CLIENT, undefined)).toBe(false);
  });
});

describe('pool edges', () => {
  it('rejects a negative or fractional job count', () => {
    expect(() => runSeason({
      jobs: -1, premiumPerJob: usdc('1'), failureRate: 0.1,
      damagePerFailure: usdc('70'), depositPerJob: usdc('40'),
    })).toThrow(RangeError);
  });

  it('reports no break-even when the pool cannot lose', () => {
    expect(breakEvenFailureRate(usdc('1'), usdc('10'), usdc('40'))).toBeNull();
  });

  it('commits nothing for a nonsensical concurrent-job count', () => {
    expect(poolExposure(TERMS, -5, usdc('100')).committed).toBe(0n);
  });

  it('reports zero utilisation against no capital', () => {
    expect(poolExposure(TERMS, 1, 0n).utilisation).toBe(0);
  });
});

describe('actor edges', () => {
  it('accepts a job needing no deposit', () => {
    expect(canAccept({ ...TERMS, deposit: 0n }, 0n).ok).toBe(true);
  });

  it('bounds best and worst case for every role', () => {
    for (const role of ['client', 'provider', 'pool', 'evaluator'] as const) {
      expect(worstCase(role, TERMS)).toBeLessThanOrEqual(bestCase(role, TERMS));
    }
  });

  it('treats a zero-payout doubt position as certain to lose', () => {
    const zeroCap: JobTerms = { ...TERMS, deposit: 0n, poolCapital: 0n };
    expect(doubtQuote(zeroCap, usdc('10'), 34).breakEvenProbability).toBe(1);
  });

  it('treats a costless, payless challenge as never worth taking', () => {
    const nothingAtStake: JobTerms = { ...TERMS, evaluatorBond: 0n };
    expect(challengeQuote(nothingAtStake, 0n).breakEvenProbability).toBe(1);
    expect(worthChallenging(nothingAtStake, 0n, 0.99)).toBe(false);
  });

  it('gives the evaluator no position on an ordinary job', () => {
    expect(positionUnder('evaluator', TERMS, 'doneRight')).toBe(0n);
  });
});

describe('settlement edges', () => {
  it('ignores a doubt position of zero', () => {
    const { ledger } = settle({ terms: TERMS, verdict: 'cheated', doubt: { notional: 0n, feeBps: 34 } });
    expect(ledger.doubter).toBe(0n);
  });

  it('ignores a challenge with nothing exposed on either side', () => {
    const terms: JobTerms = { ...TERMS, evaluatorBond: 0n };
    const { ledger } = settle({ terms, verdict: 'doneRight', challenge: { bond: 0n, upheld: true } });
    expect(ledger.challenger).toBe(0n);
    expect(ledger.evaluator).toBe(0n);
  });
});

describe('decoder edges', () => {
  it('decodes the remaining Virtuals events', () => {
    const funded = decodeAcpLog({
      topics: [ACP_TOPIC0.jobFunded, `0x${pad('1')}`, `0x${pad(CLIENT)}`],
      data: `0x${pad('64')}`,
    });
    expect(funded).toMatchObject({ kind: 'jobFunded', amount: 100n });

    const submitted = decodeAcpLog({
      topics: [ACP_TOPIC0.jobSubmitted, `0x${pad('1')}`, `0x${pad(PROVIDER)}`],
      data: `0x${pad('0')}`,
    });
    expect(submitted).toMatchObject({ kind: 'jobSubmitted' });

    const fee = decodeAcpLog({
      topics: [ACP_TOPIC0.evaluatorFeePaid, `0x${pad('1')}`, `0x${pad(CLIENT)}`],
      data: `0x${pad('a')}`,
    });
    expect(fee).toMatchObject({ kind: 'evaluatorFeePaid', amount: 10n });
  });

  it('decodes the remaining Moonbeam events', () => {
    expect(decodeAcpLog({
      topics: [ACP_TOPIC0.taskOpened, TASK, `0x${pad(CLIENT)}`, `0x${pad(PROVIDER)}`],
      data: `0x${pad('1')}`,
    })).toMatchObject({ kind: 'taskOpened', openedAt: 1 });

    expect(decodeAcpLog({
      topics: [ACP_TOPIC0.deliverablePosted, TASK],
      data: `0x${pad('cd')}`,
    })).toMatchObject({ kind: 'deliverablePosted' });

    expect(decodeAcpLog({
      topics: [ACP_TOPIC0.released, TASK, `0x${pad(PROVIDER)}`],
      data: `0x${pad('64')}${pad('cd')}`,
    })).toMatchObject({ kind: 'released', amount: 100n });

    expect(decodeAcpLog({
      topics: [ACP_TOPIC0.evaluated, `0x${pad('1')}`],
      data: `0x${pad('1')}${pad('2105')}${pad('a')}${pad('cd')}`,
    })).toMatchObject({ kind: 'evaluated', approved: true, proofChainId: 8453 });
  });
});

describe('outcome and recourse edges', () => {
  it('cannot name a winner who is neither party', () => {
    const state = foldTask([
      { kind: 'locked', taskId: TASK, requester: CLIENT, agent: PROVIDER, amount: 100n, deadline: 10 },
      { kind: 'adjudicated', taskId: TASK, winner: '0x9999999999999999999999999999999999999999', amount: 100n },
    ]);
    expect(toOutcome(state, localClock(20))).toMatchObject({
      verdict: null, pending: 'adjudicationWinnerUnknown',
    });
  });

  it('refuses to settle on a close reason it does not recognise', () => {
    const state = foldTask([
      { kind: 'locked', taskId: TASK, requester: CLIENT, agent: PROVIDER, amount: 100n, deadline: 10 },
      { kind: 'taskClosed', taskId: TASK, reason: 'unknown', rawReason: 9 },
    ]);
    expect(toOutcome(state, localClock(20))).toMatchObject({
      verdict: null, pending: 'unrecognisedCloseReason',
    });
  });

  it('settles a task closed as settled', () => {
    const state = foldTask([
      { kind: 'locked', taskId: TASK, requester: CLIENT, agent: PROVIDER, amount: 100n, deadline: 10 },
      { kind: 'taskClosed', taskId: TASK, reason: 'settled', rawReason: 0 },
    ]);
    expect(toOutcome(state, localClock(20))).toMatchObject({ verdict: 'doneRight', basis: 'closedSettled' });
  });

  it('settles a task closed on timeout', () => {
    const state = foldTask([
      { kind: 'locked', taskId: TASK, requester: CLIENT, agent: PROVIDER, amount: 100n, deadline: 10 },
      { kind: 'taskClosed', taskId: TASK, reason: 'timeout', rawReason: 1 },
    ]);
    expect(toOutcome(state, localClock(20))).toMatchObject({ verdict: 'notDelivered', basis: 'closedTimeout' });
  });

  it('says nothing is escrowed yet when a job has not started', () => {
    const report = livenessOf(foldTask([]), localClock(1));
    expect(report.noLockout).toBe(true);
    expect(report.notes.join(' ')).toContain('nothing is escrowed');
  });

  it('notes an open dispute in its liveness report', () => {
    const state = foldTask([
      { kind: 'locked', taskId: TASK, requester: CLIENT, agent: PROVIDER, amount: 100n, deadline: 10 },
      { kind: 'disputed', taskId: TASK, by: CLIENT, source: 'ambiguous' } as AcpEvent,
    ]);
    expect(livenessOf(state, localClock(20)).notes.join(' ')).toContain('dispute raised');
  });

  it('gives an uninvolved role nothing to do on a live job', () => {
    const state = foldTask([
      { kind: 'locked', taskId: TASK, requester: CLIENT, agent: PROVIDER, amount: 100n, deadline: 100 },
    ]);
    expect(recourseFor('challenger', state, localClock(1)).mine).toEqual([]);
  });
});

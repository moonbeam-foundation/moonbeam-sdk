import { describe, expect, it } from 'vitest';
import {
  concentrationOf,
  DOMINANCE_THRESHOLD,
  foldTask,
  localClock,
  MIN_JOBS_FOR_A_RECORD,
  parseUnits,
  readinessForBacker,
  trackRecordFor,
  trackRecords,
} from '../src/index.js';
import type { AcpEvent, Address, JobTerms, TaskState } from '../src/index.js';

/**
 * Per-worker records exist because the market average is misleading.
 *
 * On live traffic one provider produced most of the jobs and failed nearly all
 * of them, while everyone else failed around a tenth. An aggregate over that
 * describes neither group.
 */

const CLIENT = '0x1111111111111111111111111111111111111111' as Address;
const GOOD = '0x2222222222222222222222222222222222222222' as Address;
const BAD = '0x3333333333333333333333333333333333333333' as Address;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as Address;

const DEADLINE = 1_000;
const NOW = localClock(5_000);

/** One matured job with a chosen ending. */
function job(id: bigint, provider: Address, ending: 'delivered' | 'expired' | 'rejected'): TaskState {
  const events: AcpEvent[] = [
    { kind: 'jobCreated', jobId: id, client: CLIENT, provider, evaluator: CLIENT, expiredAt: DEADLINE, hook: ZERO_ADDR },
    { kind: 'jobFunded', jobId: id, payer: CLIENT, amount: 1_000n },
  ];
  if (ending === 'delivered') events.push({ kind: 'jobCompleted', jobId: id, evaluator: CLIENT, memoHash: `0x${'cd'.repeat(32)}` });
  if (ending === 'rejected') events.push({ kind: 'jobRejected', jobId: id, evaluator: CLIENT, memoHash: `0x${'cd'.repeat(32)}` });
  if (ending === 'expired') events.push({ kind: 'jobExpired', jobId: id });
  return foldTask(events);
}

function many(provider: Address, ending: 'delivered' | 'expired' | 'rejected', count: number, offset = 0): TaskState[] {
  return Array.from({ length: count }, (_, i) => job(BigInt(offset + i), provider, ending));
}

describe('a single worker record', () => {
  it('counts each ending separately', () => {
    const history = [...many(GOOD, 'delivered', 18), ...many(GOOD, 'expired', 1, 100), ...many(GOOD, 'rejected', 1, 200)];
    const record = trackRecordFor(GOOD, history, NOW);
    expect(record.matured).toBe(20);
    expect(record.delivered).toBe(18);
    expect(record.expired).toBe(1);
    expect(record.rejected).toBe(1);
    expect(record.nonDeliveryRate).toBeCloseTo(0.05);
  });

  it('ignores other workers entirely', () => {
    const history = [...many(GOOD, 'delivered', 5), ...many(BAD, 'expired', 50, 500)];
    expect(trackRecordFor(GOOD, history, NOW).matured).toBe(5);
  });

  it('ignores jobs still inside their deadline', () => {
    // Not yet failed at anything — counting it would measure our impatience.
    const early = localClock(DEADLINE - 100);
    expect(trackRecordFor(GOOD, many(GOOD, 'delivered', 5), early).matured).toBe(0);
  });

  /**
   * The protection a newcomer most needs: a clean but tiny record must not
   * read as proven reliability.
   */
  it('marks a thin record as insufficient', () => {
    const record = trackRecordFor(GOOD, many(GOOD, 'delivered', 3), NOW);
    expect(record.nonDeliveryRate).toBe(0);
    expect(record.sufficient).toBe(false);
    // A point estimate says 0% failure; the interval says we cannot tell.
    expect(record.nonDeliveryInterval[1]).toBeGreaterThan(0.5);
  });

  it('narrows the interval as the record grows', () => {
    const thin = trackRecordFor(GOOD, many(GOOD, 'delivered', 3), NOW);
    const thick = trackRecordFor(GOOD, many(GOOD, 'delivered', 200), NOW);
    const width = (r: typeof thin) => r.nonDeliveryInterval[1] - r.nonDeliveryInterval[0];
    expect(width(thick)).toBeLessThan(width(thin));
    expect(thick.sufficient).toBe(true);
  });

  it('keeps the interval inside 0 and 1 even at the extremes', () => {
    // The normal approximation gives impossible bounds exactly here.
    const record = trackRecordFor(BAD, many(BAD, 'expired', 25), NOW);
    expect(record.nonDeliveryInterval[0]).toBeGreaterThanOrEqual(0);
    expect(record.nonDeliveryInterval[1]).toBeLessThanOrEqual(1);
  });
});

describe('ranking workers', () => {
  it('puts the worst record first', () => {
    const history = [...many(GOOD, 'delivered', 30), ...many(BAD, 'expired', 30, 500)];
    const ranked = trackRecords(history, NOW);
    expect(ranked[0]?.provider).toBe(BAD);
    expect(ranked[0]?.nonDeliveryRate).toBe(1);
  });
});

/**
 * Concentration is what makes an average lie. This mirrors the live shape:
 * one worker producing most jobs and failing nearly all of them.
 */
describe('detecting when an average is really one worker', () => {
  it('flags a dominated history', () => {
    const history = [...many(BAD, 'expired', 90), ...many(GOOD, 'delivered', 10, 500)];
    const report = concentrationOf(history, NOW);
    expect(report.dominated).toBe(true);
    expect(report.topShare).toBeGreaterThan(DOMINANCE_THRESHOLD);
    expect(report.topProvider).toBe(BAD);
  });

  it('does not flag a balanced one', () => {
    const history = [...many(GOOD, 'delivered', 30), ...many(BAD, 'expired', 30, 500)];
    expect(concentrationOf(history, NOW).dominated).toBe(false);
  });

  it('reports nothing on an empty history', () => {
    const report = concentrationOf([], NOW);
    expect(report.jobs).toBe(0);
    expect(report.dominated).toBe(false);
  });
});

describe('a backer checking the workers behind a pool', () => {
  const terms: JobTerms = {
    pay: parseUnits('1'),
    premium: parseUnits('0.01'),
    deposit: parseUnits('0.4'),
    evaluatorBond: parseUnits('0.25'),
    poolCapital: parseUnits('50'),
    damage: parseUnits('0.7'),
  };
  const base = { terms, backing: parseUnits('1'), poolCapital: parseUnits('50'), openJobs: 5 };

  it('blocks a pool backing a worker that mostly fails', () => {
    const workers = [trackRecordFor(BAD, many(BAD, 'expired', 40), NOW)];
    const readiness = readinessForBacker({ ...base, workers });
    expect(readiness.safe).toBe(false);
    expect(readiness.findings.some((f) => f.message.includes('failed to deliver'))).toBe(true);
  });

  it('does not let a good worker launder a bad one', () => {
    // Pooling does not dilute a worker that fails almost every job.
    const workers = [
      trackRecordFor(GOOD, many(GOOD, 'delivered', 40), NOW),
      trackRecordFor(BAD, many(BAD, 'expired', 40, 500), NOW),
    ];
    expect(readinessForBacker({ ...base, workers }).safe).toBe(false);
  });

  it('clears a pool of demonstrated workers', () => {
    const workers = [trackRecordFor(GOOD, [...many(GOOD, 'delivered', 38), ...many(GOOD, 'expired', 2, 100)], NOW)];
    const readiness = readinessForBacker({ ...base, workers });
    expect(readiness.safe).toBe(true);
  });

  it('warns when the records are too thin to mean anything', () => {
    const workers = [trackRecordFor(GOOD, many(GOOD, 'delivered', 3), NOW)];
    const readiness = readinessForBacker({ ...base, workers });
    expect(readiness.findings.some((f) => f.message.includes(`fewer than ${MIN_JOBS_FOR_A_RECORD}`))).toBe(true);
  });

  it('says so when no records were supplied at all', () => {
    const readiness = readinessForBacker(base);
    expect(readiness.findings.some((f) => f.message.includes('no worker records supplied'))).toBe(true);
  });
});

/**
 * Whether a record predicts is the question that decides if any of this is
 * worth computing. Validated against live traffic by splitting history in
 * half, building records on the earlier part and scoring them on the later:
 * all three workers with a sufficient record stayed inside their own 95%
 * interval (99.7%→98.6%, 7.0%→1.4%, 4.2%→1.3%).
 *
 * These tests hold the properties that made that possible.
 */
describe('a record is only as good as its predictive value', () => {
  it('keeps the interval wide enough to survive normal drift', () => {
    // The two reliable workers moved several points between halves. An
    // interval too tight to contain that would flag ordinary variation as a
    // behaviour change and be useless in practice.
    const record = trackRecordFor(GOOD, [...many(GOOD, 'delivered', 53), ...many(GOOD, 'expired', 4, 900)], NOW);
    const [low, high] = record.nonDeliveryInterval;
    expect(high - low).toBeGreaterThan(0.05);
    expect(low).toBeLessThan(record.nonDeliveryRate);
    expect(high).toBeGreaterThan(record.nonDeliveryRate);
  });

  it('separates the two populations without their intervals touching', () => {
    // What makes the record actionable: a bad worker's interval must not
    // overlap a good one's, or the record cannot tell them apart.
    const bad = trackRecordFor(BAD, [...many(BAD, 'expired', 97), ...many(BAD, 'delivered', 3, 700)], NOW);
    const good = trackRecordFor(GOOD, [...many(GOOD, 'delivered', 96), ...many(GOOD, 'expired', 4, 800)], NOW);
    expect(bad.nonDeliveryInterval[0]).toBeGreaterThan(good.nonDeliveryInterval[1]);
  });

  it('refuses to distinguish workers on samples too thin to support it', () => {
    // Three jobs each: the intervals overlap almost entirely, and neither is
    // marked sufficient. Claiming a difference here would be noise.
    const bad = trackRecordFor(BAD, many(BAD, 'expired', 3), NOW);
    const good = trackRecordFor(GOOD, many(GOOD, 'delivered', 3), NOW);
    expect(bad.sufficient).toBe(false);
    expect(good.sufficient).toBe(false);
    expect(bad.nonDeliveryInterval[0]).toBeLessThan(good.nonDeliveryInterval[1]);
  });
});

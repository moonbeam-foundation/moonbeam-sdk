import { describe, expect, it } from 'vitest';
import {
  acpAdapter,
  breakEvenFailureRate,
  runSeason,
  conservesValue,
  decodeAcpLog,
  decodeAcpLogs,
  DEFAULT_ACP_POLICY,
  foldTask,
  formatUnits,
  independentShare,
  localClock,
  parseUnits,
  positionUnder,
  settle,
  toOutcome,
} from '../src/index.js';
import type { JobTerms, RawLog, Verdict } from '../src/index.js';
import fixture from './fixtures/base-job.json' with { type: 'json' };

/**
 * A real agent job, decoded from Base mainnet.
 *
 * These logs were captured from the live agent-commerce ledger and checked in,
 * so the suite exercises real chain data without touching the network. Every
 * synthetic fixture reflects what its author expected the chain to look like;
 * this one does not.
 */

const logs = fixture as RawLog[];
const NOW = localClock(Math.floor(Date.UTC(2026, 7, 25) / 1000));

describe('a real job from Base mainnet', () => {
  it('decodes every log without a gap', () => {
    // A decoder that silently skips events looks identical to a quiet chain.
    const decoded = decodeAcpLogs(logs);
    expect(decoded).toHaveLength(logs.length);
    expect(logs.every((log) => decodeAcpLog(log) !== null)).toBe(true);
  });

  it('walks the full lifecycle', () => {
    const kinds = decodeAcpLogs(logs).map((e) => e.kind);
    expect(kinds).toContain('jobCreated');
    expect(kinds).toContain('jobFunded');
    expect(kinds).toContain('jobSubmitted');
    expect(kinds).toContain('jobCompleted');
  });

  it('folds into a settled, coherent job', () => {
    const state = foldTask(decodeAcpLogs(logs));
    expect(state.contradictions).toEqual([]);
    expect(state.id).toBeTruthy();
    expect(toOutcome(state, NOW).verdict).toBe('doneRight');
  });

  it('folds the same however the logs are ordered', () => {
    // Real logs, reversed — the case the previous suite never tried.
    const forward = foldTask(decodeAcpLogs(logs));
    const backward = foldTask(decodeAcpLogs([...logs].reverse()));
    expect(forward).toEqual(backward);
  });

  /**
   * The measurement the assurance case rests on, taken from live traffic
   * rather than asserted: this job was graded by the party that paid for it.
   */
  it('was graded by the payer, not an independent judge', () => {
    const state = foldTask(decodeAcpLogs(logs));
    expect(state.verification).toBe('self');
    expect(independentShare([state])).toBe(0);
  });
});

describe('insuring a real job', () => {
  const state = foldTask(decodeAcpLogs(logs));
  const insurableJob = (priceUsdc: bigint) => ({
    id: state.id,
    priceUsdc,
    phase: 'transaction' as const,
    proofOfAgreement: `0x${'11'.repeat(32)}`,
    slaDeadline: state.deadline!,
  });

  /**
   * Much live agent traffic is zero-value — agents exercising the rails rather
   * than buying anything. There is no cover to sell on a job worth nothing, and
   * a premium of zero would mean carrying damage exposure for no income.
   */
  it('declines the zero-value jobs that dominate live traffic', () => {
    expect(state.amount).toBe(0n);
    expect(acpAdapter.toTerms(insurableJob(state.amount!), DEFAULT_ACP_POLICY)).toBeNull();
  });

  it('prices cover once a job carries real value', () => {
    const terms = acpAdapter.toTerms(insurableJob(parseUnits('0.01')), DEFAULT_ACP_POLICY);
    expect(terms).not.toBeNull();
    expect(terms!.pay).toBe(parseUnits('0.01'));
    expect(terms!.premium).toBeGreaterThan(0n);
  });

  it('conserves value on real numbers, in every branch', () => {
    const terms = acpAdapter.toTerms(insurableJob(parseUnits('0.01')), DEFAULT_ACP_POLICY)!;
    const verdicts: Verdict[] = ['doneRight', 'notDelivered', 'rejected', 'cheated'];
    for (const verdict of verdicts) {
      expect(conservesValue(settle({ terms, verdict }).ledger), verdict).toBe(true);
    }
    // The client ends ahead only on an adjudicated finding.
    expect(positionUnder('client', terms, 'cheated')).toBeGreaterThan(0n);
    expect(positionUnder('client', terms, 'rejected')).toBe(0n);
  });
});

/**
 * Live agent jobs are far smaller than the worked examples — cents, not
 * hundreds — and at that scale the premium can round away to nothing.
 */
describe('jobs too small to insure', () => {
  const jobAt = (price: string) => ({
    id: 'dust',
    priceUsdc: parseUnits(price),
    phase: 'transaction' as const,
    proofOfAgreement: `0x${'11'.repeat(32)}`,
    slaDeadline: 9_000_000_000,
  });

  it('declines a job whose premium would round to zero', () => {
    // Rounding down is correct — never mint a unit nobody funded — so the job
    // is refused rather than covered for free. Underwriting real damage
    // exposure for no income is an attack, not an edge case.
    expect(acpAdapter.toTerms(jobAt('0.000099'), DEFAULT_ACP_POLICY)).toBeNull();
  });

  it('accepts the smallest job that still pays a premium', () => {
    const terms = acpAdapter.toTerms(jobAt('0.0001'), DEFAULT_ACP_POLICY);
    expect(terms).not.toBeNull();
    expect(formatUnits(terms!.premium)).toBe('0.000001');
  });

  it('accepts a job at the size seen on chain', () => {
    expect(acpAdapter.toTerms(jobAt('0.01'), DEFAULT_ACP_POLICY)).not.toBeNull();
  });
});

/**
 * What live traffic implies for a coverage pool.
 *
 * Measured on Base mainnet: roughly a fifth of settled agent jobs never
 * deliver — they expire. A pool at the default policy breaks even at about a
 * 3% *fraud* rate, so if non-delivery drew on cover, every pool would be
 * insolvent from its first season.
 *
 * It does not, and that is the entire reason the verdicts are split four ways
 * rather than two. These tests pin the mapping that keeps it true.
 */
describe('non-delivery must never reach the pool', () => {
  const terms: JobTerms = {
    pay: parseUnits('1'),
    premium: parseUnits('0.01'),
    deposit: parseUnits('0.4'),
    evaluatorBond: parseUnits('0.25'),
    poolCapital: parseUnits('50'),
    damage: parseUnits('0.7'),
  };

  it.each(['notDelivered', 'rejected'] as const)('costs the pool nothing on %s', (verdict) => {
    const { ledger } = settle({ terms, verdict });
    expect(ledger.pool).toBe(0n);
    expect(ledger.provider).toBe(0n);
    expect(ledger.client).toBe(0n);
  });

  it('draws on the pool only for an adjudicated finding', () => {
    expect(settle({ terms, verdict: 'cheated' }).ledger.pool).toBeLessThan(0n);
  });

  /**
   * The observed non-delivery rate is far above the rate a pool could absorb.
   * If a future change ever routed expiries into cover, this fails.
   */
  it('would be insolvent if expiries were treated as fraud', () => {
    // Even the BEST window observed (8%) is above what a pool can absorb;
    // the worst (84%) is an order of magnitude beyond it.
    const observedNonDelivery = 0.08;
    const breakEven = breakEvenFailureRate(terms.premium, terms.damage, terms.deposit)!;
    expect(breakEven).toBeLessThan(observedNonDelivery);

    const asFraud = runSeason({
      jobs: 1_000,
      premiumPerJob: terms.premium,
      failureRate: observedNonDelivery,
      damagePerFailure: terms.damage,
      depositPerJob: terms.deposit,
    });
    expect(asFraud.profitable).toBe(false);
  });
});

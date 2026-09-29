import { describe, expect, it } from 'vitest';
import {
  acpAdapter,
  conservesValue,
  DEFAULT_ACP_POLICY,
  isInsurable,
  parseUnits,
  settle,
} from '../src/index.js';
import type { AcpJob } from '../src/index.js';

const usdc = (value: string) => parseUnits(value);

const JOB: AcpJob = {
  id: 'job-1',
  priceUsdc: usdc('100'),
  phase: 'transaction',
  proofOfAgreement: '0xpoa',
  slaDeadline: 1_800_000_000,
};

describe('translating an ACP job into insurable terms', () => {
  it('prices premium, bonds and damage cover off the job price', () => {
    const terms = acpAdapter.toTerms(JOB, DEFAULT_ACP_POLICY);
    expect(terms).not.toBeNull();
    expect(terms!.pay).toBe(usdc('100'));
    expect(terms!.premium).toBe(usdc('1'));
    expect(terms!.deposit).toBe(usdc('40'));
    expect(terms!.evaluatorBond).toBe(usdc('25'));
    expect(terms!.damage).toBe(usdc('70'));
  });

  it('scales with the job rather than hardcoding an example', () => {
    const terms = acpAdapter.toTerms({ ...JOB, priceUsdc: usdc('250') }, DEFAULT_ACP_POLICY);
    expect(terms!.premium).toBe(usdc('2.5'));
    expect(terms!.deposit).toBe(usdc('100'));
  });
});

describe('what cannot be insured', () => {
  it('declines a job above the policy cap', () => {
    expect(isInsurable({ ...JOB, priceUsdc: usdc('5000') })).toBe(false);
  });

  it('declines an unpriced job', () => {
    expect(isInsurable({ ...JOB, priceUsdc: 0n })).toBe(false);
  });

  it('declines a job with no signed agreement to grade against', () => {
    const { proofOfAgreement: _omitted, ...rest } = JOB;
    expect(isInsurable(rest as AcpJob)).toBe(false);
  });

  it('declines a job with no deadline', () => {
    const { slaDeadline: _omitted, ...rest } = JOB;
    expect(isInsurable(rest as AcpJob)).toBe(false);
  });

  it.each(['evaluation', 'completed', 'rejected', 'expired'] as const)(
    'declines cover once the job is at %s — the outcome is already being decided',
    (phase) => {
      expect(isInsurable({ ...JOB, phase })).toBe(false);
    },
  );

  it.each(['request', 'negotiation', 'transaction'] as const)('insures a job at %s', (phase) => {
    expect(isInsurable({ ...JOB, phase })).toBe(true);
  });
});

describe('mapping ACP outcomes onto verdicts', () => {
  it('treats approval as done right', () => {
    expect(acpAdapter.toVerdict({ approved: true, score: 0.9 })).toBe('doneRight');
  });

  it('treats a bare rejection as graded-bad, NOT as cheating', () => {
    // An evaluator refuses for free and without proof, so its refusal alone
    // must not charge a coverage pool.
    expect(acpAdapter.toVerdict({ approved: false, score: 0.1 })).toBe('rejected');
  });

  it('treats SLA expiry as nobody delivered, never as cheating', () => {
    // ACP already refunds on expiry. Assurance must not punish anyone for it.
    expect(acpAdapter.toVerdict({ approved: false, expired: true })).toBe('notDelivered');
  });
});

describe('end to end: an ACP job settled through the assurance core', () => {
  it('refunds without charging the pool when the evaluator rejects', () => {
    const terms = acpAdapter.toTerms(JOB, DEFAULT_ACP_POLICY)!;
    const verdict = acpAdapter.toVerdict({ approved: false, score: 0.2 });
    const { ledger } = settle({ terms, verdict });

    expect(verdict).toBe('rejected');
    expect(ledger.client).toBe(0n);
    expect(ledger.pool).toBe(0n);
    expect(conservesValue(ledger)).toBe(true);
  });

  it('pays the client beyond a refund only on an adjudicated finding', () => {
    const terms = acpAdapter.toTerms(JOB, DEFAULT_ACP_POLICY)!;
    // `cheated` comes from an adjudication in the client's favour, not from an
    // evaluator's rejection. This is the difference from a bare escrow: the
    // client is not merely refunded, it is compensated for the failure's cost.
    const { ledger } = settle({ terms, verdict: 'cheated' });
    expect(ledger.client).toBe(usdc('70'));
    expect(conservesValue(ledger)).toBe(true);
  });

  it('leaves everyone flat when the job simply expires', () => {
    const terms = acpAdapter.toTerms(JOB, DEFAULT_ACP_POLICY)!;
    const verdict = acpAdapter.toVerdict({ approved: false, expired: true });
    const { ledger } = settle({ terms, verdict });
    expect(ledger.client).toBe(0n);
    expect(ledger.provider).toBe(0n);
    expect(ledger.pool).toBe(0n);
  });
});

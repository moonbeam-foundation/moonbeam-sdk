import { describe, expect, it } from 'vitest';
import {
  ACP_TOPIC0,
  conservesValue,
  localClock,
  parseUnits,
  prepareSettlement,
  settle,
} from '../src/index.js';
import type { JobTerms, RawLog } from '../src/index.js';

const usdc = (v: string) => parseUnits(v);
const pad = (hex: string) => hex.replace(/^0x/, '').padStart(64, '0');
const topic = (hex: string) => `0x${pad(hex)}`;

const CLIENT = '0x1111111111111111111111111111111111111111';
const PROVIDER = '0x2222222222222222222222222222222222222222';
const TASK = `0x${'ab'.repeat(32)}`;
const DEADLINE = 1_800_000_000;

const TERMS: JobTerms = {
  pay: usdc('100'),
  premium: usdc('1'),
  deposit: usdc('40'),
  evaluatorBond: usdc('25'),
  poolCapital: usdc('5000'),
  damage: usdc('70'),
};

const lockedLog: RawLog = {
  topics: [ACP_TOPIC0.locked, TASK, topic(CLIENT), topic(PROVIDER)],
  data: `0x${pad('64')}${pad(DEADLINE.toString(16))}`,
};
const refundedLog: RawLog = {
  topics: [ACP_TOPIC0.refunded, TASK, topic(CLIENT)],
  data: `0x${pad('64')}`,
};
const adjudicatedForClient: RawLog = {
  topics: [ACP_TOPIC0.adjudicated, TASK, topic(CLIENT)],
  data: `0x${pad('64')}`,
};

describe('logs to settlement input', () => {
  it('reports a job still in flight rather than inventing a verdict', () => {
    const result = prepareSettlement([lockedLog], TERMS, localClock(DEADLINE - 100));
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.pending).toBe('awaitingDelivery');
  });

  it('reports a claimable refund once the deadline passes', () => {
    const result = prepareSettlement([lockedLog], TERMS, localClock(DEADLINE + 100));
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.pending).toBe('refundClaimable');
  });

  it('produces a settlement input once the job has ended', () => {
    const result = prepareSettlement([lockedLog, refundedLog], TERMS, localClock(DEADLINE + 100));
    expect(result.ready).toBe(true);
    if (result.ready) {
      expect(result.input.verdict).toBe('notDelivered');
      expect(conservesValue(settle(result.input).ledger)).toBe(true);
    }
  });

  it('carries an adjudicated finding through to a settled ledger', () => {
    const result = prepareSettlement([lockedLog, adjudicatedForClient], TERMS, localClock(DEADLINE + 100));
    expect(result.ready).toBe(true);
    if (result.ready) {
      expect(result.input.verdict).toBe('cheated');
      const { ledger } = settle(result.input);
      expect(ledger.client).toBe(usdc('70'));
      expect(conservesValue(ledger)).toBe(true);
    }
  });

  it('threads optional doubt and challenge positions through', () => {
    const result = prepareSettlement([lockedLog, refundedLog], TERMS, localClock(DEADLINE + 100), {
      doubt: { notional: usdc('30'), feeBps: 34 },
      challenge: { bond: usdc('10'), upheld: false },
    });
    expect(result.ready).toBe(true);
    if (result.ready) {
      expect(result.input.doubt).toBeDefined();
      expect(result.input.challenge).toBeDefined();
      expect(conservesValue(settle(result.input).ledger)).toBe(true);
    }
  });

  it('ignores logs that are not agent-commerce events', () => {
    const noise: RawLog = { topics: [`0x${'99'.repeat(32)}`], data: '0x' };
    const result = prepareSettlement([noise, lockedLog, refundedLog], TERMS, localClock(DEADLINE + 100));
    expect(result.ready).toBe(true);
  });

  it('says nothing has started when given no logs at all', () => {
    const result = prepareSettlement([], TERMS, localClock(DEADLINE));
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.pending).toBe('notStarted');
  });
});

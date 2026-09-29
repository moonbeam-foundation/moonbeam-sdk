import { keccak256, toHex } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  ACP_SIGNATURES,
  ACP_TOPIC0,
  attributeDispute,
  decodeAcpLog,
  decodeAcpLogs,
} from '../src/index.js';
import type { RawLog } from '../src/index.js';

/** A 32-byte word as a bare 64-char hex body (for concatenating into `data`). */
const pad = (hex: string) => hex.replace(/^0x/, '').padStart(64, '0');
/** A topic — a full 0x-prefixed 32-byte word, which is how RPCs return them. */
const topic = (hex: string) => `0x${pad(hex)}`;
const addrTopic = (a: string) => topic(a);
const numTopic = (n: number | bigint) => topic(n.toString(16));
const addrWord = (a: string) => pad(a);
const numWord = (n: number | bigint) => pad(n.toString(16));
const data = (...words: string[]) => `0x${words.join('')}`;

const CLIENT = '0x1111111111111111111111111111111111111111';
const PROVIDER = '0x2222222222222222222222222222222222222222';
const EVALUATOR = '0x3333333333333333333333333333333333333333';
const TASK_ID = `0x${'ab'.repeat(32)}`;

/**
 * The guard that matters most in this file: every pinned constant is re-derived
 * from its signature. A mistyped hash would silently fail to match live traffic,
 * and the decoder would look like it was working while seeing nothing.
 */
describe('pinned topic0 constants', () => {
  it.each(Object.keys(ACP_SIGNATURES) as (keyof typeof ACP_SIGNATURES)[])(
    'derives %s from its signature',
    (name) => {
      expect(ACP_TOPIC0[name]).toBe(keccak256(toHex(ACP_SIGNATURES[name])));
    },
  );

  it('covers every signature with a constant and vice versa', () => {
    expect(Object.keys(ACP_TOPIC0).sort()).toEqual(Object.keys(ACP_SIGNATURES).sort());
  });

  it('notes that two contracts share the Disputed signature', () => {
    // AcpTaskSpace and AcpEscrow both declare Disputed(bytes32,address), so the
    // decoder cannot attribute it from topic0 alone. This test documents the
    // collision so nobody "fixes" the ambiguity by guessing.
    expect(ACP_TOPIC0.disputed).toBe(keccak256(toHex('Disputed(bytes32,address)')));
  });
});

describe('decoding non-ACP input', () => {
  it('returns null rather than throwing on an unknown topic', () => {
    expect(decodeAcpLog({ topics: [`0x${'99'.repeat(32)}`], data: '0x' })).toBeNull();
  });

  it('returns null for a log with no topics', () => {
    expect(decodeAcpLog({ topics: [], data: '0x' })).toBeNull();
    expect(decodeAcpLog({})).toBeNull();
  });

  it('survives truncated data without throwing', () => {
    const log: RawLog = { topics: [ACP_TOPIC0.jobCreated, numTopic(1), addrTopic(CLIENT), addrTopic(PROVIDER)], data: '0x' };
    expect(() => decodeAcpLog(log)).not.toThrow();
  });
});

describe('Virtuals ACP events', () => {
  it('decodes JobCreated including the evaluator', () => {
    const log: RawLog = {
      topics: [ACP_TOPIC0.jobCreated, numTopic(70122), addrTopic(CLIENT), addrTopic(PROVIDER)],
      data: data(addrWord(EVALUATOR), numWord(1_800_000_000), addrWord(ZERO)),
    };
    const event = decodeAcpLog(log);
    expect(event).toMatchObject({
      kind: 'jobCreated',
      jobId: 70122n,
      client: CLIENT,
      provider: PROVIDER,
      evaluator: EVALUATOR,
      expiredAt: 1_800_000_000,
    });
  });

  it('decodes a completion with its memo hash', () => {
    const memo = `0x${'cd'.repeat(32)}`;
    const log: RawLog = {
      topics: [ACP_TOPIC0.jobCompleted, numTopic(70122), addrTopic(EVALUATOR)],
      data: data(pad(memo)),
    };
    expect(decodeAcpLog(log)).toMatchObject({ kind: 'jobCompleted', jobId: 70122n, memoHash: memo });
  });

  it('decodes a rejection', () => {
    const log: RawLog = {
      topics: [ACP_TOPIC0.jobRejected, numTopic(7n), addrTopic(EVALUATOR)],
      data: data(pad(`0x${'00'.repeat(32)}`)),
    };
    expect(decodeAcpLog(log)).toMatchObject({ kind: 'jobRejected', jobId: 7n });
  });

  it('decodes an expiry', () => {
    expect(decodeAcpLog({ topics: [ACP_TOPIC0.jobExpired, numTopic(9n)], data: '0x' })).toMatchObject({
      kind: 'jobExpired',
      jobId: 9n,
    });
  });
});

describe('Moonbeam ACP events', () => {
  it('decodes Locked with its deadline', () => {
    const log: RawLog = {
      topics: [ACP_TOPIC0.locked, TASK_ID, addrTopic(CLIENT), addrTopic(PROVIDER)],
      data: data(numWord(1_000_000n), numWord(1_800_000_000)),
    };
    expect(decodeAcpLog(log)).toMatchObject({
      kind: 'locked',
      amount: 1_000_000n,
      deadline: 1_800_000_000,
      requester: CLIENT,
      agent: PROVIDER,
    });
  });

  it('decodes Adjudicated, which is the only event naming a winner', () => {
    const log: RawLog = {
      topics: [ACP_TOPIC0.adjudicated, TASK_ID, addrTopic(CLIENT)],
      data: data(numWord(500n)),
    };
    expect(decodeAcpLog(log)).toMatchObject({ kind: 'adjudicated', winner: CLIENT, amount: 500n });
  });

  it.each([
    [0, 'settled'],
    [1, 'timeout'],
    [2, 'adjudicated'],
  ])('maps close reason %i to %s', (raw, reason) => {
    const log: RawLog = { topics: [ACP_TOPIC0.taskClosed, TASK_ID], data: data(numWord(raw)) };
    expect(decodeAcpLog(log)).toMatchObject({ kind: 'taskClosed', reason, rawReason: raw });
  });

  it('reports an unrecognised close reason as unknown rather than guessing', () => {
    const log: RawLog = { topics: [ACP_TOPIC0.taskClosed, TASK_ID], data: data(numWord(7)) };
    expect(decodeAcpLog(log)).toMatchObject({ kind: 'taskClosed', reason: 'unknown', rawReason: 7 });
  });
});

describe('the ambiguous Disputed event', () => {
  const log: RawLog = {
    address: '0xAAAaAAaaAAAAAAAAaAaaAaAAAAAAaAAAAAaAAaaA',
    topics: [ACP_TOPIC0.disputed, TASK_ID, addrTopic(PROVIDER)],
    data: '0x',
  };

  it('admits ambiguity instead of guessing a source', () => {
    expect(decodeAcpLog(log)).toMatchObject({ kind: 'disputed', by: PROVIDER, source: 'ambiguous' });
  });

  it('is narrowed by a known emitting address', () => {
    expect(attributeDispute(log, { escrow: '0xAAAaAAaaAAAAAAAAaAaaAaAAAAAAaAAAAAaAAaaA' })).toBe('escrow');
    expect(attributeDispute(log, { taskSpace: '0xAAAaAAaaAAAAAAAAaAaaAaAAAAAAaAAAAAaAAaaA' })).toBe('taskSpace');
  });

  it('stays ambiguous when the address is unknown', () => {
    expect(attributeDispute(log, { escrow: PROVIDER })).toBe('ambiguous');
  });

  it('stays ambiguous when the log carries no emitting address', () => {
    const { address: _omitted, ...withoutAddress } = log;
    expect(attributeDispute(withoutAddress, { escrow: PROVIDER })).toBe('ambiguous');
  });
});

describe('batch decoding', () => {
  it('keeps ACP logs and drops the rest', () => {
    const logs: RawLog[] = [
      { topics: [ACP_TOPIC0.jobExpired, numTopic(1n)], data: '0x' },
      { topics: [`0x${'99'.repeat(32)}`], data: '0x' },
      { topics: [ACP_TOPIC0.jobExpired, numTopic(2n)], data: '0x' },
    ];
    expect(decodeAcpLogs(logs)).toHaveLength(2);
  });
});

const ZERO = '0x0000000000000000000000000000000000000000';

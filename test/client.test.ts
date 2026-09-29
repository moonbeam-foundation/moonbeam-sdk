import { describe, expect, it } from 'vitest';
import {
  asProofBlob,
  assertSupportedChain,
  createAssuranceClient,
  SELECTOR,
  SUPPORTED_CHAIN_IDS,
  UnsupportedChainError,
} from '../src/index.js';
import type { Address, Hex32 } from '../src/index.js';

const ESCROW = '0xe5c0000000000000000000000000000000000001' as Address;
const EVALUATOR = '0xe7a1000000000000000000000000000000000002' as Address;
const AGENT = '0xa9e0000000000000000000000000000000000003' as Address;
const TASK = `0x${'ab'.repeat(32)}` as Hex32;

const client = createAssuranceClient({ chainId: 84532, escrow: ESCROW, evaluator: EVALUATOR });

describe('refusing chains the contracts are not on', () => {
  /**
   * A transaction built for a chain with no deployment is addressed to
   * nothing. Refusing at construction turns a lost transaction into an error
   * the caller sees immediately.
   */
  it.each([1, 8453, 137])('rejects mainnet chain %i', (chainId) => {
    expect(() => assertSupportedChain(chainId)).toThrow(UnsupportedChainError);
    expect(() => createAssuranceClient({ chainId, escrow: ESCROW })).toThrow(UnsupportedChainError);
  });

  it('names the chains it does support in the error', () => {
    try {
      assertSupportedChain(8453);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(String(error)).toContain('not deployed');
      expect(String(error)).toContain('84532');
    }
  });

  it.each(SUPPORTED_CHAIN_IDS)('accepts test chain %i', (chainId) => {
    expect(() => createAssuranceClient({ chainId, escrow: ESCROW })).not.toThrow();
  });
});

describe('escrow calls', () => {
  it('builds a lock carrying its value and deadline', () => {
    const call = client.escrow.lock({ taskId: TASK, agent: AGENT, deadline: 1_800_000_000, value: 100n });
    expect(call.to).toBe(ESCROW);
    expect(call.value).toBe(100n);
    expect(call.chainId).toBe(84532);
    expect(call.data.startsWith(SELECTOR.lock)).toBe(true);
    expect(call.data).toContain(AGENT.slice(2));
  });

  it('builds a release that moves no value of its own', () => {
    const call = client.escrow.release({ taskId: TASK, deliverableHash: TASK });
    expect(call.value).toBe(0n);
    expect(call.data.startsWith(SELECTOR.release)).toBe(true);
  });

  /** The call that stops a silent counterparty holding funds hostage. */
  it('describes the refund as callable by anyone', () => {
    const call = client.escrow.claimRefund({ taskId: TASK });
    expect(call.data.startsWith(SELECTOR.refundOnTimeout)).toBe(true);
    expect(call.summary).toContain('callable by anyone');
  });

  it('builds a dispute that freezes the escrow', () => {
    const call = client.escrow.dispute({ taskId: TASK });
    expect(call.data.startsWith(SELECTOR.dispute)).toBe(true);
    expect(call.summary).toContain('freeze');
  });
});

describe('the proof asymmetry, enforced by the types', () => {
  it('cannot build an approval without a proof', () => {
    // An empty blob can never become a ProofBlob, so it can never reach the
    // call that releases someone else's money.
    expect(() => asProofBlob('0x')).toThrow(RangeError);
    expect(() => asProofBlob('' as `0x${string}`)).toThrow(RangeError);
  });

  it('builds an approval from a real proof', () => {
    const call = client.evaluator.approve({ jobId: 70_122n, proof: asProofBlob('0xdeadbeef') });
    expect(call.data.startsWith(SELECTOR.complete)).toBe(true);
    expect(call.summary).toContain('verified proof');
  });

  it('builds a rejection with no proof at all', () => {
    // Refusing to pay withholds rather than moves, so it carries no proof
    // obligation — and the signature says so.
    const call = client.evaluator.reject({ jobId: 70_122n, reason: TASK });
    expect(call.data.startsWith(SELECTOR.reject)).toBe(true);
    expect(call.summary).toContain('no proof required');
  });

  it('refuses evaluator calls when no evaluator is configured', () => {
    const bare = createAssuranceClient({ chainId: 84532, escrow: ESCROW });
    expect(() => bare.evaluator.reject({ jobId: 1n, reason: TASK })).toThrow(/no evaluator/);
  });
});

describe('encoding', () => {
  it('pads every argument to a full word', () => {
    const call = client.escrow.lock({ taskId: TASK, agent: AGENT, deadline: 1, value: 0n });
    const args = call.data.slice(10); // strip 0x + selector
    expect(args.length % 64).toBe(0);
    expect(args.length / 64).toBe(3);
  });

  it('keeps a large job id intact', () => {
    const call = client.evaluator.reject({ jobId: 2n ** 64n, reason: TASK });
    expect(call.data).toContain('10000000000000000');
  });
});

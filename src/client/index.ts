import type { Address, Hex, Hex32 } from '../acp/hex.js';

/**
 * Building the transactions that drive an insured job.
 *
 * This module builds calls; it does not sign or send them. Two reasons, and
 * both are deliberate:
 *
 *   - The SDK never holds a key. A package that models economics has no
 *     business owning a signing surface, and callers already have a wallet.
 *   - Every builder is testable offline. A returned call is a value you can
 *     assert on, with no chain, no mocking of a provider, and no keys in CI.
 *
 * Pass the result to whatever your application already uses to send
 * transactions.
 */

export interface CallRequest {
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
  readonly chainId: number;
  /** What this call does, for logging and for confirmation prompts. */
  readonly summary: string;
}

/** Function selectors, each the first four bytes of its signature's hash. */
export const SELECTOR = {
  lock: '0x9f1f9b45',
  release: '0x8e6c1cfd',
  refundOnTimeout: '0x3f0ed84b',
  dispute: '0x0e6ecc42',
  complete: '0xd75bbdf3',
  reject: '0x41dd26f5',
} as const;

const pad = (hex: string): string => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const encodeAddress = (value: Address): string => pad(value);
const encodeUint = (value: bigint | number): string => pad(BigInt(value).toString(16));
const encodeBytes32 = (value: Hex32): string => pad(value);

export interface ChainConfig {
  readonly chainId: number;
  readonly escrow: Address;
  readonly taskSpace?: Address;
  readonly evaluator?: Address;
}

/**
 * Chain ids the SDK will build calls for.
 *
 * Mainnets are deliberately absent: the contracts these calls target are not
 * deployed there, so a built transaction would be addressed to nothing. Adding
 * a mainnet id here without a verified deployment would turn a compile-time
 * refusal into a lost transaction.
 */
export const SUPPORTED_CHAIN_IDS: readonly number[] = [84532, 36927, 31337];

export class UnsupportedChainError extends Error {
  constructor(chainId: number) {
    super(
      `chain ${chainId} is not supported: the assurance contracts are not deployed there. ` +
        `Supported: ${SUPPORTED_CHAIN_IDS.join(', ')}.`,
    );
    this.name = 'UnsupportedChainError';
  }
}

export function assertSupportedChain(chainId: number): void {
  if (!SUPPORTED_CHAIN_IDS.includes(chainId)) throw new UnsupportedChainError(chainId);
}

/** A proof blob. Non-empty by construction — see `approve` below. */
export type ProofBlob = Hex & { readonly __brand: 'ProofBlob' };

/**
 * Wrap a blob as a proof, rejecting anything empty.
 *
 * The brand is what lets `approve` demand a proof at the type level: an empty
 * or absent blob cannot be turned into one, so it cannot reach a call that
 * releases funds.
 */
export function asProofBlob(value: Hex): ProofBlob {
  if (!value || value === '0x') {
    throw new RangeError('a proof blob may not be empty: approving a payment requires proof');
  }
  return value as ProofBlob;
}

export interface EscrowCalls {
  /** Client locks payment for a task, with the deadline that makes refunds claimable. */
  lock(args: { taskId: Hex32; agent: Address; deadline: number; value: bigint }): CallRequest;
  /** Client accepts delivery and releases payment. */
  release(args: { taskId: Hex32; deliverableHash: Hex32; proof?: Hex }): CallRequest;
  /**
   * Claim a refund after the deadline.
   *
   * Callable by anyone, which is the property that stops a silent counterparty
   * holding funds hostage. It is not automatic: someone must call it.
   */
  claimRefund(args: { taskId: Hex32 }): CallRequest;
  /** Either party freezes the escrow for arbitration. */
  dispute(args: { taskId: Hex32 }): CallRequest;
}

export interface EvaluatorCalls {
  /**
   * Approve a deliverable and release payment. Requires a proof.
   *
   * The `ProofBlob` type is not decorative: paying out someone else's money
   * must be backed by something that verified, and this signature makes it
   * impossible to call otherwise.
   */
  approve(args: { jobId: bigint; proof: ProofBlob }): CallRequest;
  /**
   * Reject a deliverable. Requires no proof.
   *
   * Refusing to pay is always safe — it withholds rather than moves — so it
   * carries no proof obligation. Keeping this asymmetry visible in the two
   * signatures is the point.
   */
  reject(args: { jobId: bigint; reason: Hex32 }): CallRequest;
}

export interface AssuranceClient {
  readonly chainId: number;
  readonly escrow: EscrowCalls;
  readonly evaluator: EvaluatorCalls;
}

/** Build a client for a chain the contracts actually exist on. */
export function createAssuranceClient(config: ChainConfig): AssuranceClient {
  assertSupportedChain(config.chainId);
  const { chainId, escrow, evaluator } = config;

  const call = (to: Address, data: string, value: bigint, summary: string): CallRequest => ({
    to,
    data: `0x${data}` as Hex,
    value,
    chainId,
    summary,
  });

  const requireEvaluator = (): Address => {
    if (!evaluator) {
      throw new Error('no evaluator contract configured for this chain');
    }
    return evaluator;
  };

  return {
    chainId,
    escrow: {
      lock: ({ taskId, agent, deadline, value }) =>
        call(
          escrow,
          SELECTOR.lock.slice(2) + encodeBytes32(taskId) + encodeAddress(agent) + encodeUint(deadline),
          value,
          `lock ${value} for task ${taskId} until ${deadline}`,
        ),
      release: ({ taskId, deliverableHash }) =>
        call(
          escrow,
          SELECTOR.release.slice(2) + encodeBytes32(taskId) + encodeBytes32(deliverableHash),
          0n,
          `release payment for task ${taskId}`,
        ),
      claimRefund: ({ taskId }) =>
        call(
          escrow,
          SELECTOR.refundOnTimeout.slice(2) + encodeBytes32(taskId),
          0n,
          `claim the refund for task ${taskId} (callable by anyone after the deadline)`,
        ),
      dispute: ({ taskId }) =>
        call(
          escrow,
          SELECTOR.dispute.slice(2) + encodeBytes32(taskId),
          0n,
          `raise a dispute on task ${taskId} and freeze the escrow`,
        ),
    },
    evaluator: {
      approve: ({ jobId }) =>
        call(
          requireEvaluator(),
          SELECTOR.complete.slice(2) + encodeUint(jobId),
          0n,
          `approve job ${jobId} against a verified proof`,
        ),
      reject: ({ jobId, reason }) =>
        call(
          requireEvaluator(),
          SELECTOR.reject.slice(2) + encodeUint(jobId) + encodeBytes32(reason),
          0n,
          `reject job ${jobId} (no proof required)`,
        ),
    },
  };
}

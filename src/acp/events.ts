import { asAddress, asBool, asHex32, asNumber, asUint, body, word } from './hex.js';
import type { Address, Hex, Hex32 } from './hex.js';

/**
 * Decoding ACP event logs.
 *
 * Two different systems are both called "ACP" and they must never be conflated:
 *
 *   Virtuals ACP  — the live agent-commerce ledger on Base mainnet (8453).
 *                   This is where real jobs happen today.
 *   Moonbeam ACP  — AcpTaskSpace / AcpEscrow, the assurance-side contracts.
 *                   Base Sepolia only; not deployed to mainnet.
 *
 * Decoding is keyed on topic0 and is deliberately address-agnostic, so it keeps
 * working across redeployments and needs no address list to be useful. Where
 * that costs precision, the decoder says so rather than guessing (see
 * `disputed` below).
 */

/** A log in the shape every JSON-RPC returns. Structural: the SDK takes no chain client. */
export interface RawLog {
  readonly address?: string;
  readonly topics?: readonly string[];
  readonly data?: string;
  readonly blockNumber?: number | string;
  readonly transactionHash?: string;
  readonly logIndex?: number | string;
}

export type CloseReason = 'settled' | 'timeout' | 'adjudicated' | 'unknown';

export type AcpEvent =
  // ── Virtuals ACP (Base mainnet) ──
  | { kind: 'jobCreated'; jobId: bigint; client: Address; provider: Address; evaluator: Address; expiredAt: number; hook: Address }
  | { kind: 'budgetSet'; jobId: bigint; amount: bigint }
  | { kind: 'jobFunded'; jobId: bigint; payer: Address; amount: bigint }
  | { kind: 'paymentReleased'; jobId: bigint; to: Address; amount: bigint }
  | { kind: 'jobRefunded'; jobId: bigint; to: Address; amount: bigint }
  | { kind: 'jobSubmitted'; jobId: bigint; provider: Address; memoHash: Hex32 }
  | { kind: 'jobCompleted'; jobId: bigint; evaluator: Address; memoHash: Hex32 }
  | { kind: 'jobRejected'; jobId: bigint; evaluator: Address; memoHash: Hex32 }
  | { kind: 'jobExpired'; jobId: bigint }
  | { kind: 'evaluatorFeePaid'; jobId: bigint; evaluator: Address; amount: bigint }
  // ── Moonbeam ACP: task space ──
  | { kind: 'taskOpened'; taskId: Hex32; requester: Address; agent: Address; openedAt: number }
  | { kind: 'deliverablePosted'; taskId: Hex32; deliverableHash: Hex32 }
  | { kind: 'taskClosed'; taskId: Hex32; reason: CloseReason; rawReason: number }
  // ── Moonbeam ACP: escrow ──
  | { kind: 'locked'; taskId: Hex32; requester: Address; agent: Address; amount: bigint; deadline: number }
  | { kind: 'released'; taskId: Hex32; agent: Address; amount: bigint; deliverableHash: Hex32 }
  | { kind: 'refunded'; taskId: Hex32; requester: Address; amount: bigint }
  | { kind: 'adjudicated'; taskId: Hex32; winner: Address; amount: bigint }
  // ── Ambiguous: identical signature in two contracts (see below) ──
  | { kind: 'disputed'; taskId: Hex32; by: Address; source: 'taskSpace' | 'escrow' | 'ambiguous' }
  // ── Taifoon evaluator ──
  | { kind: 'evaluated'; jobId: bigint; approved: boolean; proofChainId: number; proofBlockNumber: number; eventHash: Hex32 };

/**
 * Pinned topic0 hashes.
 *
 * Every value here is keccak256 of the signature in the comment beside it, and
 * `events.test.ts` re-derives each one so a typo can never silently fail to
 * match live traffic.
 */
export const ACP_TOPIC0 = {
  // Virtuals ACP — 0x238E541BfefD82238730D00a2208E5497F1832E0 on Base 8453
  jobCreated: '0xb0f0239bfdd96453e24733e18bfc24b70d8fadf123dd977473518dd577ee79b9',
  budgetSet: '0x869e2577b006bf47ee981cf6fec2e25583548081c14b98deab587f77b5068038',
  jobFunded: '0xe3fbcc1ea1bdc559ec7f0347efde7655e58b5f45a30b0e4470a583c3ef5496b3',
  paymentReleased: '0x21d71db5be59bb9fa133895586b7404307dd33fb93b16db09dc6f1d9d7d231b0',
  // Virtuals-side refund. Same event NAME as the Moonbeam escrow's Refunded,
  // but a different signature (uint256 job id vs bytes32 task id), so the two
  // hash differently and there is no collision to disambiguate.
  jobRefunded: '0x7ca5472b7ea78c2c0141c5a12ee6d170cf4ce8ed06be3d22c8252ddfc7a6a2c4',
  jobSubmitted: '0x80c17db79857f338a6a6df68a6883ecc0ce78e2202fe61ed979733573f40538e',
  jobCompleted: '0x0fd54bd364fa9e67f17b091aefe930932c09fe7651cf5ad02c71a418f3341444',
  jobRejected: '0xae7362b1af91f4492868987b9c73990d780060811551b58728fbe96fd1bab275',
  jobExpired: '0x97237956f8810192811e2c3f273fd02c5d6295206fdd9c62e6fe2bfc19ba9232',
  evaluatorFeePaid: '0x253dd534010ac976fa263caa123bae79b9c50292adf7ce67bdc5ec309f784e61',
  // Moonbeam ACP — AcpTaskSpace / AcpEscrow
  taskOpened: '0x600dfbfb15b70b6e1ac3d8fc730219456ae0ded94a40334c00cc7c5031e3f9fb',
  deliverablePosted: '0xf57768d26e4e3108ad9fa6fb546133f6334a7cfe1187e0b55b6d047ad0dabd0f',
  taskClosed: '0x512c9b2465185f5d8000a243615b3336722f2633841be6b004d973850d8d91e2',
  disputed: '0x0ba174eb1c3530da63920b98261208eeb30b48447d1cfcbbdf116fd4ee8c62db',
  locked: '0xef41d33faedb386d0b04b2cf25d4a36af74b3d651ed7c4e9999df759c439a51b',
  released: '0xb042339dce80243e75bcbfdad88b4329204557a1d4f7ee3d795a9d9e2054ef0e',
  refunded: '0xf552ca82e113ac3c539c3d617f29fcd19c172a0c75dad017555c9e109f7fe183',
  adjudicated: '0xcd715527620c66b37c389e9d8a257cdf11ea66d2a38e945db8902daab5e3a26f',
  evaluated: '0x187798e1291089cf1833b53b6d2f156af7f7e84e1deabc63a27d89a20a16177d',
} as const satisfies Record<string, Hex>;

/** The signatures the constants above are hashes of. Used by the self-check test. */
export const ACP_SIGNATURES = {
  jobCreated: 'JobCreated(uint256,address,address,address,uint256,address)',
  budgetSet: 'BudgetSet(uint256,uint256)',
  paymentReleased: 'PaymentReleased(uint256,address,uint256)',
  jobRefunded: 'Refunded(uint256,address,uint256)',
  jobFunded: 'JobFunded(uint256,address,uint256)',
  jobSubmitted: 'JobSubmitted(uint256,address,bytes32)',
  jobCompleted: 'JobCompleted(uint256,address,bytes32)',
  jobRejected: 'JobRejected(uint256,address,bytes32)',
  jobExpired: 'JobExpired(uint256)',
  evaluatorFeePaid: 'EvaluatorFeePaid(uint256,address,uint256)',
  taskOpened: 'TaskOpened(bytes32,address,address,uint256)',
  deliverablePosted: 'DeliverablePosted(bytes32,bytes32)',
  taskClosed: 'TaskClosed(bytes32,uint8)',
  disputed: 'Disputed(bytes32,address)',
  locked: 'Locked(bytes32,address,address,uint256,uint64)',
  released: 'Released(bytes32,address,uint256,bytes32)',
  refunded: 'Refunded(bytes32,address,uint256)',
  adjudicated: 'Adjudicated(bytes32,address,uint256)',
  evaluated: 'Evaluated(uint256,bool,uint64,uint64,bytes32)',
} as const satisfies Record<keyof typeof ACP_TOPIC0, string>;

/** The Virtuals ACP ledger on Base mainnet. An EIP-1967 proxy. */
export const VIRTUALS_ACP_ADDRESS: Address = '0x238e541bfefd82238730d00a2208e5497f1832e0';
export const VIRTUALS_ACP_CHAIN_ID = 8453;

function closeReasonOf(raw: number): CloseReason {
  switch (raw) {
    case 0:
      return 'settled';
    case 1:
      return 'timeout';
    case 2:
      return 'adjudicated';
    default:
      // Forward-compatible: a reason this build does not know must never be
      // guessed into a verdict.
      return 'unknown';
  }
}

/**
 * Decode one log.
 *
 * Returns `null` for anything that is not a recognised ACP event — most logs in
 * a block are not ours, so "not mine" is the ordinary answer rather than an
 * error. Never throws: a malformed log yields `null` too.
 */
export function decodeAcpLog(log: RawLog): AcpEvent | null {
  const topics = log.topics ?? [];
  const topic0 = topics[0]?.toLowerCase();
  if (!topic0) return null;

  const d = body(log.data);
  const t = (i: number): string => body(topics[i]).padStart(64, '0');

  switch (topic0) {
    // ── Virtuals ACP ──
    case ACP_TOPIC0.jobCreated:
      return {
        kind: 'jobCreated',
        jobId: asUint(t(1)),
        client: asAddress(t(2)),
        provider: asAddress(t(3)),
        evaluator: asAddress(word(d, 0)),
        expiredAt: asNumber(word(d, 1)),
        hook: asAddress(word(d, 2)),
      };
    case ACP_TOPIC0.budgetSet:
      return { kind: 'budgetSet', jobId: asUint(t(1)), amount: asUint(word(d, 0)) };
    case ACP_TOPIC0.jobFunded:
      return { kind: 'jobFunded', jobId: asUint(t(1)), payer: asAddress(t(2)), amount: asUint(word(d, 0)) };
    case ACP_TOPIC0.paymentReleased:
      return { kind: 'paymentReleased', jobId: asUint(t(1)), to: asAddress(t(2)), amount: asUint(word(d, 0)) };
    case ACP_TOPIC0.jobRefunded:
      return { kind: 'jobRefunded', jobId: asUint(t(1)), to: asAddress(t(2)), amount: asUint(word(d, 0)) };
    case ACP_TOPIC0.jobSubmitted:
      return { kind: 'jobSubmitted', jobId: asUint(t(1)), provider: asAddress(t(2)), memoHash: asHex32(word(d, 0)) };
    case ACP_TOPIC0.jobCompleted:
      return { kind: 'jobCompleted', jobId: asUint(t(1)), evaluator: asAddress(t(2)), memoHash: asHex32(word(d, 0)) };
    case ACP_TOPIC0.jobRejected:
      return { kind: 'jobRejected', jobId: asUint(t(1)), evaluator: asAddress(t(2)), memoHash: asHex32(word(d, 0)) };
    case ACP_TOPIC0.jobExpired:
      return { kind: 'jobExpired', jobId: asUint(t(1)) };
    case ACP_TOPIC0.evaluatorFeePaid:
      return { kind: 'evaluatorFeePaid', jobId: asUint(t(1)), evaluator: asAddress(t(2)), amount: asUint(word(d, 0)) };

    // ── Moonbeam ACP: task space ──
    case ACP_TOPIC0.taskOpened:
      return {
        kind: 'taskOpened',
        taskId: asHex32(t(1)),
        requester: asAddress(t(2)),
        agent: asAddress(t(3)),
        openedAt: asNumber(word(d, 0)),
      };
    case ACP_TOPIC0.deliverablePosted:
      return { kind: 'deliverablePosted', taskId: asHex32(t(1)), deliverableHash: asHex32(word(d, 0)) };
    case ACP_TOPIC0.taskClosed: {
      const rawReason = asNumber(word(d, 0));
      return { kind: 'taskClosed', taskId: asHex32(t(1)), reason: closeReasonOf(rawReason), rawReason };
    }

    // ── Moonbeam ACP: escrow ──
    case ACP_TOPIC0.locked:
      return {
        kind: 'locked',
        taskId: asHex32(t(1)),
        requester: asAddress(t(2)),
        agent: asAddress(t(3)),
        amount: asUint(word(d, 0)),
        deadline: asNumber(word(d, 1)),
      };
    case ACP_TOPIC0.released:
      return {
        kind: 'released',
        taskId: asHex32(t(1)),
        agent: asAddress(t(2)),
        amount: asUint(word(d, 0)),
        deliverableHash: asHex32(word(d, 1)),
      };
    case ACP_TOPIC0.refunded:
      return { kind: 'refunded', taskId: asHex32(t(1)), requester: asAddress(t(2)), amount: asUint(word(d, 0)) };
    case ACP_TOPIC0.adjudicated:
      return { kind: 'adjudicated', taskId: asHex32(t(1)), winner: asAddress(t(2)), amount: asUint(word(d, 0)) };

    // ── The one genuinely ambiguous case ──
    case ACP_TOPIC0.disputed:
      // AcpTaskSpace and AcpEscrow both declare Disputed(bytes32,address), so
      // the two are topic0-identical. Address-agnostic decoding cannot tell
      // them apart, so the decoder reports the ambiguity instead of guessing.
      // Callers who know the emitting addresses narrow it with attributeDispute().
      return { kind: 'disputed', taskId: asHex32(t(1)), by: asAddress(t(2)), source: 'ambiguous' };

    case ACP_TOPIC0.evaluated:
      return {
        kind: 'evaluated',
        jobId: asUint(t(1)),
        approved: asBool(word(d, 0)),
        proofChainId: asNumber(word(d, 1)),
        proofBlockNumber: asNumber(word(d, 2)),
        eventHash: asHex32(word(d, 3)),
      };

    default:
      return null;
  }
}

/** Decode a batch, dropping anything unrecognised. */
export function decodeAcpLogs(logs: readonly RawLog[]): AcpEvent[] {
  const out: AcpEvent[] = [];
  for (const log of logs) {
    const event = decodeAcpLog(log);
    if (event) out.push(event);
  }
  return out;
}

/**
 * Narrow an ambiguous `Disputed` using the addresses you know.
 *
 * Takes the log the event came from, because the emitting address is the only
 * thing that distinguishes the two contracts.
 */
export function attributeDispute(
  log: RawLog,
  known: { readonly taskSpace?: string; readonly escrow?: string },
): 'taskSpace' | 'escrow' | 'ambiguous' {
  const emitter = log.address?.toLowerCase();
  if (!emitter) return 'ambiguous';
  if (known.taskSpace && emitter === known.taskSpace.toLowerCase()) return 'taskSpace';
  if (known.escrow && emitter === known.escrow.toLowerCase()) return 'escrow';
  return 'ambiguous';
}

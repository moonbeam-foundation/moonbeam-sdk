import { ACP_SIGNATURES, ACP_TOPIC0, VIRTUALS_ACP_ADDRESS, VIRTUALS_ACP_CHAIN_ID } from './events.js';
import type { Hex } from './hex.js';

/**
 * The decoder's own account of what it watches.
 *
 * A proof layer indexing these events needs the same topic list the decoder
 * uses, and the two drifting apart is the failure that hurts most: the indexer
 * quietly stops capturing an event, the decoder still knows about it, and job
 * histories develop holes that nothing reports. So rather than each side
 * keeping a hand-written copy, the decoder publishes its watch list and the
 * indexer reads it.
 *
 * Note the two systems named "ACP" have different lifecycle *shapes*, not just
 * different addresses. Anything pairing with this must key on both.
 */

export type LedgerId = 'virtuals-acp' | 'moonbeam-acp';

export interface WatchedEvent {
  /** Key in ACP_TOPIC0 / ACP_SIGNATURES. */
  readonly name: keyof typeof ACP_TOPIC0;
  readonly topic0: Hex;
  readonly signature: string;
  readonly ledger: LedgerId;
  /** Opens a job's lifecycle. */
  readonly opens: boolean;
  /** Ends it — the events a proof layer must never miss. */
  readonly terminal: boolean;
}

const VIRTUALS: readonly (keyof typeof ACP_TOPIC0)[] = [
  'jobCreated',
  'budgetSet',
  'jobFunded',
  'jobSubmitted',
  'jobCompleted',
  'jobRejected',
  'jobExpired',
  'paymentReleased',
  'jobRefunded',
  'evaluatorFeePaid',
];

const OPENS: ReadonlySet<string> = new Set(['jobCreated', 'taskOpened', 'locked']);

/**
 * Events after which no further settlement is possible.
 *
 * These are the ones an indexer must capture without exception: miss an
 * opening event and a job is invisible, which is obvious. Miss a *terminal*
 * event and the job looks permanently unsettled, which is not.
 */
const TERMINAL: ReadonlySet<string> = new Set([
  'jobCompleted',
  'jobRejected',
  'jobExpired',
  'paymentReleased',
  'jobRefunded',
  'taskClosed',
  'released',
  'refunded',
  'adjudicated',
]);

/** Every event this decoder recognises, with its role in the lifecycle. */
export const WATCHED_EVENTS: readonly WatchedEvent[] = Object.freeze(
  (Object.keys(ACP_TOPIC0) as (keyof typeof ACP_TOPIC0)[]).map((name) => ({
    name,
    topic0: ACP_TOPIC0[name],
    signature: ACP_SIGNATURES[name],
    ledger: (VIRTUALS.includes(name) ? 'virtuals-acp' : 'moonbeam-acp') as LedgerId,
    opens: OPENS.has(name),
    terminal: TERMINAL.has(name),
  })),
);

/** Everything an indexer must subscribe to for histories to be complete. */
export function watchedTopics(ledger?: LedgerId): readonly Hex[] {
  return WATCHED_EVENTS.filter((e) => !ledger || e.ledger === ledger).map((e) => e.topic0);
}

/** The events whose loss would silently leave jobs looking unsettled. */
export function terminalTopics(ledger?: LedgerId): readonly Hex[] {
  return WATCHED_EVENTS.filter((e) => e.terminal && (!ledger || e.ledger === ledger)).map((e) => e.topic0);
}

export interface LedgerSpec {
  readonly id: LedgerId;
  readonly chainId: number;
  /** Known address, where there is one. Decoding never depends on it. */
  readonly address?: Hex;
  readonly deployed: boolean;
  readonly note: string;
}

/**
 * Where each lifecycle actually lives.
 *
 * Decoding is address-agnostic by design, so these are for indexers choosing
 * what to subscribe to — not for the decoder, which matches on topic alone and
 * therefore survives redeployment.
 */
export const LEDGERS: readonly LedgerSpec[] = Object.freeze([
  {
    id: 'virtuals-acp',
    chainId: VIRTUALS_ACP_CHAIN_ID,
    address: VIRTUALS_ACP_ADDRESS,
    deployed: true,
    note: 'live agent-commerce traffic; an upgradeable proxy, so index by topic rather than by implementation',
  },
  {
    id: 'moonbeam-acp',
    chainId: 84532,
    deployed: false,
    note: 'assurance-side escrow and task space; test networks only, no mainnet deployment',
  },
]);

/**
 * A description of the watch list for a proof layer to consume.
 *
 * Deliberately plain data: an indexer in another language should be able to
 * read this without sharing types with the SDK, and a mismatch should be
 * visible by diffing rather than by reasoning.
 */
export function watchManifest(): {
  readonly ledgers: readonly LedgerSpec[];
  readonly events: readonly WatchedEvent[];
  readonly terminalTopics: readonly Hex[];
} {
  return {
    ledgers: LEDGERS,
    events: WATCHED_EVENTS,
    terminalTopics: terminalTopics(),
  };
}

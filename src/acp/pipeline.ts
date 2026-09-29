import type { Clock } from '../core/clock.js';
import type { JobTerms, SettlementInput, DoubtPosition, ChallengePosition } from '../core/types.js';
import { decodeAcpLogs } from './events.js';
import type { RawLog } from './events.js';
import { foldTask } from './lifecycle.js';
import type { TaskState } from './lifecycle.js';
import { isSettled, toOutcome } from './outcome.js';
import type { AcpOutcome, PendingReason } from './outcome.js';

/**
 * Logs in, settlement input out — as far as the chain can take you.
 *
 * This is pure: it takes logs the caller has already fetched. The SDK never
 * fetches and settles in one call, because that is what would put IO inside the
 * settlement path and make the economics untestable.
 */

export type Prepared =
  | { readonly ready: true; readonly input: SettlementInput; readonly state: TaskState; readonly outcome: AcpOutcome }
  | { readonly ready: false; readonly pending: PendingReason; readonly state: TaskState; readonly outcome: AcpOutcome };

export interface PrepareOptions {
  readonly doubt?: DoubtPosition;
  readonly challenge?: ChallengePosition;
}

/** Decode logs for one job, fold them, and produce a settlement input if the job has ended. */
export function prepareSettlement(
  logs: readonly RawLog[],
  terms: JobTerms,
  clock: Clock,
  options: PrepareOptions = {},
): Prepared {
  const state = foldTask(decodeAcpLogs(logs));
  const outcome = toOutcome(state, clock);

  // `isSettled` is a type guard, so this narrows the union for both branches —
  // checking `outcome.verdict === null` by hand does not.
  if (!isSettled(outcome)) {
    return { ready: false, pending: outcome.pending, state, outcome };
  }

  return {
    ready: true,
    state,
    outcome,
    input: {
      terms,
      verdict: outcome.verdict,
      ...(options.doubt ? { doubt: options.doubt } : {}),
      ...(options.challenge ? { challenge: options.challenge } : {}),
    },
  };
}

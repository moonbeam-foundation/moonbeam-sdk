import type { FinalityAttestation } from '../core/clock.js';
import type { AttestationSource } from './attestation.js';
import { parseAttestation } from './attestation.js';
import { err, ok } from './result.js';
import type { LookupError, Result } from './result.js';

/**
 * HTTP-backed sources.
 *
 * `fetch` is injected so every test runs offline against recorded responses,
 * and so a caller can supply its own retry, caching or logging without the SDK
 * inventing a policy for any of them.
 */

export type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

export interface HttpSourceOptions {
  readonly baseUrl: string;
  readonly fetch?: Fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

async function getJson(
  options: HttpSourceOptions,
  path: string,
): Promise<Result<unknown, LookupError>> {
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as Fetch | undefined);
  if (!doFetch) {
    return err({ kind: 'network', message: 'no fetch implementation available' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await doFetch(`${options.baseUrl}${path}`, { signal: controller.signal });
    if (response.status === 404) {
      // A definitive "nothing here" — the one negative answer that is a fact.
      return err({ kind: 'noData', detail: `not served: ${path}` });
    }
    if (!response.ok) {
      // Everything else means we do not know. Never read as absence.
      return err({ kind: 'unavailable', status: response.status });
    }
    return ok(await response.json());
  } catch (cause) {
    return err({ kind: 'network', message: String(cause) });
  } finally {
    clearTimeout(timeout);
  }
}

/** Reads signed finality attestations over HTTP. */
export function createAttestationSource(options: HttpSourceOptions): AttestationSource {
  return {
    async latest(chainId: number): Promise<Result<FinalityAttestation, LookupError>> {
      const response = await getJson(options, `/v5/acp/liveness/${chainId}`);
      if (!response.ok) return response;
      return parseAttestation(response.value);
    },
  };
}

/** Identifies one event: chain, transaction, and position within it. */
export interface EventRef {
  readonly chainId: number;
  readonly txHash: string;
  readonly logIndex: number;
}

export function formatEventRef(ref: EventRef): string {
  return `${ref.chainId}:${ref.txHash}:${ref.logIndex}`;
}

export interface ProofSource {
  /** Fetch a proof blob for one event, for onward on-chain verification. */
  forEvent(ref: EventRef): Promise<Result<unknown, LookupError>>;
}

export function createProofSource(options: HttpSourceOptions): ProofSource {
  return {
    forEvent(ref: EventRef): Promise<Result<unknown, LookupError>> {
      return getJson(options, `/v5/acp/event/${formatEventRef(ref)}`);
    },
  };
}

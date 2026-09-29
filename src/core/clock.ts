/**
 * Time, and where it came from.
 *
 * Deadlines decide money here: whether a refund is claimable, whether a job has
 * expired, whether a dispute window is still open. So the SDK refuses to accept
 * a bare number as "now". Every `Clock` carries its provenance, and a caller
 * settling on a deadline can always tell whether the time came from their own
 * machine or from something attested.
 *
 * The strongest source available is a signed finality attestation: an operator
 * signs (chain, finalized block, timestamp) and the signature is recoverable,
 * so a claim about time is non-repudiable rather than merely asserted. That is
 * better than an unsigned RPC — but it is still one signer, so the SDK calls it
 * `attested`, never "trustless".
 */

export type Seconds = number;

export type ClockSource =
  /** The caller's own machine. Fine for previews; not evidence. */
  | 'local'
  /** A signed finality attestation. Non-repudiable, but trusts one signer. */
  | 'attested'
  /** A block timestamp read directly from a chain. */
  | 'chain';

export interface FinalityAttestation {
  readonly chainId: number;
  readonly finalizedBlock: number;
  readonly timestamp: Seconds;
  readonly digest: string;
  readonly signature: string;
  /** Self-reported by the source. Worth nothing until recovered from the signature. */
  readonly signer: string;
}

export interface Clock {
  readonly now: Seconds;
  readonly source: ClockSource;
  readonly attestation?: FinalityAttestation;
}

export function localClock(now: Seconds): Clock {
  return { now, source: 'local' };
}

export function chainClock(blockTimestamp: Seconds): Clock {
  return { now: blockTimestamp, source: 'chain' };
}

export function attestedClock(attestation: FinalityAttestation): Clock {
  return { now: attestation.timestamp, source: 'attested', attestation };
}

/** Is this clock recent enough to act on? */
export function isFresh(clock: Clock, now: Seconds, maxAgeSeconds: number): boolean {
  return now - clock.now <= maxAgeSeconds;
}

export type Expiry =
  | { readonly state: 'live'; readonly secondsRemaining: number }
  | { readonly state: 'expired'; readonly secondsSince: number }
  /** No deadline was recorded, so nothing can be said about expiry. */
  | { readonly state: 'unknown' };

export function expiryOf(deadline: Seconds | undefined, clock: Clock): Expiry {
  if (deadline === undefined) return { state: 'unknown' };
  if (clock.now < deadline) return { state: 'live', secondsRemaining: deadline - clock.now };
  return { state: 'expired', secondsSince: clock.now - deadline };
}

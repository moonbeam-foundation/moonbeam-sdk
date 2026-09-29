import { attestedClock } from '../core/clock.js';
import type { Clock, FinalityAttestation } from '../core/clock.js';
import { err, ok } from './result.js';
import type { LookupError, Result } from './result.js';

/**
 * Reading a signed finality attestation, and — crucially — checking it.
 *
 * An attestation arrives carrying a `signer` field. That field is *self-
 * reported*: a source claiming "this was signed by X" proves nothing until the
 * signature is recovered and compared. So verification is a separate, explicit
 * step, and the SDK never presents an unverified attestation as evidence.
 *
 * The recovery primitive is injected rather than bundled, so the package keeps
 * no runtime dependency and callers use whatever crypto they already have.
 */

/**
 * Recovers the signing address from a digest and signature.
 *
 * **How the digest is signed matters, and getting it wrong fails silently.**
 * Recovery always returns *some* address; a mismatched scheme returns a
 * plausible-looking wrong one rather than an error. Attestations are commonly
 * signed as EIP-191 personal messages over the digest bytes rather than as a
 * raw hash, so a recovery that treats the digest as a bare hash will produce
 * an address that never matches and no explanation of why.
 *
 * With viem, that means:
 *
 * ```ts
 * const ecrecover: Ecrecover = (digest, signature) =>
 *   recoverMessageAddress({ message: { raw: digest as Hex }, signature: signature as Hex });
 * ```
 *
 * Verify against a known-good attestation once before relying on it.
 */
export type Ecrecover = (digest: string, signature: string) => string | Promise<string>;

export interface AttestationSource {
  /**
   * Fetch the latest finality attestation for a chain.
   *
   * Returns `noData` when the source has nothing for this chain — an honest
   * answer, not a failure. A chain that is not covered simply is not covered.
   */
  latest(chainId: number): Promise<Result<FinalityAttestation, LookupError>>;
}

export type Verification =
  | { readonly verified: true; readonly signer: string }
  | { readonly verified: false; readonly reason: string };

/** Does this attestation's signature actually recover to the address it claims? */
export async function verifyAttestation(
  attestation: FinalityAttestation,
  ecrecover: Ecrecover,
): Promise<Verification> {
  try {
    const recovered = await ecrecover(attestation.digest, attestation.signature);
    if (recovered.toLowerCase() !== attestation.signer.toLowerCase()) {
      return {
        verified: false,
        reason: `signature recovers to ${recovered}, not the claimed ${attestation.signer}`,
      };
    }
    return { verified: true, signer: recovered };
  } catch (cause) {
    return { verified: false, reason: `could not recover a signer: ${String(cause)}` };
  }
}

/** Is this attestation signed by a signer we are willing to rely on? */
export async function isSignedByTrusted(
  attestation: FinalityAttestation,
  trusted: readonly string[],
  ecrecover: Ecrecover,
): Promise<boolean> {
  const result = await verifyAttestation(attestation, ecrecover);
  if (!result.verified) return false;
  return trusted.some((address) => address.toLowerCase() === result.signer.toLowerCase());
}

/**
 * Turn an attestation into a clock, but only once its signature checks out.
 *
 * An unverified attestation is just a number someone sent you, so it is
 * refused here rather than quietly downgraded to a local clock — a caller that
 * asked for attested time should hear that it could not be provided.
 */
export async function clockFromAttestation(
  attestation: FinalityAttestation,
  ecrecover: Ecrecover,
): Promise<Result<Clock, LookupError>> {
  const verification = await verifyAttestation(attestation, ecrecover);
  if (!verification.verified) {
    return err({ kind: 'malformed', message: verification.reason });
  }
  return ok(attestedClock(attestation));
}

/** Shape-check a parsed attestation payload before trusting its fields. */
export function parseAttestation(payload: unknown): Result<FinalityAttestation, LookupError> {
  if (typeof payload !== 'object' || payload === null) {
    return err({ kind: 'malformed', message: 'attestation payload is not an object' });
  }
  const p = payload as Record<string, unknown>;
  const chainId = p['chain_id'] ?? p['chainId'];
  const finalizedBlock = p['finalized_block'] ?? p['finalizedBlock'];
  const timestamp = p['timestamp'];
  const digest = p['digest'];
  const signature = p['signature'];
  const signer = p['signer'];

  if (
    typeof chainId !== 'number' ||
    typeof finalizedBlock !== 'number' ||
    typeof timestamp !== 'number' ||
    typeof digest !== 'string' ||
    typeof signature !== 'string' ||
    typeof signer !== 'string'
  ) {
    return err({ kind: 'malformed', message: 'attestation is missing required fields' });
  }

  return ok({ chainId, finalizedBlock, timestamp, digest, signature, signer });
}

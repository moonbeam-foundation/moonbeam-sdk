/**
 * @moonbeam-foundation/sdk/attest: every step this SDK handles (a grade, an assurance settle, a resale step) comes with
 * its attested mark, its on-chain attestation and its stamp, as unsigned calls. Recording is ON by default and aims at
 * Base (8453), Moonbeam's network; name other networks with `networks`, or turn it off with `networks: 'none'` (the mark
 * is still returned). A contract a network does not have is listed in `missing`, with no call: today Base has the
 * decision log and the answer log, and no stamp registry, so a stamp on Base comes back as missing.
 *
 * The helper is the shared one (vendored byte for byte inside src/assurance/assurance-shared.ts, sha-pinned); this module
 * only sets the Moonbeam default.
 */
import { attest as sharedAttest, ATTEST_TARGETS, decisionSubjectOf, stampSubjectOf, attestKeccak, attestCanonical, stampVerdictOfEnding,
  type AttestInput, type AttestOptions, type Attested, type AttestCall, type AttestMissing, type StampVerdict } from '../assurance/assurance-shared.js';

/** Moonbeam's default: Base only */
export const MOONBEAM_ATTEST_NETWORKS = Object.freeze([8453] as const);
export type MoonbeamAttestOptions = Omit<AttestOptions, 'profile'>;

/** the mark, the attestation and the stamp of one step; Base by default */
export const attest = (input: AttestInput, opts: MoonbeamAttestOptions = {}): Attested => sharedAttest(input, { profile: 'moonbeam', ...opts });

export { ATTEST_TARGETS, decisionSubjectOf, stampSubjectOf, attestKeccak, attestCanonical, stampVerdictOfEnding };
export type { AttestInput, AttestOptions, Attested, AttestCall, AttestMissing, StampVerdict };

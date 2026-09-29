/**
 * Minimal hex primitives for ABI word-walking.
 *
 * Every ACP event field the SDK decodes is a fixed 32-byte word — bytes32,
 * address, uint256, uint64, uint8, bool — so a word-slicer is all that is
 * needed. Pulling in a full ABI decoder to read fixed words would add a runtime
 * dependency to what is otherwise a zero-dependency package.
 */

export type Hex = `0x${string}`;
export type Address = Hex;
export type Hex32 = Hex;

const HEX_RE = /^0x[0-9a-fA-F]*$/;

export function isHex(value: unknown): value is Hex {
  return typeof value === 'string' && HEX_RE.test(value);
}

/** Strip the 0x prefix. Returns '' for '0x' or a non-hex input. */
export function body(value: string | undefined): string {
  if (!value || !isHex(value)) return '';
  return value.slice(2);
}

/** The i-th 32-byte word of a hex body, or '' when the body is too short. */
export function word(hexBody: string, i: number): string {
  const start = i * 64;
  const end = start + 64;
  return hexBody.length >= end ? hexBody.slice(start, end) : '';
}

/** Last 20 bytes of a word, lowercased — the ABI encoding of an address. */
export function asAddress(rawWord: string): Address {
  return `0x${rawWord.slice(24).toLowerCase()}` as Address;
}

/** A whole word as an unsigned integer. */
export function asUint(rawWord: string): bigint {
  return rawWord ? BigInt(`0x${rawWord}`) : 0n;
}

/** A whole word as a number. Use only for values known to be small (uint8, timestamps). */
export function asNumber(rawWord: string): number {
  return Number(asUint(rawWord));
}

export function asBool(rawWord: string): boolean {
  return asUint(rawWord) !== 0n;
}

/** A word kept as bytes32, lowercased. */
export function asHex32(rawWord: string): Hex32 {
  return `0x${rawWord.toLowerCase()}` as Hex32;
}

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/** Case-insensitive address comparison. Addresses arrive in mixed casing. */
export function sameAddress(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

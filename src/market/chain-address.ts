// How an account is written on each chain: the pattern of its CAIP-2 namespace, from the coordination layer's chain kinds (vendored
// as ./chain-kinds.json, pinned, typed as ./chain-kinds-data.ts by npm run sync). A NEAR agent market seller is named by its NEAR
// account id, an EVM seller by its 20-byte address. The same accessor as the layer's web door (lib/chain-address.ts).
import { CHAIN_ADDRESSES } from './chain-kinds-data.js';

export type AddressFormat = { namespace: string; family: string; pattern: string; what: string };
const FORMATS: Record<string, AddressFormat> = CHAIN_ADDRESSES;

/** the CAIP-2 namespace of a chain as a handshake names it: '8453' and 8453 are eip155, 'near:mainnet' is near. Pure. */
export function namespaceOf(chain: string | number | null | undefined): string {
  const c = String(chain ?? '').trim();
  return /^\d+$/.test(c) ? 'eip155' : c.split(':')[0] ?? '';
}

/** how an account is written on that chain, or null when the register names no format for its namespace. Pure. */
export function addressFormatOf(chain: string | number | null | undefined): AddressFormat | null {
  return FORMATS[namespaceOf(chain)] ?? null;
}

/** true when `address` is an account of that chain's namespace. Pure. */
export function accountOk(chain: string | number | null | undefined, address: unknown): boolean {
  const f = addressFormatOf(chain);
  return f !== null && typeof address === 'string' && new RegExp(f.pattern).test(address);
}

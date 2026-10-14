/**
 * @moonbeam-foundation/sdk/x402: pay an x402 wall on Base with USDC, unsigned.
 *
 *   baseAccept(body)                 the `exact` entry on Base (eip155:8453) of a 402 answer's accepts[]; others refused
 *   transferAuthorization(a, o)      the EIP-3009 TransferWithAuthorization typed data for that entry: your wallet signs
 *                                    it (eth_signTypedData_v4); nothing here holds a key
 *   paymentHeader(a, auth, sig)      the X-PAYMENT header value (base64 JSON) the wall takes with the signature
 *   quoteWall(t, path)               GET a wall and read its 402 (no payment is made)
 *   subscribe(t, plan)               POST /v1/access/subscribe (subscribePlan from ./resale): its 402 is the top-up quote
 *
 * Base only (the Moonbeam profile): an entry on another network is refused, not converted.
 */
import type { OnboardTransport } from '../onboard/index.js';
import { REGISTRY } from '../acp/moonbeam-acp.generated.js';
import { subscribePlan } from '../resale/index.js';

export const X402_BASE_NETWORK = 'eip155:8453' as const;
export type X402Accept = {
  scheme: string; network: string; amount?: string; maxAmountRequired?: string; asset: string; payTo: string; maxTimeoutSeconds: number;
  resource?: string; description?: string; extra?: { name?: string; version?: string } & Record<string, unknown>;
};
export type X402Body = { x402Version: number; accepts: X402Accept[]; resource?: unknown; error?: string };
export type Authorization = { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string };
export type TransferWithAuthorizationTypedData = {
  domain: { name: string; version: string; chainId: 8453; verifyingContract: string };
  types: { TransferWithAuthorization: { name: string; type: string }[] };
  primaryType: 'TransferWithAuthorization';
  message: Authorization;
};

const ADDR = /^0x[0-9a-fA-F]{40}$/;
/** the x402 body inside a wall's 402 answer (`{ x402: {…} }` or the bare body) */
export function x402Of(answer: unknown): X402Body {
  const o = answer as { x402?: X402Body; accepts?: unknown } | null;
  const b = (o && 'x402' in o && o.x402 ? o.x402 : o) as X402Body | null;
  if (!b || !Array.isArray(b.accepts)) throw new Error('not an x402 answer: no accepts[]');
  return b;
}
/** the `exact` USDC entry on Base; anything else is refused (Base only) */
export function baseAccept(answer: unknown): X402Accept {
  const b = x402Of(answer);
  const a = b.accepts.find((x) => x.scheme === 'exact' && (x.network === X402_BASE_NETWORK || x.network === 'base'));
  if (!a) throw new Error(`the wall offers no exact payment on Base (networks: ${b.accepts.map((x) => x.network).join(', ') || 'none'})`);
  if (a.asset.toLowerCase() !== REGISTRY.usdc.toLowerCase()) throw new Error(`the Base entry asks for ${a.asset}, not USDC on Base`);
  if (!ADDR.test(a.payTo)) throw new Error(`payTo ${a.payTo} is not an address`);
  return a;
}
const amountOf = (a: X402Accept): bigint => BigInt(a.amount ?? a.maxAmountRequired ?? (() => { throw new Error('the entry names no amount'); })());

const hex32 = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
/** a fresh 32-byte nonce (crypto.getRandomValues) */
export const randomNonce = (): string => hex32(globalThis.crypto.getRandomValues(new Uint8Array(32)));

/** The EIP-3009 typed data for one Base entry. validAfter defaults to 0, validBefore to now + maxTimeoutSeconds. */
export function transferAuthorization(a: X402Accept, o: { from: string; nonce?: string; now?: number; validAfter?: number; validBefore?: number }): TransferWithAuthorizationTypedData {
  if (!ADDR.test(o.from)) throw new Error(`from ${o.from} is not an address`);
  if (a.network !== X402_BASE_NETWORK && a.network !== 'base') throw new Error('Base only: this entry is on ' + a.network);
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const nonce = o.nonce ?? randomNonce();
  if (!/^0x[0-9a-fA-F]{64}$/.test(nonce)) throw new Error('the nonce is 32 bytes');
  return {
    domain: { name: a.extra?.name ?? 'USD Coin', version: a.extra?.version ?? '2', chainId: 8453, verifyingContract: a.asset },
    types: { TransferWithAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    ] },
    primaryType: 'TransferWithAuthorization',
    message: { from: o.from, to: a.payTo, value: amountOf(a).toString(), validAfter: String(o.validAfter ?? 0), validBefore: String(o.validBefore ?? now + a.maxTimeoutSeconds), nonce },
  };
}

/** The X-PAYMENT header value: base64 of { x402Version, scheme, network, payload: { signature, authorization } } */
export function paymentHeader(a: X402Accept, authorization: Authorization, signature: string, x402Version = 2): string {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('the signature is 65 bytes (0x + 130 hex)');
  const json = JSON.stringify({ x402Version, scheme: a.scheme, network: a.network, payload: { signature, authorization } });
  return typeof Buffer !== 'undefined' ? Buffer.from(json, 'utf8').toString('base64') : btoa(json);
}

/** GET a wall and return its 402 quote (Base entry + the whole body). Nothing is paid. */
export async function quoteWall(t: OnboardTransport, path: string): Promise<{ status: number; accept: X402Accept; body: X402Body }> {
  const r = await t.fetch(`${t.base}${path.startsWith('/') ? path : `/${path}`}`, { method: 'GET', headers: { accept: 'application/json', ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) } });
  const j = await r.json().catch(() => null);
  if (r.status !== 402) throw new Error(`expected a 402 quote, got ${r.status}`);
  const body = x402Of(j);
  return { status: r.status, accept: baseAccept(body), body };
}

/** POST /v1/access/subscribe with a subscribePlan(): the layer answers with the top-up's x402 quote (a 402) */
export async function subscribe(t: OnboardTransport, plan: ReturnType<typeof subscribePlan> = subscribePlan()): Promise<{ status: number; accept: X402Accept | null; body: unknown }> {
  const r = await t.fetch(`${t.base}${plan.path}`, { method: plan.method, headers: { 'content-type': 'application/json', accept: 'application/json', ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) }, body: JSON.stringify(plan.body) });
  const body = await r.json().catch(() => null);
  let accept: X402Accept | null = null;
  if (r.status === 402) accept = baseAccept(body);
  return { status: r.status, accept, body };
}
export { subscribePlan };

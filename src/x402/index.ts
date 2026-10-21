/**
 * @moonbeam-foundation/sdk/x402: pay an x402 wall, unsigned. The wall's 402 lists one `accepts` entry per network it
 * settles on (Base, Arbitrum, Arc, Robinhood Chain, Monad, Solana, …); you choose the entry by network, and every leg of
 * the payment (network, token, payTo, amount) is the entry's own, never assumed.
 *
 *   pickAccept(body, { network })    the `exact` entry on the network you pay from (a CAIP-2 id, a v1 name such as `base`,
 *                                    or a preference list); Base when you name none
 *   baseAccept(body)                 pickAccept on Base, with the USDC check (0.7.0's call, unchanged)
 *   x402Of / x402FromHeader          the 402 body (`{ x402: {…} }`, the bare body, or the base64 PAYMENT-REQUIRED header)
 *   transferAuthorization(a, o)      the EIP-3009 TransferWithAuthorization typed data for an EVM entry (chain id from the
 *                                    entry's network): your wallet signs it (eth_signTypedData_v4); nothing here holds a key
 *   paymentPayload / paymentHeader   x402 v2: { x402Version: 2, accepted: <the entry>, payload: { signature, authorization } },
 *                                    base64; v1 (x402Version 1): { x402Version, scheme, network, payload }
 *   paymentHeaders(a, auth, sig)     the request headers: PAYMENT-SIGNATURE (v2); X-PAYMENT for v1, or beside it with legacy
 *   quoteWall(t, path, o)            GET a wall and read its 402 (no payment is made)
 *   subscribe(t, plan, o)            POST /v1/access/subscribe (subscribePlan from ./resale): its 402 is the top-up quote;
 *                                    another refusal comes back as `refusal` (./errors), never thrown
 *
 * A Solana entry is an SPL transfer the payer's Solana wallet builds: it is picked and returned like any other entry, and
 * transferAuthorization refuses it rather than build the wrong thing.
 */
import type { OnboardTransport } from '../onboard/index.js';
import { REGISTRY } from '../acp/moonbeam-acp.generated.js';
import { subscribePlan } from '../resale/index.js';
import { CoordError, jsonOf, refusalOf, type Refusal } from '../errors/index.js';

export const X402_BASE_NETWORK = 'eip155:8453' as const;
export const X402_SOLANA_NETWORK = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
/** x402 v1 network names → CAIP-2 (the layer's settle rule spells them the same way) */
export const NETWORK_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  base: 'eip155:8453', 'base-sepolia': 'eip155:84532', arbitrum: 'eip155:42161', polygon: 'eip155:137', avalanche: 'eip155:43114',
  monad: 'eip155:143', robinhood: 'eip155:4663', arc: 'eip155:5042', solana: X402_SOLANA_NETWORK,
});
/** the header an x402 v2 payment travels in */
export const PAYMENT_HEADER = 'PAYMENT-SIGNATURE' as const;
/** the x402 v1 header; walls that speak v2 still read it */
export const LEGACY_PAYMENT_HEADER = 'X-PAYMENT' as const;

export type X402Accept = {
  scheme: string; network: string; amount?: string; maxAmountRequired?: string; asset: string; payTo: string; maxTimeoutSeconds: number;
  resource?: string; description?: string; mimeType?: string; extra?: { name?: string; version?: string; feePayer?: string } & Record<string, unknown>;
};
export type X402Body = { x402Version: number; accepts: X402Accept[]; resource?: unknown; error?: string };
export type Authorization = { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string };
export type TransferWithAuthorizationTypedData = {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  types: { TransferWithAuthorization: { name: string; type: string }[] };
  primaryType: 'TransferWithAuthorization';
  message: Authorization;
};

const ADDR = /^0x[0-9a-fA-F]{40}$/;
/** a network as CAIP-2 (`base` → `eip155:8453`); unknown names are returned as given */
export const caipOf = (network: string): string => NETWORK_ALIASES[network] ?? network;
/** the EVM chain id of a network (`eip155:<id>` or a v1 name), or null for a non-EVM network */
export function chainIdOf(network: string): number | null {
  const m = /^eip155:(\d+)$/.exec(caipOf(network));
  return m ? Number(m[1]) : null;
}

/** the x402 body inside a wall's 402 answer (`{ x402: {…} }` or the bare body) */
export function x402Of(answer: unknown): X402Body {
  const o = answer as { x402?: X402Body; accepts?: unknown } | null;
  const b = (o && typeof o === 'object' && 'x402' in o && o.x402 ? o.x402 : o) as X402Body | null;
  if (!b || !Array.isArray(b.accepts)) throw new Error('not an x402 answer: no accepts[]');
  return b;
}
/** the x402 body carried in a 402's PAYMENT-REQUIRED header (base64 JSON) */
export function x402FromHeader(value: string): X402Body {
  const json = typeof Buffer !== 'undefined' ? Buffer.from(value, 'base64').toString('utf8') : atob(value);
  return x402Of(JSON.parse(json));
}

/**
 * The `exact` entry on the network you pay from. `network` is one network or a preference list (CAIP-2 ids or v1 names);
 * the first network in the list the wall offers wins. Base when none is named. On Base the asset must be USDC.
 */
export function pickAccept(answer: unknown, o: { network?: string | readonly string[]; scheme?: string } = {}): X402Accept {
  const b = x402Of(answer);
  const want = (o.network === undefined ? [X402_BASE_NETWORK] : typeof o.network === 'string' ? [o.network] : [...o.network]).map(caipOf);
  if (!want.length) throw new RangeError('name at least one network');
  const scheme = o.scheme ?? 'exact';
  let a: X402Accept | undefined;
  for (const n of want) { a = b.accepts.find((x) => x.scheme === scheme && caipOf(x.network) === n); if (a) break; }
  if (!a) throw new Error(`the wall offers no ${scheme} payment on ${want.map((n) => (n === X402_BASE_NETWORK ? `Base (${n})` : n)).join(' or ')} (it offers: ${b.accepts.map((x) => x.network).join(', ') || 'none'})`);
  const net = caipOf(a.network);
  if (net === X402_BASE_NETWORK && a.asset.toLowerCase() !== REGISTRY.usdc.toLowerCase()) throw new Error(`the Base entry asks for ${a.asset}, not USDC on Base`);
  if (net.startsWith('eip155:') && !ADDR.test(a.payTo)) throw new Error(`payTo ${a.payTo} is not an address`);
  if (!a.payTo) throw new Error('the entry names no payTo');
  return a;
}
/** the `exact` USDC entry on Base; anything else is refused */
export const baseAccept = (answer: unknown): X402Accept => pickAccept(answer, { network: X402_BASE_NETWORK });

const amountOf = (a: X402Accept): bigint => BigInt(a.amount ?? a.maxAmountRequired ?? (() => { throw new Error('the entry names no amount'); })());

const hex32 = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
/** a fresh 32-byte nonce (crypto.getRandomValues) */
export const randomNonce = (): string => hex32(globalThis.crypto.getRandomValues(new Uint8Array(32)));

/** The EIP-3009 typed data for one EVM entry, on the entry's own chain. validAfter defaults to 0, validBefore to now + maxTimeoutSeconds. */
export function transferAuthorization(a: X402Accept, o: { from: string; nonce?: string; now?: number; validAfter?: number; validBefore?: number }): TransferWithAuthorizationTypedData {
  if (!ADDR.test(o.from)) throw new Error(`from ${o.from} is not an address`);
  const chainId = chainIdOf(a.network);
  if (chainId === null) throw new Error(`the entry on ${a.network} is not an EIP-3009 transfer: pay it with that network's own wallet transaction`);
  if (!ADDR.test(a.asset) || !ADDR.test(a.payTo)) throw new Error('an EVM entry names an asset and a payTo address');
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const nonce = o.nonce ?? randomNonce();
  if (!/^0x[0-9a-fA-F]{64}$/.test(nonce)) throw new Error('the nonce is 32 bytes');
  return {
    domain: { name: a.extra?.name ?? 'USD Coin', version: a.extra?.version ?? '2', chainId, verifyingContract: a.asset },
    types: { TransferWithAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    ] },
    primaryType: 'TransferWithAuthorization',
    message: { from: o.from, to: a.payTo, value: amountOf(a).toString(), validAfter: String(o.validAfter ?? 0), validBefore: String(o.validBefore ?? now + a.maxTimeoutSeconds), nonce },
  };
}

export type PaymentPayloadV2 = { x402Version: 2; accepted: X402Accept; payload: { signature: string; authorization: Authorization }; resource?: unknown };
export type PaymentPayloadV1 = { x402Version: 1; scheme: string; network: string; payload: { signature: string; authorization: Authorization } };

/** The payment payload: v2 carries the accepted entry whole (`accepted`); v1 names scheme and network. */
export function paymentPayload(a: X402Accept, authorization: Authorization, signature: string, x402Version: 1 | 2 = 2, resource?: unknown): PaymentPayloadV1 | PaymentPayloadV2 {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('the signature is 65 bytes (0x + 130 hex)');
  if (x402Version === 1) return { x402Version: 1, scheme: a.scheme, network: a.network, payload: { signature, authorization } };
  return { x402Version: 2, accepted: a, payload: { signature, authorization }, ...(resource !== undefined ? { resource } : {}) };
}
const b64 = (json: string) => (typeof Buffer !== 'undefined' ? Buffer.from(json, 'utf8').toString('base64') : btoa(json));
/** The header value (base64 JSON of paymentPayload). Send it as PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1): see paymentHeaders. */
export function paymentHeader(a: X402Accept, authorization: Authorization, signature: string, x402Version: 1 | 2 = 2): string {
  return b64(JSON.stringify(paymentPayload(a, authorization, signature, x402Version)));
}
/** The request headers that carry the payment: PAYMENT-SIGNATURE for v2 (plus X-PAYMENT with `legacy`), X-PAYMENT for v1. */
export function paymentHeaders(a: X402Accept, authorization: Authorization, signature: string, o: { x402Version?: 1 | 2; legacy?: boolean } = {}): Record<string, string> {
  const v = o.x402Version ?? 2;
  const value = paymentHeader(a, authorization, signature, v);
  return v === 1 ? { [LEGACY_PAYMENT_HEADER]: value } : { [PAYMENT_HEADER]: value, ...(o.legacy ? { [LEGACY_PAYMENT_HEADER]: value } : {}) };
}

type Answer = { readonly ok: boolean; readonly status: number; json(): Promise<unknown>; readonly headers?: { get(name: string): string | null } };
/** the 402 body of an answer: the JSON body, else the PAYMENT-REQUIRED header */
function challengeOf(r: Answer, body: unknown): X402Body {
  try { return x402Of(body); } catch (e) {
    const h = r.headers?.get('payment-required');
    if (h) return x402FromHeader(h);
    throw e;
  }
}

/** GET a wall and return its 402 quote (the entry on your network, Base by default, and the whole body). Nothing is paid. */
export async function quoteWall(t: OnboardTransport, path: string, o: { network?: string | readonly string[] } = {}): Promise<{ status: number; accept: X402Accept; body: X402Body }> {
  const r = (await t.fetch(`${t.base}${path.startsWith('/') ? path : `/${path}`}`, { method: 'GET', headers: { accept: 'application/json', ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) } })) as Answer;
  const j = await jsonOf(r);
  if (r.status !== 402) throw new CoordError(refusalOf(j, r.status, `expected a 402 quote, got ${r.status}`));
  const body = challengeOf(r, j);
  return { status: r.status, accept: pickAccept(body, o), body };
}

/** POST /v1/access/subscribe with a subscribePlan(): the layer answers with the top-up's x402 quote (a 402) */
export async function subscribe(t: OnboardTransport, plan: ReturnType<typeof subscribePlan> = subscribePlan(), o: { network?: string | readonly string[] } = {}): Promise<{ status: number; accept: X402Accept | null; body: unknown; refusal: Refusal | null }> {
  const r = (await t.fetch(`${t.base}${plan.path}`, { method: plan.method, headers: { 'content-type': 'application/json', accept: 'application/json', ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) }, body: JSON.stringify(plan.body) })) as Answer;
  const body = await jsonOf(r);
  let accept: X402Accept | null = null;
  if (r.status === 402) accept = pickAccept(challengeOf(r, body), o.network === undefined ? { network: `eip155:${plan.body.chainId}` } : o);
  const refusal = r.status !== 402 && !r.ok ? refusalOf(body, r.status, `POST ${plan.path} → ${r.status}`) : null;
  return { status: r.status, accept, body, refusal };
}
export { subscribePlan };

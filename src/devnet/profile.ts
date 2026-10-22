/**
 * The devnet profile: where a test network lives, resolved at runtime.
 *
 * This package ships no test-network address, RPC URL or explorer link. A profile is put together when it is used, from
 * three sources in this order:
 *
 *   1. the options object you pass;
 *   2. the environment (`MOONBEAM_DEVNET_*`, see DEVNET_ENV);
 *   3. the coordination API's own registry: `GET /pools/networks` lists every pool line with its chain, factory, hook and
 *      asset, and marks test networks with `network: "devnet"`.
 *
 * The RPC comes from options, the environment, or the API's RPC rotation (`GET /rpc/:chainId` → `best`). The gas faucet and
 * the transaction-link template come from options or the environment only. The chain id, the hook, the pool factory and the
 * GLMR test token may come from any source; the evaluator adapter from options, the environment, or a quote
 * (`withQuote`). Every field carries the source it came from, so a test can say where its numbers were read.
 */
import { isAddress } from '../onboard/index.js';
import type { Address } from '../onboard/index.js';
import { OnboardError } from '../onboard/index.js';
import type { OnboardTransport } from '../onboard/index.js';

/** The environment names a profile reads. None is required when the options or the API supply the field. */
export const DEVNET_ENV = Object.freeze({
  api: 'MOONBEAM_API',
  apiKey: 'MOONBEAM_API_KEY',
  chainId: 'MOONBEAM_DEVNET_CHAIN_ID',
  rpc: 'MOONBEAM_DEVNET_RPC',
  faucet: 'MOONBEAM_DEVNET_FAUCET',
  txLink: 'MOONBEAM_DEVNET_TX_LINK',
  hook: 'MOONBEAM_DEVNET_HOOK',
  factory: 'MOONBEAM_DEVNET_FACTORY',
  token: 'MOONBEAM_DEVNET_TOKEN',
  adapter: 'MOONBEAM_DEVNET_ADAPTER',
  line: 'MOONBEAM_DEVNET_LINE',
} as const);

export type Source = 'options' | 'env' | 'layer';
export interface Sourced<T> { value: T; from: Source }

export interface DevnetContracts {
  /** the hook the GLMR line settles on */
  hook: Address;
  /** the pool factory of the GLMR line (one pool per seller and asset) */
  factory: Address;
  /** the GLMR test token: 18 decimals, mint-anyone on a test network */
  token: Address;
  /** the evaluator adapter the hook accepts (null until a quote names it, or the options do) */
  adapter: Address | null;
}

export interface DevnetProfile {
  chainId: number;
  /** JSON-RPC URL: options, env, or the API's RPC rotation */
  rpc: string;
  /** the gas faucet's base URL (`POST <faucet>/claim { address }`); options or env only; null when none is configured */
  faucet: string | null;
  /** the transaction link template, `{hash}` and `{chain}` replaced; options or env only; null when none */
  txLink: string | null;
  /** the line key the layer names (e.g. a GLMR line) */
  line: string;
  token: { address: Address; symbol: string; decimals: number };
  contracts: DevnetContracts;
  /** where each field came from */
  sources: Record<'chainId' | 'rpc' | 'faucet' | 'txLink' | 'line' | 'hook' | 'factory' | 'token' | 'adapter', Source | null>;
}

export interface DevnetProfileOptions {
  chainId?: number;
  rpc?: string;
  faucet?: string;
  txLink?: string;
  line?: string;
  contracts?: Partial<DevnetContracts>;
  /** read the API's registry for whatever options and env leave open; default true when a transport is given */
  layer?: boolean;
  /** an env map; default `process.env` when it exists */
  env?: Record<string, string | undefined>;
}

/** One row of `GET /pools/networks` → `supported[]`. */
export type NetworkRow = { chain_id: number; network?: string; line?: string; default?: boolean; factory?: string; hook?: string; status?: string; assets?: { symbol?: string; address?: string; decimals?: number }[] };

export class DevnetProfileError extends Error {
  constructor(readonly missing: string[], message: string) { super(message); this.name = 'DevnetProfileError'; }
}

const envOf = (o: DevnetProfileOptions): Record<string, string | undefined> =>
  o.env ?? ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {});
const clean = (v: string | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined);
const GLMR = /GLMR$/i;

/**
 * The GLMR line of a test network in the API's registry: a `supported` row with `network: "devnet"` whose asset is a GLMR
 * token. When `chainId` or `line` is given, the row must match it. Pure.
 */
export function devnetLineOf(rows: readonly NetworkRow[], want: { chainId?: number; line?: string } = {}): NetworkRow | null {
  const fit = rows.filter((r) => r.network === 'devnet'
    && (want.chainId === undefined || Number(r.chain_id) === want.chainId)
    && (want.line === undefined || r.line === want.line)
    && (r.assets ?? []).some((a) => GLMR.test(String(a.symbol ?? '')) && isAddress(a.address)));
  return fit.find((r) => r.status === 'open') ?? fit[0] ?? null;
}

/** Read the registry rows (`GET /pools/networks`). Throws OnboardError on a refusal. */
export async function readNetworks(t: OnboardTransport): Promise<NetworkRow[]> {
  const r = await t.fetch(`${t.base}/pools/networks`, { method: 'GET', headers: { accept: 'application/json', ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) } });
  const j = (await r.json().catch(() => null)) as { supported?: NetworkRow[] } | null;
  if (!r.ok) throw new OnboardError(r.status, `GET /pools/networks → ${r.status}`, j);
  return Array.isArray(j?.supported) ? j.supported : [];
}

/**
 * Put a devnet profile together: options, then env, then the API's registry. Throws DevnetProfileError naming every field
 * that no source supplied. The RPC is never taken from the API.
 */
export async function devnetProfile(o: DevnetProfileOptions = {}, t?: OnboardTransport): Promise<DevnetProfile> {
  const env = envOf(o);
  const pick = <T>(opt: T | undefined, envVal: T | undefined): Sourced<T> | null =>
    opt !== undefined ? { value: opt, from: 'options' } : envVal !== undefined ? { value: envVal, from: 'env' } : null;
  const envNum = clean(env[DEVNET_ENV.chainId]);
  const envAddr = (k: keyof typeof DEVNET_ENV): Address | undefined => { const v = clean(env[DEVNET_ENV[k]]); return v && isAddress(v) ? v : undefined; };

  const chainId = pick(o.chainId, envNum && /^\d+$/.test(envNum) ? Number(envNum) : undefined);
  const rpc = pick(clean(o.rpc), clean(env[DEVNET_ENV.rpc]));
  const faucet = pick(clean(o.faucet), clean(env[DEVNET_ENV.faucet]));
  const txLink = pick(clean(o.txLink), clean(env[DEVNET_ENV.txLink]));
  const lineKey = pick(clean(o.line), clean(env[DEVNET_ENV.line]));
  const hook = pick(o.contracts?.hook, envAddr('hook'));
  const factory = pick(o.contracts?.factory, envAddr('factory'));
  const token = pick(o.contracts?.token, envAddr('token'));
  const adapter = pick(o.contracts?.adapter ?? undefined, envAddr('adapter'));

  let row: NetworkRow | null = null;
  const needLayer = !chainId || !hook || !factory || !token || !lineKey;
  if (t && o.layer !== false && needLayer) {
    row = devnetLineOf(await readNetworks(t), { ...(chainId ? { chainId: chainId.value } : {}), ...(lineKey ? { line: lineKey.value } : {}) });
  }
  const glmr = row?.assets?.find((a) => GLMR.test(String(a.symbol ?? '')) && isAddress(a.address)) ?? null;
  const fromLayer = <T>(s: Sourced<T> | null, v: T | null | undefined): Sourced<T> | null => s ?? (v !== null && v !== undefined ? { value: v, from: 'layer' } : null);

  const cId = fromLayer(chainId, row ? Number(row.chain_id) : null);
  let rpcV = rpc;
  if (!rpcV && cId && t && o.layer !== false) rpcV = fromLayer(null, await readRpc(t, cId.value).catch(() => null));
  const ln = fromLayer(lineKey, row?.line ?? null);
  const hk = fromLayer(hook, row && isAddress(row.hook) ? row.hook : null);
  const fc = fromLayer(factory, row && isAddress(row.factory) ? row.factory : null);
  const tk = fromLayer(token, glmr?.address as Address | undefined);

  const missing: string[] = [];
  if (!cId) missing.push(`chainId (${DEVNET_ENV.chainId})`);
  if (!rpcV) missing.push(`rpc (${DEVNET_ENV.rpc})`);
  if (!hk) missing.push(`contracts.hook (${DEVNET_ENV.hook})`);
  if (!fc) missing.push(`contracts.factory (${DEVNET_ENV.factory})`);
  if (!tk) missing.push(`contracts.token (${DEVNET_ENV.token})`);
  if (!ln) missing.push(`line (${DEVNET_ENV.line})`);
  if (missing.length || !cId || !rpcV || !hk || !fc || !tk || !ln) {
    throw new DevnetProfileError(missing, `the devnet profile is missing: ${missing.join(', ')}. Pass them as options, set them in the environment, or give a transport so the API's registry can supply the contracts.`);
  }
  return {
    chainId: cId.value, rpc: rpcV.value, faucet: faucet?.value ?? null, txLink: txLink?.value ?? null, line: ln.value,
    token: { address: tk.value, symbol: String(glmr?.symbol ?? 'GLMR'), decimals: Number(glmr?.decimals ?? 18) },
    contracts: { hook: hk.value, factory: fc.value, token: tk.value, adapter: adapter?.value ?? null },
    sources: { chainId: cId.from, rpc: rpcV.from, faucet: faucet?.from ?? null, txLink: txLink?.from ?? null, line: ln.from, hook: hk.from, factory: fc.from, token: tk.from, adapter: adapter?.from ?? null },
  };
}

/** The best RPC URL the API's rotation names for a chain (`GET /rpc/:chainId` → `best`), or null. */
export async function readRpc(t: OnboardTransport, chainId: number): Promise<string | null> {
  const r = await t.fetch(`${t.base}/rpc/${chainId}`, { method: 'GET', headers: { accept: 'application/json' } });
  const j = (await r.json().catch(() => null)) as { best?: unknown } | null;
  return r.ok && typeof j?.best === 'string' && /^https?:\/\//.test(j.best) ? j.best : null;
}

/** The profile with the evaluator adapter a quote names (`line.evaluator_adapter`), unless options or env already set it. */
export function withQuote(p: DevnetProfile, q: { line?: { evaluator_adapter?: unknown; hook?: unknown } | null } | null): DevnetProfile {
  const a = q?.line?.evaluator_adapter;
  if (p.contracts.adapter || !isAddress(a)) return p;
  return { ...p, contracts: { ...p.contracts, adapter: a }, sources: { ...p.sources, adapter: 'layer' } };
}

/** A transaction link from the profile's template, or null when it has none. */
export function txLinkOf(p: Pick<DevnetProfile, 'txLink' | 'chainId'>, hash: string): string | null {
  return p.txLink ? p.txLink.replace('{chain}', String(p.chainId)).replace('{hash}', hash) : null;
}

/** A transport from the environment: `MOONBEAM_API` (the coordination endpoint, `/v1` included) and `MOONBEAM_API_KEY`. */
export function transportFromEnv(env?: Record<string, string | undefined>, f: OnboardTransport['fetch'] = (u, i) => fetch(u, i)): OnboardTransport {
  const e = env ?? envOf({});
  const base = clean(e[DEVNET_ENV.api]);
  if (!base) throw new DevnetProfileError([DEVNET_ENV.api], `set ${DEVNET_ENV.api} to your coordination endpoint (with /v1)`);
  const apiKey = clean(e[DEVNET_ENV.apiKey]);
  return { base: base.replace(/\/$/, ''), fetch: f, ...(apiKey ? { apiKey } : {}) };
}

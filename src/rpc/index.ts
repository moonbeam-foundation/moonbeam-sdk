/**
 * @moonbeam-foundation/sdk/rpc: one injectable Base reader. By default it walks warmbed's measured rotation of Base
 * endpoints (the same reader @taifoon/jev uses: warmbed first, then a static fallback list), so a rate-limited or
 * range-capped public endpoint moves the call to the next one instead of failing it. A revert is an answer and is
 * thrown at once. BASE_RPC (a comma list) or `urls` goes first. Reads only: nothing here signs or sends.
 */
import { rpcRotation } from '@taifoon/jev';

export const BASE_CHAIN_ID = 8453 as const;
export type RpcNeed = 'call' | 'logs';
export interface BaseReader {
  readonly chainId: typeof BASE_CHAIN_ID;
  /** the endpoints this reader would try, best first */
  urls(need?: RpcNeed): Promise<string[]>;
  /** one JSON-RPC call; `need: 'logs'` picks endpoints proven to serve eth_getLogs windows */
  call<T = unknown>(method: string, params: readonly unknown[], need?: RpcNeed): Promise<T>;
}
export class RpcReverted extends Error { override name = 'RpcReverted'; constructor(message: string, readonly data: string | null) { super(message); } }

const REVERT = /revert|invalid opcode|out of gas/i;
const env = (k: string): string | undefined => (typeof process !== 'undefined' ? process.env[k] : undefined);

/** A Base reader over warmbed's rotation (default), or over the endpoints you name. */
export function baseReader(o: { urls?: readonly string[]; fetch?: typeof fetch; timeoutMs?: number; warmbed?: boolean } = {}): BaseReader {
  const f = o.fetch ?? fetch;
  const pinned = [...(o.urls ?? []), ...String(env('BASE_RPC') ?? '').split(',').map((s) => s.trim()).filter(Boolean)];
  const urls = async (need: RpcNeed = 'call') => [...new Set([...pinned, ...(o.warmbed === false ? [] : await rpcRotation(BASE_CHAIN_ID, f, need))])];
  return {
    chainId: BASE_CHAIN_ID,
    urls,
    async call<T>(method: string, params: readonly unknown[], need: RpcNeed = 'call'): Promise<T> {
      const list = await urls(need);
      if (!list.length) throw new Error(`${method}: no Base endpoint (warmbed silent and none named)`);
      let last = '';
      for (const u of list) {
        try {
          const r = await f(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(o.timeoutMs ?? 20_000) });
          if (r.status >= 400) { last = `${new URL(u).host}: http ${r.status}`; continue; }
          const j = (await r.json()) as { result?: T; error?: { message?: string; code?: number; data?: unknown } };
          if (j.error) {
            const msg = String(j.error.message ?? j.error.code);
            if (j.error.code === 3 || REVERT.test(msg)) throw new RpcReverted(`${method}: ${msg}`, typeof j.error.data === 'string' ? j.error.data : null);
            last = `${new URL(u).host}: ${msg.slice(0, 160)}`; continue;
          }
          return j.result as T;
        } catch (e) {
          if (e instanceof RpcReverted) throw e;
          last = `${(() => { try { return new URL(u).host; } catch { return u; } })()}: ${(e as Error).message.slice(0, 160)}`;
        }
      }
      throw new Error(`${method}: every Base endpoint failed (last: ${last})`);
    },
  };
}

/** eth_call on Base: the return data, or RpcReverted with the revert data */
export const ethCall = (r: BaseReader, to: string, data: string, block: string = 'latest'): Promise<string> => r.call<string>('eth_call', [{ to, data }, block]);

/**
 * Sending the SDK's unsigned calls through a wallet, with the call's chain enforced.
 *
 * Every UnsignedCall names its `chainId`. A wallet signs on whatever chain it is on, so a call built for Base and signed on
 * another chain lands somewhere else (or replays there). `sendCalls` reads the wallet's chain before EVERY call and refuses
 * one whose chain differs (ChainMismatchError), unless `switchChain` is set: then it asks the wallet to switch
 * (wallet_switchEthereumChain) and reads the chain again before it sends. Each transaction also carries `chainId`, so a wallet
 * that checks it refuses a mismatch on its own. The next call is sent only once the previous one's receipt reads success.
 *
 * The provider is any EIP-1193 `request` (an injected wallet, a WalletConnect session, viem's `transport.request`). Nothing
 * here holds a key.
 */
import type { UnsignedCall } from './index.js';

export interface Eip1193Provider { request(args: { method: string; params?: readonly unknown[] }): Promise<unknown> }

export interface SendOptions {
  /** the account that signs; read from eth_accounts when left out */
  from?: `0x${string}`;
  /** ask the wallet to switch to the call's chain instead of refusing (it is read again before the send) */
  switchChain?: boolean;
  /** how long to wait for each receipt, in ms (default 180 000) */
  receiptTimeoutMs?: number;
  /** between receipt reads, in ms (default 2 000) */
  pollMs?: number;
  /** called after each call is sent and its receipt read */
  onSent?: (c: UnsignedCall, hash: `0x${string}`) => void;
}

export class ChainMismatchError extends Error {
  override name = 'ChainMismatchError';
  constructor(readonly expected: number, readonly actual: number, readonly step: string) {
    super(`refused: ${step} is built for chain ${expected}, but the wallet is on chain ${actual}; nothing was sent`);
  }
}

/** Refuse a call whose chain is not `chainId` (the wallet's, as read). Pure. */
export function assertCallChain(c: Pick<UnsignedCall, 'chainId' | 'step'>, chainId: number): void {
  if (!Number.isSafeInteger(c.chainId) || c.chainId <= 0) throw new RangeError(`${c.step}: the call names no chain`);
  if (c.chainId !== chainId) throw new ChainMismatchError(c.chainId, chainId, c.step);
}

const chainOf = async (p: Eip1193Provider): Promise<number> => {
  const v = await p.request({ method: 'eth_chainId' });
  const n = typeof v === 'string' ? Number.parseInt(v, 16) : Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`the wallet reported no chain id (${String(v)})`);
  return n;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send `calls` in order through the wallet; returns the transaction hashes. Refuses (and sends nothing more) on a chain mismatch or a failed receipt. */
export async function sendCalls(p: Eip1193Provider, calls: readonly UnsignedCall[], o: SendOptions = {}): Promise<`0x${string}`[]> {
  let from = o.from;
  if (!from) {
    const accs = (await p.request({ method: 'eth_accounts' })) as string[] | undefined;
    if (!accs?.[0]) throw new Error('the wallet has no connected account');
    from = accs[0] as `0x${string}`;
  }
  const hashes: `0x${string}`[] = [];
  for (const c of calls) {
    let chain = await chainOf(p);
    if (chain !== c.chainId && o.switchChain) {
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${c.chainId.toString(16)}` }] });
      chain = await chainOf(p);
    }
    assertCallChain(c, chain);
    const hash = (await p.request({ method: 'eth_sendTransaction', params: [{ from, to: c.to, data: c.data, value: c.value, chainId: `0x${c.chainId.toString(16)}` }] })) as `0x${string}`;
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`${c.step}: the wallet returned no transaction hash`);
    const until = Date.now() + (o.receiptTimeoutMs ?? 180_000);
    for (;;) {
      const r = (await p.request({ method: 'eth_getTransactionReceipt', params: [hash] })) as { status?: string } | null;
      if (r && r.status !== undefined) {
        if (r.status !== '0x1') throw new Error(`${c.step} reverted (${hash}); the calls after it were not sent`);
        break;
      }
      if (Date.now() > until) throw new Error(`${c.step}: no receipt for ${hash} in time; the calls after it were not sent`);
      await sleep(o.pollMs ?? 2_000);
    }
    hashes.push(hash);
    o.onSent?.(c, hash);
  }
  return hashes;
}

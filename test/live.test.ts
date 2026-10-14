// Live reads on Base and the layer (LIVE=1 npm test): read only, keyless, nothing signed or sent.
import { describe, expect, it } from 'vitest';
import { baseReader } from '../src/rpc/index.js';
import { readProof, verifyOnBase } from '../src/proof/index.js';
import { quoteWall, subscribe } from '../src/x402/index.js';
import { poolsOpenOn } from '../src/pools/index.js';
import { quotaOf } from '../src/onboard/index.js';
import { REGISTRY } from '../src/acp/moonbeam-acp.generated.js';

const LIVE = process.env.LIVE === '1';
const t = { base: 'https://coord.taifoon.dev/v1', fetch: (u: string, i?: RequestInit) => fetch(u, i) } as never;
const TX = '0x48f87043df02dc8f97c3a70afb8c8748848d0efae865cb251c429cce57bc127f'; // Base block 52,587,000

describe.skipIf(!LIVE)('live, read only', () => {
  it('the Base reader answers through warmbed\'s rotation, and the hook has code', async () => {
    const r = baseReader();
    expect((await r.urls()).length).toBeGreaterThan(1);
    expect(Number(await r.call<string>('eth_blockNumber', []))).toBeGreaterThan(52_500_000);
    expect((await r.call<string>('eth_getCode', [REGISTRY.hook, 'latest'])).length).toBeGreaterThan(2);
  }, 60_000);
  it('a Base transaction\'s proof: proven by the layer, and verify(blob) true on the V5 verifier on Base', async () => {
    const p = await readProof(t, TX);
    expect(p.proven).toBe(true);
    const c = await verifyOnBase(baseReader(), p.blob!);
    expect(c).toMatchObject({ verified: true, error: null, anchored: false });
  }, 120_000);
  it('an x402 wall on Base quotes in USDC to the vault, and the subscribe door answers with its 402', async () => {
    const w = await quoteWall(t, '/x402/class/mcp.digest');
    expect(w.accept).toMatchObject({ network: 'eip155:8453', asset: REGISTRY.usdc });
    const s = await subscribe(t);
    expect([402, 200, 429]).toContain(s.status);
    if (s.status === 402) expect(s.accept?.network).toBe('eip155:8453');
  }, 60_000);
  it('pools-open and the judge quota come from the layer', async () => {
    const p = await poolsOpenOn(t);
    expect(p.source).toBe('layer'); expect(p.chains).not.toContain(8453);
    const q = await quotaOf(t);
    expect(q.source).toBe('layer'); expect(q.free).toBeGreaterThan(0);
  }, 60_000);
});

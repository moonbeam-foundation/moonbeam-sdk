// Live reads on Base and the layer (LIVE=1 npm test): read only, keyless, nothing signed or sent.
import { describe, expect, it } from 'vitest';
import { baseReader } from '../src/rpc/index.js';
import { readProof, verifyOnBase } from '../src/proof/index.js';
import { quoteWall, subscribe } from '../src/x402/index.js';
import { poolsOpenOn } from '../src/pools/index.js';
import { quotaOf } from '../src/onboard/index.js';
import { REGISTRY } from '../src/acp/moonbeam-acp.generated.js';
import { pickAccept } from '../src/x402/index.js';
import { quoteCover } from '../src/cover/index.js';
import { readJobs } from '../src/jobs/index.js';
import { CoordError } from '../src/errors/index.js';
import { askSystemOne, answerLogTotals, readJudgeAdapter } from '../src/judge/index.js';

const LIVE = process.env.LIVE === '1';
const t = { base: process.env.MOONBEAM_API ?? 'https://coord.taifoon.dev/v1', fetch: (u: string, i?: RequestInit) => fetch(u, i) } as never;
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
  // 0.8.0
  it('cover/quote with its venue: a devnet job the caller is not the client of is not insurable (an answer, not a throw)', async () => {
    const q = await quoteCover(t, { buyer: '0x0000000000000000000000000000000000000001', job: 1, network: 'devnet' });
    expect(q).toMatchObject({ ok: false, insurable: false });
  }, 60_000);
  it('the wall offers several networks (Solana among them); the Arbitrum entry is picked by network', async () => {
    const w = await quoteWall(t, '/x402/class/mcp.digest', { network: 'arbitrum' });
    expect(w.accept.network).toBe('eip155:42161');
    expect(w.body.accepts.map((a) => a.network)).toContain('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
    expect(pickAccept(w.body).network).toBe('eip155:8453');
  }, 60_000);
  it('the System One door refuses an unknown coordination key in words (a CoordError), and charges nothing', async () => {
    const e = await askSystemOne({ state: 'x', questions: { a: { type: 'noul', instructions: 'y' } }, key: 'k', route: { via: 'coord', base: (t as { base: string }).base, apiKey: 'tfr_bogus' } }).catch((x) => x);
    expect(e).toBeInstanceOf(CoordError); expect(e.status).toBe(401); expect(e.message).not.toMatch(/object Object/);
  }, 60_000);
  it('jobs: a contract-keyed BitAgent id and a bare ACP v3 number in one read', async () => {
    const rows = await readJobs(t, ['bitagent:8453:8566', 74926]);
    expect(rows.map((r) => [r.ref?.kind, r.found])).toEqual([['contract', true], ['acp-v3', true]]);
  }, 60_000);
  it('both answer logs answer total() on Base; JudgeAdapterV5 is bound to its hook and the decision log', async () => {
    const totals = await answerLogTotals(baseReader());
    expect(totals[0]!.total).toBeGreaterThanOrEqual(41n); expect(totals[1]!.total).toBeGreaterThanOrEqual(0n);
    const a = await readJudgeAdapter(baseReader());
    expect(a).toMatchObject({ hook: '0x93122a47d1824affa3baa5751aacf4919f67eb25', decisionLog: REGISTRY.decisionLog.toLowerCase(), releaseDelay: 3600 });
  }, 60_000);
});

// The paid-plan gate as the SDK reads it, replayed from the layer's answers (test/fixtures/layer/standing-2026-11-23.json): a key the
// layer does not know is refused 401; a customer's vault arms only with a running paid plan (402 plan_required otherwise), and a
// vault whose plan lapsed reads `unpaid`, which is never live.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { armVault, keyStanding, MarketError, vaultArmState } from '../src/market/index.js';
import type { OnboardTransport } from '../src/onboard/index.js';

type Fx = { name: string; request: { method: string; path: string; query?: Record<string, string> }; response: { status: number; body: Record<string, unknown> } };
const FX = (JSON.parse(readFileSync(new URL('./fixtures/layer/standing-2026-11-23.json', import.meta.url), 'utf8')) as { fixtures: Fx[] }).fixtures;
const fx = (name: string) => FX.find((f) => f.name === name)!;
const ARM = { vault: 'vault:tenant:t-fixture', armed: true, policy: `0x${'cd'.repeat(32)}`, expires: 1_900_000_000, nonce: 1, signature: `0x${'ab'.repeat(65)}` };
function replay(f: Fx, apiKey?: string) {
  const seen: { url: string; method: string }[] = [];
  const t: OnboardTransport = { base: 'https://api.example/v1', ...(apiKey ? { apiKey } : {}),
    fetch: async (url, init) => { seen.push({ url, method: init?.method ?? 'GET' }); return { ok: f.response.status < 300, status: f.response.status, json: async () => f.response.body }; } };
  return { t, seen };
}

describe('the key door', () => {
  it('no key is refused before any call; a key the layer does not know is a 401 MarketError', async () => {
    const none = replay(fx('key-none'));
    await expect(keyStanding(none.t)).rejects.toMatchObject({ status: 401 }); expect(none.seen).toHaveLength(0);
    const bad = replay(fx('key-invalid'), 'tfr_free_not_a_key');
    const e = await keyStanding(bad.t).catch((x) => x);
    expect(e).toBeInstanceOf(MarketError); expect(e).toMatchObject({ status: 401, code: fx('key-invalid').response.body.code });
    expect(bad.seen[0]).toEqual({ url: 'https://api.example/v1/access/key', method: 'GET' });
  });
});

describe('a tenant vault arms only with a paid plan', () => {
  it('an arm without a running paid plan is 402 plan_required, nothing stored', async () => {
    const e = await armVault(replay(fx('arm-without-plan')).t, ARM).catch((x) => x);
    expect(e).toBeInstanceOf(MarketError); expect(e).toMatchObject({ status: 402, code: 'plan_required' });
  });
  it('with one it is stored and armed; read back it is live', async () => {
    expect(await armVault(replay(fx('arm-with-plan')).t, ARM)).toMatchObject({ stored: true, state: 'armed' });
    const r = replay(fx('state-armed'));
    expect(await vaultArmState(r.t, ARM.vault)).toMatchObject({ state: 'armed', live: true, nextNonce: 2 });
    expect(r.seen[0]!.url).toBe('https://api.example/v1/vault/arm?vault=vault%3Atenant%3At-fixture');
  });
  it('once the plan lapsed or was taken back the same arm reads unpaid and is never live', async () => {
    expect(await vaultArmState(replay(fx('state-unpaid')).t, ARM.vault)).toMatchObject({ state: 'unpaid', live: false, armedUntil: null });
  });
  it('a vault id that is not a tenant vault is refused before any call', async () => {
    const r = replay(fx('state-armed'));
    await expect(vaultArmState(r.t, 'vault:taifoon:kms')).rejects.toThrow(RangeError); expect(r.seen).toHaveLength(0);
  });
  it('the fixtures carry only test addresses', () => {
    const addrs = new Set(JSON.stringify(FX).match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) ?? []);
    const owner = String(fx('state-armed').response.body.owner_key);
    for (const a of addrs) expect(a === owner || /^0x(\d\d)\1{19}$/.test(a), a).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { MOONBEAM_HOOK, MOONBEAM_HOOK_IMPLEMENTATION, MOONBEAM_POOL_FACTORY, MOONBEAM_COVERAGE_POOLS, MOONBEAM_POOL_COUNT, BASE_GLMR_TOKEN, BASE_USDC_TOKEN, JEV_DECISION_LOG } from '../src/acp/moonbeam-acp.generated.js';
import { LEDGERS, watchManifest } from '../src/acp/registry.js';
import { BASE_ASSURANCE_HOOK, BASE_GLMR, BASE_USDC, BASE_POOL_FACTORY, DEFAULT_GUARD, isAddress } from '../src/onboard/index.js';
import { MOONBEAM_JUDGE } from '../src/judge/index.js';

describe('the Moonbeam ACP registry file (generated from the address registry; never typed)', () => {
  it('names the hook proxy on Base with the registry’s status, its implementation and the factory', () => {
    expect(MOONBEAM_HOOK.chainId).toBe(8453); expect(isAddress(MOONBEAM_HOOK.address)).toBe(true);
    expect(['live', 'scheduled-change']).toContain(MOONBEAM_HOOK.status);
    expect(MOONBEAM_HOOK_IMPLEMENTATION.name).toMatch(/implementation/);
    expect(MOONBEAM_POOL_FACTORY.name).toMatch(/PoolFactory/);
  });
  it('lists the live coverage pools, in order', () => {
    expect(MOONBEAM_COVERAGE_POOLS.length).toBe(MOONBEAM_POOL_COUNT);
    expect(MOONBEAM_POOL_COUNT).toBeGreaterThan(0);
    expect(MOONBEAM_COVERAGE_POOLS.every((p) => p.status === 'live' && p.chainId === 8453 && isAddress(p.address))).toBe(true);
  });
  it('the onboard constants are the registry’s rows, and the judge binds to the same hook and GLMR', () => {
    expect(BASE_ASSURANCE_HOOK).toBe(MOONBEAM_HOOK.address);
    expect(BASE_POOL_FACTORY).toBe(MOONBEAM_POOL_FACTORY.address);
    expect(BASE_GLMR).toBe(BASE_GLMR_TOKEN.address); expect(BASE_USDC).toBe(BASE_USDC_TOKEN.address);
    expect(BASE_GLMR_TOKEN.decimals).toBe(18); expect(BASE_USDC_TOKEN.decimals).toBe(6);
    expect(MOONBEAM_JUDGE.hook).toBe(MOONBEAM_HOOK.address); expect(MOONBEAM_JUDGE.token.address).toBe(BASE_GLMR_TOKEN.address);
  });
  it('the judge guard anchors to the Base decision log, the devnet log stays named for tests', () => {
    expect(DEFAULT_GUARD.anchor).toEqual({ chain: 8453, log: JEV_DECISION_LOG.address });
    expect(JEV_DECISION_LOG.chainId).toBe(8453);
  });
  it('the ledger manifest says Moonbeam ACP is deployed on Base, at the hook', () => {
    const mb = LEDGERS.find((l) => l.id === 'moonbeam-acp');
    expect(mb).toMatchObject({ chainId: 8453, deployed: true, address: MOONBEAM_HOOK.address });
    expect(watchManifest().ledgers.filter((l) => l.deployed).length).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { accountOk, addressFormatOf, namespaceOf } from '../src/market/chain-address.js';
import { handOver } from '../src/market/index.js';

describe('chain-address', () => {
  it('names a seller by its own chain: a NEAR account on near:mainnet, a 20-byte address on an EVM chain', () => {
    expect(namespaceOf(8453)).toBe('eip155'); expect(namespaceOf('near:mainnet')).toBe('near');
    expect(accountOk('near:mainnet', 'contract-health-auditor.market.near.ai')).toBe(true);
    expect(accountOk(8453, 'contract-health-auditor.market.near.ai')).toBe(false);
    expect(accountOk(8453, `0x${'ab'.repeat(20)}`)).toBe(true);
    expect(addressFormatOf('nowhere:1')).toBeNull();
  });
  it('handOver refuses an account that is not of its chain before any call', async () => {
    const t = { base: 'https://example.invalid/v1', key: 'k', fetch: async () => { throw new Error('no call expected'); } } as never;
    await expect(handOver(t, { candidate: { kind: 'a2a', address: 'contract-health-auditor.market.near.ai', agentId: '0', chainId: 8453 }, task: 'x' })).rejects.toThrow(RangeError);
  });
});

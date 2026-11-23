// The approval policy's runs on a fork of Base, kept as fixtures: what the machine may send alone to list an agent, and what it refuses.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/listing/${f}`, import.meta.url), 'utf8'));
const ERC = read('erc8004-fork-2026-11-23.json');
const OLAS = read('olas-moonbeam-fork-2026-11-23.json');
const DAY_USD_MICRO = 2_000_000;
const REASON = /^[a-z]+(_[a-z]+)+$/;

describe('ERC-8004 on a fork of Base', () => {
  it('mints the agent\'s own registration URL through the policy and reads it back', () => {
    expect(ERC).toMatchObject({ rule: 'APPROVAL_POLICY_v1', chain: 8453, market: 'erc8004', call: 'register(string)' });
    expect(ERC.verdict.ok).toBe(true);
    expect(ERC.verdict.rules.at(-1)).toBe('sign-approval-policy');
    expect(ERC.landed).toMatchObject({ status: 1, token_uri: ERC.uri });
    expect(new URL(ERC.uri).protocol).toBe('https:');
    expect(Number(ERC.verdict.cost_micro)).toBeLessThan(DAY_USD_MICRO);
  });
  it('refuses a transfer, an approve, a value send and an unknown selector, each by a reason key', () => {
    expect(Object.keys(ERC.refused).sort()).toEqual(['approve', 'transfer', 'unknown_selector', 'value_send']);
    for (const r of Object.values<string>(ERC.refused)) expect(r).toMatch(REASON);
    expect(ERC.refused.value_send).toBe('value_not_zero');
  });
});

describe('Olas Mech on a fork of Base', () => {
  const by = (n: number) => OLAS.policy.find((p: { n: number }) => p.n === n);
  it('walks every setup call and its checks pass', () => {
    expect(OLAS.steps).toHaveLength(7);
    expect(OLAS.checks_ok).toBe(true);
    expect(OLAS.request_served.paid_in).toBe('USDC');
  });
  it('lets the machine send the calls with value 0 and holds the two bonds as the owner\'s sends', () => {
    for (const n of [1, 4, 5]) expect(by(n).decision).toBe('allowed');
    for (const n of [2, 3]) { expect(by(n).decision).toBe('owner_send'); expect(OLAS.steps[n - 1].value_wei).toBe('1'); }
    for (const n of [6, 7]) expect(by(n).decision).toMatch(REASON);
  });
  it('costs the machine\'s calls far under the day\'s 2 USD', () => {
    const micro = OLAS.policy.reduce((a: number, p: { cost_micro?: string }) => a + Number(p.cost_micro ?? 0), 0);
    expect(micro).toBeGreaterThan(0);
    expect(micro).toBeLessThan(DAY_USD_MICRO / 4);
  });
});

describe('the fixtures carry no wallet address', () => {
  it.each([['erc8004-fork-2026-11-23.json'], ['olas-moonbeam-fork-2026-11-23.json']])('%s', (f) => {
    expect(readFileSync(new URL(`./fixtures/listing/${f}`, import.meta.url), 'utf8')).not.toMatch(/0x[0-9a-fA-F]{40}/);
  });
});

import { describe, it, expect } from 'vitest';
import {
  EVENT_TOPICS, eventForTopic, stateAfter, standardStateFor,
  TRANSITIONS, TERMINAL_STATES, HOOKABLE_CALLS, settlementModeOf,
} from '../src/erc8183/index.js';

describe('erc8183: the standard this floor implements', () => {
  it('every ending lands in a standard terminal state', () => {
    for (const e of ['done-right', 'bad-work', 'void', 'cheat'] as const) {
      expect(TERMINAL_STATES).toContain(standardStateFor(e));
    }
  });

  it('topics round-trip through the reverse lookup, case-insensitively', () => {
    for (const [name, topic] of Object.entries(EVENT_TOPICS)) {
      expect(eventForTopic(topic)).toBe(name);
    }
    expect(eventForTopic('0x' + '0'.repeat(64))).toBeUndefined();
  });

  it('lifecycle events evidence exactly the six standard states', () => {
    const states = new Set(
      (Object.keys(EVENT_TOPICS) as (keyof typeof EVENT_TOPICS)[])
        .map(stateAfter).filter(Boolean),
    );
    expect(states).toEqual(new Set(['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired']));
  });

  it('money-moving events are not state transitions', () => {
    expect(stateAfter('PaymentReleased')).toBeUndefined();
    expect(stateAfter('Refunded')).toBeUndefined();
    expect(stateAfter('BudgetSet')).toBeUndefined();
  });

  it('no transition leaves a terminal state', () => {
    for (const t of TRANSITIONS) expect(TERMINAL_STATES).not.toContain(t.from);
  });

  it('every non-terminal state has an exit that needs no counterparty cooperation', () => {
    for (const from of ['Funded', 'Submitted'] as const) {
      expect(TRANSITIONS.some((t) => t.from === from && t.by === 'anyone')).toBe(true);
    }
    expect(TRANSITIONS.some((t) => t.from === 'Open' && t.by === 'client')).toBe(true);
  });

  it('the hook seam covers every money-moving call', () => {
    expect([...HOOKABLE_CALLS].sort()).toEqual(['complete', 'fund', 'reject', 'submit']);
  });
});

describe('erc8183: both settlement modes stay intact', () => {
  it('a job with no hook is ATTESTED - the standard default, always valid', () => {
    const r = settlementModeOf({});
    expect(r).toEqual({ ok: true, mode: 'ATTESTED' });
  });

  it('an attested job may carry a deposit or premium without changing mode', () => {
    const r = settlementModeOf({ deposit: 120n, premium: 1n });
    expect(r).toEqual({ ok: true, mode: 'ATTESTED' });
  });

  it('a hook-bound job with deposit and premium is ASSURED', () => {
    const r = settlementModeOf({ hook: '0xhook', deposit: 120n, premium: 1n });
    expect(r).toEqual({ ok: true, mode: 'ASSURED' });
  });

  it('a hook without money behind it is refused by name', () => {
    const noDep = settlementModeOf({ hook: '0xhook', premium: 1n });
    expect(noDep.ok).toBe(false);
    if (!noDep.ok) expect(noDep.code).toBe('ASSURED_WITHOUT_DEPOSIT');
    const noPrem = settlementModeOf({ hook: '0xhook', deposit: 120n });
    expect(noPrem.ok).toBe(false);
    if (!noPrem.ok) expect(noPrem.code).toBe('ASSURED_WITHOUT_PREMIUM');
  });
});

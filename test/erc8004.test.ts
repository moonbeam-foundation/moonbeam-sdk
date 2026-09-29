import { describe, it, expect } from 'vitest';
import { keccak256, toHex } from 'viem';
import {
  EVENT_SIGNATURES, EVENT_TOPICS, EVENT_REGISTRY, REGISTRY_ADDRESSES,
  ERC8004_DEPLOYMENTS, registryAddress,
  eventForTopic, registryForTopic, watchedTopics,
  identityChangeOf, isRevocable, validationStageOf,
} from '../src/erc8004/index.js';

describe('erc8004: the identity, reputation and validation registries', () => {
  /* The one test that matters. A topic constant is worthless if it was typed
     rather than derived: it would simply never match a live log, and the
     decoder would report silence instead of an error. */
  it('every topic0 is the keccak of its own signature', () => {
    for (const [name, sig] of Object.entries(EVENT_SIGNATURES)) {
      const derived = keccak256(toHex(sig));
      expect(derived, `${name} topic0 does not match ${sig}`).toBe(
        EVENT_TOPICS[name as keyof typeof EVENT_TOPICS],
      );
    }
  });

  it('topics round-trip through the reverse lookup, case-insensitively', () => {
    for (const [name, topic] of Object.entries(EVENT_TOPICS)) {
      expect(eventForTopic(topic)).toBe(name);
      expect(eventForTopic(topic.toUpperCase().replace('0X', '0x'))).toBe(name);
    }
    expect(eventForTopic('0x' + '0'.repeat(64))).toBeUndefined();
  });

  it('every event belongs to exactly one of the three registries', () => {
    const seen = new Set<string>();
    for (const name of Object.keys(EVENT_SIGNATURES)) {
      const reg = EVENT_REGISTRY[name as keyof typeof EVENT_REGISTRY];
      expect(['identity', 'reputation', 'validation']).toContain(reg);
      seen.add(reg);
    }
    expect(seen.size).toBe(3);
  });

  it('registryForTopic agrees with the event map', () => {
    for (const [name, topic] of Object.entries(EVENT_TOPICS)) {
      expect(registryForTopic(topic)).toBe(EVENT_REGISTRY[name as keyof typeof EVENT_REGISTRY]);
    }
    expect(registryForTopic('0x' + 'f'.repeat(64))).toBeUndefined();
  });

  it('the watch list covers every event and nothing else', () => {
    const topics = watchedTopics();
    expect(topics).toHaveLength(Object.keys(EVENT_SIGNATURES).length);
    expect(new Set(topics).size).toBe(topics.length);
  });

  it('the canonical registries share the 0x8004 prefix on every chain', () => {
    for (const addr of Object.values(REGISTRY_ADDRESSES)) {
      expect(addr!.toLowerCase().startsWith('0x8004')).toBe(true);
      expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });

  /* Pinned to the address registry (system standards-erc8004). If this fails,
     the generated file changed: check the registry, not this test. */
  it('the canonical identity and reputation registries match the address registry', () => {
    expect(REGISTRY_ADDRESSES.identity).toBe('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432');
    expect(REGISTRY_ADDRESSES.reputation).toBe('0x8004BAa17C55a88189AE136b182e5fdA19dE9b63');
  });

  it('no validation registry is claimed, on any chain', () => {
    expect(REGISTRY_ADDRESSES.validation).toBeUndefined();
    for (const d of Object.values(ERC8004_DEPLOYMENTS)) expect(d.validation).toBeUndefined();
    expect(registryAddress(8453, 'validation')).toBeUndefined();
  });

  it('Base and Arc carry the canonical addresses; unknown chains carry none', () => {
    for (const chain of [8453, 5042]) {
      expect(registryAddress(chain, 'identity')).toBe(REGISTRY_ADDRESSES.identity);
      expect(registryAddress(chain, 'reputation')).toBe(REGISTRY_ADDRESSES.reputation);
    }
    expect(registryAddress(1, 'identity')).toBeUndefined();
  });

  it('a transfer is an owner change, because these identities are NFTs', () => {
    expect(identityChangeOf('Transfer')).toBe('owner-changed');
    expect(identityChangeOf('Registered')).toBe('minted');
    // reputation events are not identity changes
    expect(identityChangeOf('NewFeedback')).toBeUndefined();
  });

  /* Feedback is signed by whoever left it and can be withdrawn, so it can
     never be the basis for paying out a guarantee. */
  it('revocable reputation is marked as such', () => {
    expect(isRevocable('NewFeedback')).toBe(true);
    expect(isRevocable('ResponseAppended')).toBe(true);
    expect(isRevocable('Registered')).toBe(false);
    expect(isRevocable('ValidationResponse')).toBe(false);
  });

  it('validation has exactly two stages, and no outcome', () => {
    expect(validationStageOf('ValidationRequest')).toBe('requested');
    expect(validationStageOf('ValidationResponse')).toBe('answered');
    expect(validationStageOf('Registered')).toBeUndefined();
  });
});

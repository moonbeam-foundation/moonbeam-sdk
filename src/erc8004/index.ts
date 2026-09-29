/**
 * ERC-8004, Trustless Agents: the identity, reputation and validation
 * registries.
 *
 * The job standard (ERC-8183) says what happened to a piece of work. It says
 * nothing about who did it. That is this standard's job, across three separate
 * registries, and a decoder that reads jobs without reading identity can tell
 * you a job settled but not who settled it.
 *
 * Every topic0 below was re-derived from its signature rather than copied:
 * `EVENT_SIGNATURES` is the source of truth, the tests hash each one and
 * assert it matches, so a mistyped constant fails the build instead of
 * silently never matching a live log.
 *
 * Deliberately address-agnostic, like the 8183 module. The canonical
 * identity and reputation registries live at the same addresses on Base and
 * Arc (no validation registry is recorded on either), but decoding keys on
 * topic0 alone, so a fork or a redeployment reads the same. The addresses
 * come from `registry.generated.ts`, which is generated from the address
 * registry and never hand-edited.
 *
 * One caution this module encodes rather than hides: these registries are
 * upgradeable and owned by a single EOA. Reading them is useful; treating them
 * as ground truth is not, which is why nothing here returns a verdict.
 */

import { ERC8004_CANONICAL, ERC8004_DEPLOYMENTS } from './registry.generated.js';

/** The three registries the standard defines (not every one is deployed; see REGISTRY_ADDRESSES). */
export type Erc8004Registry = 'identity' | 'reputation' | 'validation';

export { ERC8004_DEPLOYMENTS, ERC8004_CANONICAL } from './registry.generated.js';
export type { Erc8004ChainDeployment } from './registry.generated.js';

/**
 * Canonical deployments, identical on Base (8453) and Arc (5042). Only the
 * registries actually deployed are present: there is no canonical validation
 * registry, so `REGISTRY_ADDRESSES.validation` is undefined.
 */
export const REGISTRY_ADDRESSES: Readonly<Partial<Record<Erc8004Registry, string>>> = ERC8004_CANONICAL;

/** The address of one registry on one chain, or undefined when none is recorded there. */
export function registryAddress(chainId: number, registry: Erc8004Registry): string | undefined {
  return ERC8004_DEPLOYMENTS[chainId]?.[registry];
}

/**
 * The event signatures, exactly as the contracts declare them. The topic
 * hashes are derived from these strings; see the test that proves it.
 */
export const EVENT_SIGNATURES = {
  Registered: 'Registered(uint256,string,address)',
  URIUpdated: 'URIUpdated(uint256,string,address)',
  MetadataSet: 'MetadataSet(uint256,string,string,bytes)',
  Transfer: 'Transfer(address,address,uint256)',
  NewFeedback:
    'NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)',
  FeedbackRevoked: 'FeedbackRevoked(uint256,address,uint64)',
  ResponseAppended: 'ResponseAppended(uint256,address,uint64,address,string,bytes32)',
  ValidationRequest: 'ValidationRequest(address,uint256,string,bytes32)',
  ValidationResponse: 'ValidationResponse(address,uint256,bytes32,uint8,string,bytes32,string)',
} as const;

export type Erc8004Event = keyof typeof EVENT_SIGNATURES;

/** topic0 per event, keccak256 of the signature above. Verified in tests. */
export const EVENT_TOPICS: Readonly<Record<Erc8004Event, string>> = Object.freeze({
  Registered: '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a',
  URIUpdated: '0x3a2c7fffc2cba7582c690e3b82c453ea02a308326a98a3ad7576c606336409fb',
  MetadataSet: '0x2c149ed548c6d2993cd73efe187df6eccabe4538091b33adbd25fafdb8a1468b',
  Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  NewFeedback: '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc',
  FeedbackRevoked: '0x25156fd3288212246d8b008d5921fde376c71ed14ac2e072a506eb06fde6d09d',
  ResponseAppended: '0xb1c6be0b5b8aef6539e2fac0fd131a2faa7b49edf8e505b5eb0ad487d56051d4',
  ValidationRequest: '0x530436c3634a98e1e626b0898be2f1e9980cc1bd2a78c07a0aba52d0a48a5059',
  ValidationResponse: '0xafddf629e874ccc3963b6a888c477bd464a6c8525024fc88759ea3b2326349ae',
});

/** Which registry emits each event. */
export const EVENT_REGISTRY: Readonly<Record<Erc8004Event, Erc8004Registry>> = Object.freeze({
  Registered: 'identity',
  URIUpdated: 'identity',
  MetadataSet: 'identity',
  Transfer: 'identity',
  NewFeedback: 'reputation',
  FeedbackRevoked: 'reputation',
  ResponseAppended: 'reputation',
  ValidationRequest: 'validation',
  ValidationResponse: 'validation',
});

/** Reverse lookup: what does this topic0 mean? Unknown topics return undefined. */
export function eventForTopic(topic0: string): Erc8004Event | undefined {
  const t = topic0.toLowerCase();
  return (Object.keys(EVENT_TOPICS) as Erc8004Event[]).find(
    (k) => EVENT_TOPICS[k].toLowerCase() === t,
  );
}

/** Which registry a topic belongs to, or undefined if we do not read it. */
export function registryForTopic(topic0: string): Erc8004Registry | undefined {
  const e = eventForTopic(topic0);
  return e ? EVENT_REGISTRY[e] : undefined;
}

/** Every topic this module decodes, for an indexer's watch list. */
export function watchedTopics(): readonly string[] {
  return Object.freeze(Object.values(EVENT_TOPICS));
}

/**
 * What an identity event tells you about an agent.
 *
 * `Transfer` is the ERC-721 event: these identities are NFTs, so a transfer is
 * a change of owner. It matters for assurance because the party that answers
 * for a worker's behaviour can change without the worker's URI changing at
 * all, and a record that ignored transfers would attribute old work to a new
 * owner.
 */
export type IdentityChange = 'minted' | 'uri-changed' | 'metadata-set' | 'owner-changed';

export function identityChangeOf(event: Erc8004Event): IdentityChange | undefined {
  switch (event) {
    case 'Registered': return 'minted';
    case 'URIUpdated': return 'uri-changed';
    case 'MetadataSet': return 'metadata-set';
    case 'Transfer': return 'owner-changed';
    default: return undefined;
  }
}

/**
 * Reputation, in the standard's own terms.
 *
 * Feedback here is signed by whoever left it and can be revoked by them. That
 * makes it an assertion, not a verdict: useful as a signal, never as the basis
 * for paying out a guarantee. `isRevocable` states which way each event cuts,
 * so a caller cannot accidentally treat a retractable claim as settled fact.
 */
export function isRevocable(event: Erc8004Event): boolean {
  return event === 'NewFeedback' || event === 'ResponseAppended';
}

/**
 * Validation: a request for someone to check a piece of work, and the answer.
 *
 * The response carries a `uint8` response value the standard leaves to the
 * validator to define. We deliberately do not map it to an outcome: an
 * assurance verdict is recomputed from sealed evidence, never adopted from a
 * third party's score.
 */
export type ValidationStage = 'requested' | 'answered';

export function validationStageOf(event: Erc8004Event): ValidationStage | undefined {
  if (event === 'ValidationRequest') return 'requested';
  if (event === 'ValidationResponse') return 'answered';
  return undefined;
}

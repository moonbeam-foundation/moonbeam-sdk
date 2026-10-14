/**
 * @moonbeam-foundation/sdk/arbitration: the calls and records of the three-tier ArbitratorRouter in front of the hook.
 *
 *   tier 0, code            resolveByCode(jobId): anyone relays; it rules only on facts the chain proves
 *   tier 1, second grader   the EIP-712 Verdict the second grader signs, then resolveBySecondGrader(verdict, signature)
 *   tier 2, council         councilApprove (the human seat), pullOracle (the oracle seat), resolveByCouncil (anyone)
 *   reads                   facts(jobId), and the Escalated / CouncilApproved / Resolved events decoded
 *   the seller's record     what a ruling writes into it (recordEffectOf)
 *
 * The router is not deployed on Base, and the hook has no arbitrator yet: every builder takes the router's address and
 * `ARBITRATION_ON_BASE` says so. Calls are unsigned; the caller signs.
 */
import { encodeFunction, encodeParams, decodeStatic, topicOf } from '../abi/index.js';
import { keccakHex, hexToBytes, utf8, isAddress } from '../onboard/index.js';

export const ARBITRATION_ON_BASE = Object.freeze({
  deployed: false as const,
  router: null,
  says: 'The ArbitratorRouter is not deployed on Base and the hook names no arbitrator: no dispute can be ruled there yet.',
});

/** Router.Verdict */
export const VERDICT = Object.freeze({ None: 0, SellerWins: 1, BuyerWins: 2, Cheated: 3 } as const);
export type VerdictName = Exclude<keyof typeof VERDICT, 'None'>;
/** Router.Tier */
export const TIER = Object.freeze({ None: 0, Code: 1, SecondGrader: 2, Council: 3 } as const);
/** RUBRIC_v1's hash, the rubric a second grader must have graded under */
export const RUBRIC_V1_HASH = '0x129dfc81338f238adba7566c1f9c2a72769168edd0fd8251a34a81a90ea3eb97';

export const ROUTER_SIGNATURES = Object.freeze({
  resolveByCode: 'resolveByCode(bytes32 jobId)',
  resolveBySecondGrader: 'resolveBySecondGrader((bytes32 jobId,uint8 verdict,uint256 loss,bytes32 rubricHash,bytes32 decisionDigest) v, bytes signature)',
  councilApprove: 'councilApprove(bytes32 jobId, uint8 verdict, uint256 loss)',
  pullOracle: 'pullOracle(bytes32 jobId)',
  resolveByCouncil: 'resolveByCouncil(bytes32 jobId)',
  facts: 'facts(bytes32 jobId)',
  verdictDigest: 'verdictDigest((bytes32 jobId,uint8 verdict,uint256 loss,bytes32 rubricHash,bytes32 decisionDigest) v)',
} as const);
export const ROUTER_EVENTS = Object.freeze({
  Escalated: 'Escalated(bytes32 indexed jobId, uint8 verdict, uint256 loss, uint8 reason)',
  CouncilApproved: 'CouncilApproved(bytes32 indexed jobId, address indexed seat, uint8 verdict, uint256 loss)',
  Resolved: 'Resolved(bytes32 indexed jobId, uint8 indexed tier, uint8 verdict, uint256 loss, address by)',
} as const);

export type RouterCall = { chainId: 8453; to: string; data: string; value: '0'; fn: string; who: string };
const B32 = /^0x[0-9a-fA-F]{64}$/;
const need = (router: string) => { if (!isAddress(router)) throw new Error(`router ${router} is not an address (${ARBITRATION_ON_BASE.says})`); return router; };
const jid = (j: string) => { if (!B32.test(j)) throw new RangeError('a job id is bytes32'); return j; };
const call = (router: string, fn: keyof typeof ROUTER_SIGNATURES, args: unknown[], who: string): RouterCall =>
  ({ chainId: 8453, to: need(router), data: encodeFunction(ROUTER_SIGNATURES[fn], args as never), value: '0', fn: `ArbitratorRouter.${fn}`, who });

export type SignedVerdict = { jobId: string; verdict: VerdictName; loss: bigint; rubricHash?: string; decisionDigest: string };
const verdictTuple = (v: SignedVerdict) => {
  if (v.verdict !== 'Cheated' && v.loss !== 0n) throw new RangeError('only a Cheated verdict carries a loss');
  if (v.verdict === 'Cheated' && v.loss <= 0n) throw new RangeError('a Cheated verdict names the loss');
  return { jobId: jid(v.jobId), verdict: VERDICT[v.verdict], loss: v.loss, rubricHash: v.rubricHash ?? RUBRIC_V1_HASH, decisionDigest: v.decisionDigest };
};

/** tier 0: anyone relays; the router rules only on facts it reads */
export const resolveByCode = (router: string, jobId: string): RouterCall => call(router, 'resolveByCode', [jid(jobId)], 'anyone');
/** tier 1: the typed data the second grader signs (eth_signTypedData_v4) */
export function secondGraderTypedData(router: string, v: SignedVerdict) {
  const t = verdictTuple(v);
  return {
    domain: { name: 'ArbitratorRouter', version: '1', chainId: 8453 as const, verifyingContract: need(router) },
    types: { Verdict: [{ name: 'jobId', type: 'bytes32' }, { name: 'verdict', type: 'uint8' }, { name: 'loss', type: 'uint256' }, { name: 'rubricHash', type: 'bytes32' }, { name: 'decisionDigest', type: 'bytes32' }] },
    primaryType: 'Verdict' as const,
    message: { ...t, loss: t.loss.toString() },
  };
}
/** the EIP-712 digest the router recovers the signer from (verdictDigest on chain) */
export function verdictDigest(router: string, v: SignedVerdict, chainId = 8453): string {
  const t = verdictTuple(v);
  const k = (s: string) => keccakHex(utf8(s));
  const domainSep = keccakHex(hexToBytes(encodeParams(['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'], [k('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'), k('ArbitratorRouter'), k('1'), chainId, need(router)])));
  const struct = keccakHex(hexToBytes(encodeParams(['bytes32', 'bytes32', 'uint8', 'uint256', 'bytes32', 'bytes32'], [k('Verdict(bytes32 jobId,uint8 verdict,uint256 loss,bytes32 rubricHash,bytes32 decisionDigest)'), t.jobId, t.verdict, t.loss, t.rubricHash, t.decisionDigest])));
  return keccakHex(hexToBytes(`0x1901${domainSep.slice(2)}${struct.slice(2)}`));
}
/** tier 1: relay the signed verdict (anyone may send it) */
export const resolveBySecondGrader = (router: string, v: SignedVerdict, signature: string): RouterCall => {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('the signature is 65 bytes');
  return call(router, 'resolveBySecondGrader', [verdictTuple(v), signature], 'anyone (the second grader signed)');
};
/** tier 2: the human seat's approval */
export const councilApprove = (router: string, jobId: string, verdict: VerdictName, loss = 0n): RouterCall => {
  const t = verdictTuple({ jobId, verdict, loss, decisionDigest: `0x${'0'.repeat(64)}` });
  return call(router, 'councilApprove', [t.jobId, t.verdict, t.loss], 'the human council seat');
};
export const pullOracle = (router: string, jobId: string): RouterCall => call(router, 'pullOracle', [jid(jobId)], 'anyone (reads the oracle seat)');
export const resolveByCouncil = (router: string, jobId: string): RouterCall => call(router, 'resolveByCouncil', [jid(jobId)], 'anyone (two seats agree)');
/** the eth_call that reads the router's facts about a job */
export const factsCall = (router: string, jobId: string): { to: string; data: string } => ({ to: need(router), data: encodeFunction(ROUTER_SIGNATURES.facts, [jid(jobId)]) });

export type RouterEvent =
  | { event: 'Escalated'; jobId: string; verdict: VerdictName | 'None'; loss: bigint; reason: number }
  | { event: 'CouncilApproved'; jobId: string; seat: string; verdict: VerdictName | 'None'; loss: bigint }
  | { event: 'Resolved'; jobId: string; tier: keyof typeof TIER; verdict: VerdictName | 'None'; loss: bigint; by: string };
const nameOf = (n: bigint) => (Object.entries(VERDICT).find(([, v]) => BigInt(v) === n)?.[0] ?? 'None') as VerdictName | 'None';
const TOPICS = Object.fromEntries(Object.entries(ROUTER_EVENTS).map(([k, s]) => [topicOf(s).toLowerCase(), k])) as Record<string, keyof typeof ROUTER_EVENTS>;
/** decode a router log; null for any other log */
export function decodeRouterLog(log: { topics: readonly string[]; data: string }): RouterEvent | null {
  const kind = TOPICS[String(log.topics[0] ?? '').toLowerCase()]; if (!kind) return null;
  const jobId = String(log.topics[1]);
  if (kind === 'Escalated') { const [v, loss, reason] = decodeStatic(['uint8', 'uint256', 'uint8'], log.data); return { event: kind, jobId, verdict: nameOf(v as bigint), loss: loss as bigint, reason: Number(reason) }; }
  if (kind === 'CouncilApproved') { const [v, loss] = decodeStatic(['uint8', 'uint256'], log.data); return { event: kind, jobId, seat: `0x${String(log.topics[2]).slice(26)}`, verdict: nameOf(v as bigint), loss: loss as bigint }; }
  const [v, loss, by] = decodeStatic(['uint8', 'uint256', 'address'], log.data);
  const tier = (Object.entries(TIER).find(([, n]) => BigInt(n) === BigInt(String(log.topics[2])))?.[0] ?? 'None') as keyof typeof TIER;
  return { event: kind, jobId, tier, verdict: nameOf(v as bigint), loss: loss as bigint, by: String(by) };
}

/** what a ruling writes into the seller's record (the machine's verdict vocabulary), and what the hook does */
export function recordEffectOf(v: VerdictName): { sellerRecord: 'correct' | 'incorrect'; hook: string } {
  if (v === 'SellerWins') return { sellerRecord: 'correct', hook: 'resolveDispute(jobId, true): the rejection is overturned, the completion payout' };
  if (v === 'BuyerWins') return { sellerRecord: 'incorrect', hook: 'resolveDispute(jobId, false): the rejection stands, the buyer is refunded' };
  return { sellerRecord: 'incorrect', hook: 'findCheated(jobId, loss): the deposit pays first, then the cover' };
}

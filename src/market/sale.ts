// The stops of one sale after the money is in, as reads: what is booked to whom, the payout queues, the vault's limits, the
// payouts anyone may settle, and the signed record every step goes into. Each is one public GET; a caller without a key is on
// the shared free rate, a key lifts it. Nothing here signs or pays.
import type { OnboardTransport } from '../onboard/index.js';
import { MarketError, call } from './http.js';

type Obj = Record<string, unknown>;
const rows = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter((x): x is Obj => !!x && typeof x === 'object') : []);

/**
 * Booked: the resale ledger's view (`GET /resale`). Its rule (a buyer pays once; every cut is a leg to a named party and the legs
 * sum to the payment), the routes from a supply to a buying market with their legs, and the next field each route waits on.
 */
export async function saleLedger(t: OnboardTransport): Promise<{ rule: string | null; counts: Record<string, unknown>; routes: Obj[]; next: Obj[]; body: Obj }> {
  const j = await call<Obj>(t, 'GET', '/resale');
  return { rule: typeof j['rule'] === 'string' ? j['rule'] : null, counts: (j['counts'] as Record<string, unknown>) ?? {}, routes: rows(j['routes']), next: rows(j['next']), body: j };
}

/** One queue of one chain: how many envelopes wait, the oldest one's age, and the same per venue. */
export type QueueDepth = { depth: number; oldest_s: number; venues?: Record<string, { depth: number; oldest_s: number; needs_signature?: number; value_depth?: number; value_oldest_s?: number }> };
/**
 * Added up: the payout pipe's queues (`GET /pipe/queues`). One pipe seen four ways (read, sign, settle, ack), per chain as
 * `eip155:<id>` (plus `offchain`), each queue with its depth and its oldest envelope's age in seconds.
 */
export async function payoutQueues(t: OnboardTransport): Promise<{ at: number | null; queues: { name: string; why: string }[]; chains: Record<string, Partial<Record<'read' | 'sign' | 'settle' | 'ack', QueueDepth>>>; body: Obj }> {
  const j = await call<Obj>(t, 'GET', '/pipe/queues');
  return {
    at: typeof j['at'] === 'number' ? j['at'] : null,
    queues: rows(j['queues']).map((q) => ({ name: String(q['name'] ?? ''), why: String(q['why'] ?? '') })),
    chains: (j['chains'] as Record<string, Partial<Record<'read' | 'sign' | 'settle' | 'ack', QueueDepth>>>) ?? {},
    body: j,
  };
}

/** The vault's rule for what an agent's calls may do: the actions allowed, on which chains, at what value and rate, and which need a person. */
export type VaultRule = { allow: string[]; chains: number[]; maxValueWei: string; perHour: number | null; requiresHuman: string[] };
/**
 * The vault: the account payouts come from and its limits (`GET /vault/policy`): the actions it allows, the chains, the value
 * cap, the rate, which actions need a person; and the vaults it keeps, by id, kind, chains and assets (their addresses are
 * not carried here).
 */
export async function vaultPolicy(t: OnboardTransport): Promise<{ rule: VaultRule; vaults: { id: string; kind: string | null; chains: string[]; assets: string[] }[]; note: string | null }> {
  const j = await call<Obj>(t, 'GET', '/vault/policy');
  const p = (j['policy'] ?? {}) as Partial<VaultRule> & Obj;
  return {
    rule: { allow: (p.allow ?? []).map(String), chains: (p.chains ?? []).map(Number), maxValueWei: String(p.maxValueWei ?? '0'), perHour: typeof p.perHour === 'number' ? p.perHour : null, requiresHuman: (p.requiresHuman ?? []).map(String) },
    vaults: rows(j['registry']).map((v) => ({ id: String(v['id'] ?? ''), kind: typeof v['kind'] === 'string' ? v['kind'] : null, chains: Array.isArray(v['chains']) ? v['chains'].map(String) : [], assets: Array.isArray(v['assets']) ? v['assets'].map(String) : [] })),
    note: typeof j['note'] === 'string' ? j['note'] : null,
  };
}

/** One payout envelope anyone may settle: its id, chain (`eip155:<id>`), venue, due time and the open steps a settler can take. */
export type ClaimablePayout = { id: string; chain: string; kind: string; venue: string | null; due: number | null; needs_signature: boolean; open_steps: Obj[]; order_key: string | null };
/**
 * Paid: the signed payout envelopes waiting to be settled (`GET /pipe/claimable`). Anyone may take an open step and report its
 * transaction; the first valid inclusion on chain wins. Steps that are the operator's wait for its signer.
 */
export async function claimablePayouts(t: OnboardTransport, o: { chain?: string; limit?: number } = {}): Promise<{ at: number | null; count: number; payouts: ClaimablePayout[]; how: string | null }> {
  const q = new URLSearchParams(); if (o.chain) q.set('chain', o.chain); if (o.limit) q.set('limit', String(o.limit));
  const j = await call<Obj>(t, 'GET', `/pipe/claimable${q.size ? `?${q}` : ''}`);
  const payouts = rows(j['envelopes']).map((e) => ({ id: String(e['id'] ?? ''), chain: String(e['chain'] ?? ''), kind: String(e['kind'] ?? ''), venue: typeof e['venue'] === 'string' ? e['venue'] : null,
    due: typeof e['due'] === 'number' ? e['due'] : null, needs_signature: e['needs_signature'] === true, open_steps: rows(e['open_steps']), order_key: typeof e['order_key'] === 'string' ? e['order_key'] : null }));
  return { at: typeof j['at'] === 'number' ? j['at'] : null, count: typeof j['count'] === 'number' ? j['count'] : payouts.length, payouts, how: typeof j['how'] === 'string' ? j['how'] : null };
}

/**
 * Recorded: the signed root every step of every sale goes into (`GET /root`): the root, when it was made, how many leaves it
 * holds and the chains it covers. Anyone can read it, and an agent's history is proven against it.
 */
export async function saleRecord(t: OnboardTransport): Promise<{ root: string; timestamp: number | null; leafCount: number | null; peakCount: number | null; chains: number[] }> {
  const j = await call<Obj>(t, 'GET', '/root');
  if (typeof j['root'] !== 'string') throw new MarketError(502, 'GET /root', j);
  return { root: j['root'], timestamp: typeof j['timestamp'] === 'number' ? j['timestamp'] : null, leafCount: typeof j['leaf_count'] === 'number' ? j['leaf_count'] : null,
    peakCount: typeof j['peak_count'] === 'number' ? j['peak_count'] : null, chains: Array.isArray(j['chains_included']) ? j['chains_included'].map(Number) : [] };
}

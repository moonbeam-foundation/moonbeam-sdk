/**
 * Onboard — how a Base agent becomes hireable, with the judge standing guard.
 *
 * Nine stages, each with a record behind it: discover → attest → quote →
 * fund → deliver → judge → settle → record → hireable. This module is the
 * typed spine of that loop. Every function takes plain data in and returns
 * plain data or unsigned calls. Nothing signs, nothing reads a clock, and
 * nothing fetches unless it is handed a transport.
 *
 * The transport is a fetch and a base URL. On a Moonbeam surface the base is
 * the site's own same-origin proxy, which scrubs the coordination layer's
 * name and hosts before anything reaches the page; the module never renders
 * an upstream URL and never needs to know one.
 *
 * Browser-safe and dependency-free: the calldata a wallet signs is built here
 * with a small ABI encoder and a keccak over plain byte arrays, and every
 * selector is re-derived from its signature in the tests and pinned against
 * the calldata the live hook accepts on Base.
 */
import { endingFromTrail } from '../launcher/index.js';
import { WILSON_Z, wilsonScore } from '../actors/track-record.js';
import type { TrailEvent } from '../launcher/index.js';

export type Hex = `0x${string}`;
export type Address = Hex;

// ── Base facts ────────────────────────────────────────────────────────────────

/** The ERC-8183 job contract most observed Base jobs live in (Virtuals ACP). */
export const BASE_JOB_CONTRACT = '0x238E541BfefD82238730D00a2208E5497F1832E0' as const;
/** USDC on Base, 6 decimals. */
export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
/** The assurance hook on Base: deposit, premium and verdict attached to a job. */
export const BASE_ASSURANCE_HOOK = '0xc0578657Eda85e0a246771aa1839ce79b54eE80d' as const;
/** One ERC-4626 cover pool per seller comes from here. */
export const BASE_POOL_FACTORY = '0x91f078D10E3f0D05fEBcEA35f114063c696aef54' as const;
/** The ERC-8004 identity registry, one address on every chain it is deployed to. */
export const ERC8004_IDENTITY_REGISTRY = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432' as const;
export const BASE_CHAIN_ID = 8453 as const;

// ── Shapes (spec §2) ──────────────────────────────────────────────────────────

export interface BaseAgentCandidate {
  chainId: 8453;
  /** the seller of record: receives the price, locks the deposit */
  address: Address;
  /** ERC-8004 identity registry id; null when the agent is only a card */
  agentId: bigint | null;
  /** /.well-known/agent.json or the MCP server URL */
  cardUrl: string | null;
  /** what a buyer actually calls */
  endpoint: string | null;
  protocol: 'mcp' | 'a2a' | 'x402' | 'n8n' | 'erc8183' | 'unknown';
  /** from the card's services[] or tools/list */
  skills: string[];
  wire: 'ready' | 'x402' | 'silent' | 'unreachable' | 'unprobed';
  source: { feed: 'flows' | 'registry' | 'jobs'; seenAt: number };
}

export interface Attestation {
  /** the Registered event seen on the identity registry */
  identity: { ok: boolean; tx?: Hex; block?: number };
  /** the wire probe answered in the agent's own protocol */
  reachability: { ok: boolean; protocol?: string; probedAt?: number; wall?: { amount: string; payTo: Address } | null };
  /** tools/list or the card's skills */
  capability: { ok: boolean; tools?: string[]; skills?: string[] };
  /** derived, never self-reported */
  state: 'ATTESTED' | 'MANIFEST_ONLY' | 'CLAIMED';
}

export interface HireTerms {
  chainId: 8453;
  jobContract: typeof BASE_JOB_CONTRACT;
  token: typeof BASE_USDC;
  buyer: Address;
  seller: Address;
  /** in token units (USDC has 6 decimals) */
  price: bigint;
  /** unix seconds; past it anyone may trigger the refund */
  deadline: number;
  /** 1.2 × price, the seller's own; checked at funding */
  deposit: bigint;
  /** from the record; null = unknown (thin) */
  premium: { low: number; high: number; rate: number; label: string } | null;
  task: string;
  skills: string[];
}

export type UnsignedCall = {
  chainId: number;
  to: Address;
  data: Hex;
  value: '0x0';
  step: string;
  signer: 'buyer' | 'seller' | 'anyone';
  effect: string;
};

export interface Delivery {
  /** bytes32 on the hook; the ERC-8183 id for the market */
  jobId: Hex;
  /** sha256 of the canonical deliverable, or the reply digest for a tool call */
  evidenceDigest: Hex;
  /** keccak(domain ‖ nonce ‖ payTo ‖ uint64 chainId): binds off-chain work to the job */
  correlator: Hex;
  submittedAt: number;
  tx?: Hex;
}

export const JEV_OPTIONS = ['delivered_as_specified', 'delivered_with_defects', 'not_delivered', 'cannot_determine'] as const;
export type JevOption = (typeof JEV_OPTIONS)[number];

export interface JevGuard {
  /** confidence below the bar is a lean; the ending falls back to the trail decoder */
  bar: 0.8;
  /** the calibrated model; a deterministic mode exists for schema checks */
  mode: 'calibrated';
  /** printed, hashed, part of the decision digest */
  question: string;
  /** closed vocabulary; nothing in it maps to dishonesty */
  options: typeof JEV_OPTIONS;
  quota: { free: 3; per: 'account' | 'api-key' | 'address'; burstPerMinute: 5; block: { calls: 3; grid: 15; usdcAtPeg: number } };
  /** every decision is written to the decision log before use */
  anchor: { chain: 36927 | 8453; log: Address };
}

export interface JevDecision {
  value: JevOption;
  probabilities: Partial<Record<JevOption, number>>;
  confidence: number;
  /** REF → ending; NoGrade means the trail decides */
  ending: 'Settled' | 'Rejected' | 'NoGrade';
  decision: { id: string; digest: Hex; subject_id: Hex; anchor: { chain: number; tx: Hex | null; status: 'pending' | 'ok' | 'failed' } };
  quota: { who: string; left: number; buy?: string };
}

export type Ending = 'completed' | 'expired' | 'rejected' | 'cheat';

export interface Settlement {
  jobId: Hex;
  ending: Ending;
  txs: Hex[];
  /** V5 receipt proof of the settling transaction */
  proof?: { url: string; superRoot: Hex; finalized: boolean };
}

export interface SellerRecord {
  seller: Address;
  settled: number;
  cheated: number;
  expired: number;
  open: number;
  /** 95% interval on cheated / (settled + cheated) */
  wilson: [number, number] | null;
  /** n ≥ 5 and width ≤ 0.35 */
  calibrated: boolean;
  premium: { low: number; high: number; rate: number } | null;
  pool: { vault: Address | null; totalAssets: bigint | null };
}

export interface Hireable {
  candidate: BaseAgentCandidate;
  attestation: Attestation;
  record: SellerRecord;
  /** attested identity ∧ wire ready ∧ (record exists ∨ priced as unknown) ∧ premium quotable */
  hireable: boolean;
  /** every failed condition, named */
  why: string[];
}

// ── The rules the module enforces (spec §4) ───────────────────────────────────

/** deposit ≥ 1.2 × price: a seller must not profit by defaulting */
export const DEPOSIT_FACTOR = 1.2;
/** confidence below this is a lean, not a verdict */
export const JEV_BAR = 0.8 as const;
/** free judge calls per user (account, API key or address), ever */
export const QUOTA_FREE = 3 as const;
/** judge calls per minute per caller */
export const QUOTA_BURST_PER_MINUTE = 5 as const;
/** a bought block: three calls for fifteen GRID at the oracle peg, paid in USDC */
export const QUOTA_BLOCK = Object.freeze({ calls: 3, grid: 15 } as const);
/** at most this many blocks in one purchase */
export const QUOTA_MAX_BLOCKS = 20;
/** the seller's record is calibrated at n ≥ 5 and a Wilson width ≤ 0.35 */
export const RECORD_MIN_N = 5;
export const RECORD_MAX_WIDTH = 0.35;
/** the hook's grading window after submission, in seconds (what the layer's calls carry) */
export const DEFAULT_GRADE_WINDOW = 604_800;

export const DEFAULT_QUESTION = 'Was the work delivered as specified?';

/** The guard as this surface applies it. `anchor` names the decision log the layer writes to today. */
export const DEFAULT_GUARD: JevGuard = Object.freeze({
  bar: 0.8,
  mode: 'calibrated',
  question: DEFAULT_QUESTION,
  options: JEV_OPTIONS,
  quota: { free: 3, per: 'address', burstPerMinute: 5, block: { calls: 3, grid: 15, usdcAtPeg: 0.15 } },
  anchor: { chain: 36927, log: '0x1D622511862DD7DEffB8fEeBc225E0FAdA1e9A05' },
}) as JevGuard;

// ── Shape guards ──────────────────────────────────────────────────────────────

export function isAddress(v: unknown): v is Address { return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v); }
export function isHex32(v: unknown): v is Hex { return typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v); }
export function isJevOption(v: unknown): v is JevOption { return typeof v === 'string' && (JEV_OPTIONS as readonly string[]).includes(v); }
export function isCandidate(v: unknown): v is BaseAgentCandidate {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return c['chainId'] === 8453 && isAddress(c['address']) && (c['agentId'] === null || typeof c['agentId'] === 'bigint')
    && Array.isArray(c['skills']) && ['ready', 'x402', 'silent', 'unreachable', 'unprobed'].includes(String(c['wire']));
}
export function isDecision(v: unknown): v is JevDecision {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  const dec = d['decision'] as Record<string, unknown> | undefined;
  return isJevOption(d['value']) && typeof d['confidence'] === 'number' && Boolean(dec && typeof dec['id'] === 'string' && isHex32(dec['digest']));
}

// ── Pure rules ────────────────────────────────────────────────────────────────

/** The smallest deposit the rule accepts: ceil(1.2 × price), in token units. */
export function depositFor(price: bigint): bigint {
  if (price < 0n) throw new RangeError('price must not be negative');
  return (price * 12n + 9n) / 10n;
}

/** deposit ≥ 1.2 × price, or the refusal by name. A bid where the seller profits by defaulting is refused at funding. */
export function checkDeposit(price: bigint, deposit: bigint): { ok: true } | { ok: false; code: 'DEPOSIT_BELOW_RULE'; reason: string; required: bigint } {
  const required = depositFor(price);
  if (deposit >= required) return { ok: true };
  return { ok: false, code: 'DEPOSIT_BELOW_RULE', reason: `deposit ${deposit} is below 1.2 × price (${required}); the seller could profit by defaulting`, required };
}

/** The 95% Wilson interval on k successes in n trials. null when n = 0 (an empty record is unknown, not zero). */
export function wilson(k: number, n: number, z = WILSON_Z): [number, number] | null {
  if (n <= 0) return null;
  return wilsonScore(k, n, z);
}

/** calibrated = n ≥ 5 and the interval narrower than 0.35 */
export function isCalibrated(settled: number, cheated: number): boolean {
  const n = settled + cheated; const w = wilson(cheated, n);
  return n >= RECORD_MIN_N && w !== null && w[1] - w[0] <= RECORD_MAX_WIDTH;
}

/** The record a thin seller gets: no interval, not calibrated, premium unknown. Thin is priced as unknown, never refused. */
export function emptyRecord(seller: Address): SellerRecord {
  return { seller, settled: 0, cheated: 0, expired: 0, open: 0, wilson: null, calibrated: false, premium: null, pool: { vault: null, totalAssets: null } };
}

export interface QuotaStanding { free: { calls: number; used: number; left: number }; credits: { left: number; blocks: number }; burst: { perMinute: number; usedThisMinute: number }; price: { gridPerBlock: number; gridUsdc: number; usdcPerBlock: number } }

/** Can this caller make one more judge call now, and if not, why and what it costs. */
export function admit(q: QuotaStanding): { ok: true; lane: 'free' | 'credits'; leftAfter: number } | { ok: false; code: 'BURST' | 'QUOTA'; reason: string; buy?: { blocks: number; usdc: number } } {
  if (q.burst.usedThisMinute >= q.burst.perMinute) return { ok: false, code: 'BURST', reason: `${q.burst.perMinute} calls per minute; wait for the next minute` };
  if (q.free.left > 0) return { ok: true, lane: 'free', leftAfter: q.free.left - 1 };
  if (q.credits.left > 0) return { ok: true, lane: 'credits', leftAfter: q.credits.left - 1 };
  return { ok: false, code: 'QUOTA', reason: `the ${q.free.calls} free calls are used; a block of ${QUOTA_BLOCK.calls} more costs ${QUOTA_BLOCK.grid} GRID at the peg`, buy: { blocks: 1, usdc: priceOfBlocks(1, q.price.gridUsdc) } };
}

/** How many blocks cover `calls` more judge calls. */
export function blocksFor(calls: number): number {
  if (!Number.isFinite(calls) || calls <= 0) return 0;
  return Math.min(QUOTA_MAX_BLOCKS, Math.ceil(calls / QUOTA_BLOCK.calls));
}

/** blocks × 15 GRID × the oracle peg, in USDC (rounded to the cent-of-a-cent USDC carries: 6 decimals). */
export function priceOfBlocks(blocks: number, gridUsdc: number): number {
  if (blocks <= 0 || gridUsdc < 0) return 0;
  return Math.round(blocks * QUOTA_BLOCK.grid * gridUsdc * 1e6) / 1e6;
}

/** Derive the attestation state. Never self-reported: identity is a chain event, reachability a probe, capability a read card. */
export function attestationState(a: { identity: { ok: boolean }; reachability: { ok: boolean }; capability: { ok: boolean } }): Attestation['state'] {
  if (a.identity.ok && a.reachability.ok) return 'ATTESTED';
  if (a.identity.ok && a.capability.ok) return 'MANIFEST_ONLY';
  return 'CLAIMED';
}

/** A grade to the ending it names, once it clears the bar. Nothing in the vocabulary maps to a cheat: a grade never touches a pool. */
export function decisionEnding(value: JevOption, probabilities: Partial<Record<JevOption, number>>, confidence: number, bar: number = JEV_BAR): JevDecision['ending'] {
  const clears = confidence >= bar && (probabilities[value] ?? 0) >= bar;
  if (!clears || value === 'cannot_determine') return 'NoGrade';
  return value === 'delivered_as_specified' ? 'Settled' : 'Rejected';
}

/**
 * The ending: the trail first, the judge only when the trail cannot decide, and only above the bar.
 *   trail says delivered_as_specified          → completed
 *   trail says delivered_with_defects          → rejected
 *   trail says not_delivered                   → expired (nothing arrived; the refund path)
 *   trail cannot say, grade clears the bar     → completed | rejected as the grade names
 *   otherwise                                  → expired: the deadline decides, nobody is paid, the pool pays nothing
 * `cheat` is never produced here. Only an adjudication can name it, and it draws on cover only after the deposit.
 */
export function endingOf(trail: readonly TrailEvent[], decision?: JevDecision, bar: number = JEV_BAR): Ending {
  const t = endingFromTrail(trail);
  if (t.decidedBy === 'trail') {
    if (t.ending === 'delivered_as_specified') return 'completed';
    if (t.ending === 'delivered_with_defects') return 'rejected';
    return 'expired';
  }
  if (decision) {
    const e = decisionEnding(decision.value, decision.probabilities, decision.confidence, bar);
    if (e === 'Settled') return 'completed';
    if (e === 'Rejected') return 'rejected';
  }
  return 'expired';
}

/** What each ending does to the money, in this surface's words. */
export const ENDING_MONEY: Readonly<Record<Ending, string>> = Object.freeze({
  completed: 'The seller is paid the price and gets its deposit back. The premium goes to the pool that covered it.',
  expired: 'Past the deadline anyone unwinds it: the buyer is refunded, the seller recovers its deposit, nobody is penalised.',
  rejected: 'The buyer is refunded and the seller gets its deposit back. Bad work is not cheating; the pool pays nothing.',
  cheat: 'An adjudicated cheat: the buyer is made whole from the seller’s deposit first, and from cover only for what the deposit did not reach.',
});

/** The hireable predicate with every failed condition named. */
export function hireable(c: BaseAgentCandidate, a: Attestation, r: SellerRecord): Hireable {
  const why: string[] = [];
  if (!a.identity.ok) why.push('identity not attested: no Registered event on the identity registry for this address');
  const wireReady = c.wire === 'ready' || a.reachability.ok;
  if (!wireReady) why.push(`wire not ready: the probe reported "${c.wire}"${c.wire === 'x402' ? ' (answers only behind a payment wall)' : ''}`);
  const n = r.settled + r.cheated;
  const thin = n === 0;
  if (!thin && r.premium === null) why.push(`record exists (${r.settled} settled, ${r.cheated} cheated) but no premium could be priced from it`);
  if (r.premium !== null && !(Number.isFinite(r.premium.low) && Number.isFinite(r.premium.high) && r.premium.low <= r.premium.high && r.premium.high <= 1)) why.push('premium not quotable: the interval read from the record is malformed');
  return { candidate: c, attestation: a, record: r, hireable: why.length === 0, why };
}

// ── Bytes, keccak and ABI words (browser-safe; no Buffer, no library) ─────────

const HEXC = '0123456789abcdef';
export function bytesToHex(b: Uint8Array): Hex { let s = '0x'; for (const x of b) s += HEXC[x >> 4]! + HEXC[x & 15]!; return s as Hex; }
export function hexToBytes(h: string): Uint8Array {
  const s = h.replace(/^0x/, ''); if (s.length % 2) throw new Error('odd hex length');
  const out = new Uint8Array(s.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16); return out;
}
export function utf8(s: string): Uint8Array { return new TextEncoder().encode(s); }
function concat(...parts: Uint8Array[]): Uint8Array { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }

const RC = [1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n];
const ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]];
const M64 = (1n << 64n) - 1n;
const rol = (x: bigint, n: number) => (n === 0 ? x : (((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64));

/** keccak-256 over bytes: the Ethereum hash, in fifty lines, so nothing here needs a chain library. */
export function keccak256(input: Uint8Array): Uint8Array {
  const rate = 136;
  const padLen = rate - (input.length % rate);
  const padded = new Uint8Array(input.length + padLen); padded.set(input);
  padded[input.length] = (padded[input.length] ?? 0) ^ 0x01; padded[padded.length - 1] = (padded[padded.length - 1] ?? 0) ^ 0x80;
  const view = new DataView(padded.buffer);
  const st: bigint[] = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) st[i] = st[i]! ^ view.getBigUint64(off + i * 8, true);
    for (let r = 0; r < 24; r++) {
      const c = [0, 1, 2, 3, 4].map((x) => st[x]! ^ st[x + 5]! ^ st[x + 10]! ^ st[x + 15]! ^ st[x + 20]!);
      const d = [0, 1, 2, 3, 4].map((x) => c[(x + 4) % 5]! ^ rol(c[(x + 1) % 5]!, 1));
      for (let i = 0; i < 25; i++) st[i] = st[i]! ^ d[i % 5]!;
      const b: bigint[] = new Array(25).fill(0n);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rol(st[x + 5 * y]!, ROT[x]![y]!);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) st[x + 5 * y] = b[x + 5 * y]! ^ (~b[((x + 1) % 5) + 5 * y]! & b[((x + 2) % 5) + 5 * y]!);
      st[0] = st[0]! ^ RC[r]!;
    }
  }
  const out = new Uint8Array(32); const ov = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) ov.setBigUint64(i * 8, st[i]!, true);
  return out;
}
export function keccakHex(input: Uint8Array): Hex { return bytesToHex(keccak256(input)); }

const word = (n: bigint | number) => { const v = BigInt(n); if (v < 0n) throw new RangeError('negative word'); return v.toString(16).padStart(64, '0'); };
const addrWord = (a: string) => { if (!isAddress(a)) throw new Error(`not an address: ${a}`); return a.slice(2).toLowerCase().padStart(64, '0'); };
const b32Word = (h: string) => { if (!isHex32(h)) throw new Error(`not 32 bytes: ${h}`); return h.slice(2).toLowerCase(); };

/** The first four bytes of keccak(signature): the function selector. */
export function selector(signature: string): Hex { return keccakHex(utf8(signature)).slice(0, 10) as Hex; }

/** The hook and token functions this module encodes, by signature. Selectors are re-derived from these in tests and pinned against live calldata. */
export const SIGNATURES = Object.freeze({
  approve: 'approve(address,uint256)',
  fundJob: 'fundJob(bytes32,address,address,uint256,uint256,uint256,uint64,uint64,address)',
  submit: 'submit(bytes32,bytes32)',
  complete: 'complete(bytes32)',
  reject: 'reject(bytes32,bytes32)',
  expire: 'expire(bytes32)',
} as const);

// ── Identifiers the calls need ────────────────────────────────────────────────

/** The bytes32 job id for a set of terms: keccak over the canonical terms, so the same terms always name the same job and anyone can recompute it. */
export function jobIdOf(t: Pick<HireTerms, 'chainId' | 'buyer' | 'seller' | 'token' | 'price' | 'deadline' | 'task'>): Hex {
  const canonical = JSON.stringify({ chainId: t.chainId, buyer: t.buyer.toLowerCase(), seller: t.seller.toLowerCase(), token: t.token.toLowerCase(), price: t.price.toString(), deadline: t.deadline, task: t.task });
  return keccakHex(utf8(canonical));
}

/** correlator = keccak(domain ‖ nonce ‖ payTo ‖ uint64 chainId): binds off-chain work to the job it is paid under. */
export function correlatorOf(a: { domain: string; nonce: Hex; payTo: Address; chainId: number }): Hex {
  if (!isHex32(a.nonce)) throw new Error('nonce must be 32 bytes');
  const chain = new Uint8Array(8); new DataView(chain.buffer).setBigUint64(0, BigInt(a.chainId), false);
  return keccakHex(concat(utf8(a.domain), hexToBytes(a.nonce), hexToBytes(a.payTo), chain));
}

const ZERO: Address = '0x0000000000000000000000000000000000000000';

// ── Unsigned calls (pure) ─────────────────────────────────────────────────────

const call = (to: Address, data: string, step: string, signer: UnsignedCall['signer'], effect: string, chainId = 8453): UnsignedCall => ({ chainId, to, data: data as Hex, value: '0x0', step, signer, effect });

/**
 * The calls the buyer signs to fund an insured job on Base, in order: an exact-amount USDC approve to
 * the hook, then fundJob. The seller must already have approved the hook for exactly its deposit for
 * this job (never a standing allowance: the live contract pulls the deposit from whichever seller the
 * funder names). Refuses terms whose deposit is below the rule.
 */
export function fundCalls(terms: HireTerms, opts: { jobId?: Hex; evaluator?: Address; gradeWindow?: number } = {}): UnsignedCall[] {
  const d = checkDeposit(terms.price, terms.deposit);
  if (!d.ok) throw new RangeError(d.reason);
  if (terms.price <= 0n) throw new RangeError('price must be positive');
  if (!Number.isInteger(terms.deadline) || terms.deadline <= 0) throw new RangeError('deadline must be unix seconds');
  const jobId = opts.jobId ?? jobIdOf(terms);
  const evaluator = opts.evaluator ?? ZERO;
  const gradeWindow = opts.gradeWindow ?? DEFAULT_GRADE_WINDOW;
  const premium = 0n; // the premium is what the pool charges at funding; the hook reads it from the seller's pool, the buyer approves only the price here
  const approve = call(terms.token, selector(SIGNATURES.approve) + addrWord(BASE_ASSURANCE_HOOK) + word(terms.price), 'approve', 'buyer',
    `Lets the hook move exactly ${terms.price} of USDC from you for this job. Nothing moves until the job is funded. Exact amount, never a standing allowance.`);
  const fund = call(BASE_ASSURANCE_HOOK,
    selector(SIGNATURES.fundJob) + b32Word(jobId) + addrWord(terms.seller) + addrWord(terms.token) + word(terms.price) + word(premium) + word(terms.deposit) + word(terms.deadline) + word(gradeWindow) + addrWord(evaluator),
    'fundJob', 'buyer',
    `Locks ${terms.price} in escrow from you and ${terms.deposit} from the seller, creating insured job ${jobId.slice(0, 10)}…; deadline ${terms.deadline}. ${evaluator === ZERO ? 'You complete or reject it yourself.' : `Evaluator ${evaluator.slice(0, 10)}… may complete or reject it.`}`);
  return [approve, fund];
}

/** The seller's call: submit(jobId, evidenceDigest) seals the digest on the hook. It does not release payment. */
export function submitCalls(d: Delivery): UnsignedCall[] {
  return [call(BASE_ASSURANCE_HOOK, selector(SIGNATURES.submit) + b32Word(d.jobId) + b32Word(d.evidenceDigest), 'submit', 'seller',
    `Records that you delivered job ${d.jobId.slice(0, 10)}…, sealing evidence ${d.evidenceDigest.slice(0, 10)}… bound by correlator ${d.correlator.slice(0, 10)}…. It does not release payment.`)];
}

/**
 * The call that settles a job under one of the four endings.
 *   completed → complete(jobId), the buyer or a registered evaluator
 *   rejected  → reject(jobId, verdictDigest), the buyer or a registered evaluator; the digest is required
 *   expired   → expire(jobId), anyone, once the deadline has passed
 *   cheat     → refused here: an adjudicated cheat is posted through the judge adapter by a registered evaluator, and no adapter is deployed on Base
 */
export function settleCalls(jobId: Hex, ending: Ending, verdictDigest?: Hex): UnsignedCall[] {
  if (!isHex32(jobId)) throw new Error('jobId must be bytes32');
  switch (ending) {
    case 'completed':
      return [call(BASE_ASSURANCE_HOOK, selector(SIGNATURES.complete) + b32Word(jobId), 'complete', 'buyer', ENDING_MONEY.completed + ' This is final.')];
    case 'rejected':
      if (!verdictDigest || !isHex32(verdictDigest)) throw new Error('a rejection carries the verdict digest it rests on');
      return [call(BASE_ASSURANCE_HOOK, selector(SIGNATURES.reject) + b32Word(jobId) + b32Word(verdictDigest), 'reject', 'buyer', ENDING_MONEY.rejected)];
    case 'expired':
      return [call(BASE_ASSURANCE_HOOK, selector(SIGNATURES.expire) + b32Word(jobId), 'expire', 'anyone', ENDING_MONEY.expired)];
    case 'cheat':
      throw new Error('an adjudicated cheat is posted through the judge adapter by a registered evaluator; no adapter is deployed on Base, so this module cannot build it');
  }
}

// ── Transport and the fetching functions ──────────────────────────────────────

/** The one thing this module needs from the outside: a fetch and the base of the scrubbing proxy. */
export interface OnboardTransport {
  fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;
  /** the scrubbing proxy, e.g. "/api/onboard"; paths below mirror the layer's own */
  base: string;
  /** forwarded as X-API-Key; without it the judge counts the free calls per address */
  apiKey?: string;
}

export class OnboardError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: unknown) { super(message); this.name = 'OnboardError'; }
}

async function get<T>(t: OnboardTransport, path: string): Promise<T> {
  const r = await t.fetch(`${t.base}${path}`, { method: 'GET', headers: headers(t) });
  const j = (await r.json().catch(() => null)) as unknown;
  if (!r.ok) throw new OnboardError(r.status, errorOf(j, `GET ${path} → ${r.status}`), j);
  return j as T;
}
async function post<T>(t: OnboardTransport, path: string, body: unknown): Promise<T> {
  const r = await t.fetch(`${t.base}${path}`, { method: 'POST', headers: { ...headers(t), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => null)) as unknown;
  if (!r.ok) throw new OnboardError(r.status, errorOf(j, `POST ${path} → ${r.status}`), j);
  return j as T;
}
const headers = (t: OnboardTransport): Record<string, string> => ({ accept: 'application/json', ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) });
const errorOf = (j: unknown, fallback: string) => (j && typeof j === 'object' && typeof (j as { error?: unknown }).error === 'string' ? (j as { error: string }).error : fallback);

type RegistryRow = { agentId: number | string; chainId: number; owner: string; endpoint?: string | null; endpointKind?: string | null; cardHost?: string | null; skills?: string[]; skillCount?: number; wire?: string | { status?: string; protocol?: string | null } | null; wireProtocol?: string | null; wireReadyAt?: number | null; registrationTx?: string | null; trust?: number };
type FlowRow = { id: string; title?: string; task?: string; required_skills?: string[]; budget_usdc?: number; created_at?: string; candidate?: { chain?: number; id?: string | null; name?: string; owner?: string; endpoint?: string | null; endpoint_kind?: string | null; kind?: string; wire?: { protocol?: string | null; status?: string } | null; card_url?: string | null } };

const protocolOf = (kind?: string | null, wireProtocol?: string | null): BaseAgentCandidate['protocol'] => {
  const k = (wireProtocol ?? kind ?? '').toLowerCase();
  if (k === 'mcp') return 'mcp'; if (k === 'a2a') return 'a2a'; if (k === 'x402') return 'x402'; if (k === 'n8n') return 'n8n'; if (k === 'erc8183') return 'erc8183';
  return 'unknown';
};
const wireOf = (w?: string | null): BaseAgentCandidate['wire'] => (w === 'ready' || w === 'x402' || w === 'silent' || w === 'unreachable' ? w : 'unprobed');

/** A registry row as the layer returns it, folded into a candidate. Exported so the fold is testable without a transport. */
export function candidateFromRegistry(r: RegistryRow, seenAt: number): BaseAgentCandidate | null {
  if (Number(r.chainId) !== 8453 || !isAddress(r.owner)) return null;
  return {
    chainId: 8453, address: r.owner.toLowerCase() as Address, agentId: r.agentId != null && /^\d+$/.test(String(r.agentId)) ? BigInt(r.agentId) : null,
    cardUrl: r.cardHost ? `https://${r.cardHost}/.well-known/agent.json` : null, endpoint: r.endpoint ?? null,
    protocol: protocolOf(r.endpointKind, r.wireProtocol ?? (typeof r.wire === 'object' && r.wire ? r.wire.protocol : null)), skills: Array.isArray(r.skills) ? r.skills : [], wire: wireOf(typeof r.wire === 'object' && r.wire ? r.wire.status : r.wire),
    source: { feed: 'registry', seenAt },
  };
}

/** A ready-to-run flow's candidate, folded the same way. Flows without a chain-8453 owner address fold to null. */
export function candidateFromFlow(f: FlowRow, seenAt: number): BaseAgentCandidate | null {
  const c = f.candidate; if (!c || Number(c.chain) !== 8453 || !isAddress(c.owner)) return null;
  return {
    chainId: 8453, address: c.owner.toLowerCase() as Address, agentId: c.id != null && /^\d+$/.test(String(c.id)) ? BigInt(c.id) : null,
    cardUrl: c.card_url ?? null, endpoint: c.endpoint ?? null, protocol: protocolOf(c.endpoint_kind ?? c.kind, c.wire?.protocol),
    skills: Array.isArray(f.required_skills) ? f.required_skills : [], wire: wireOf(c.wire?.status), source: { feed: 'flows', seenAt },
  };
}

/** Discover: the registry's Base agents best-trust-first, plus the scanner's ready-to-run flows, deduplicated by address and id. */
export async function discover(t: OnboardTransport, f: { skill?: string; wire?: 'ready' | 'x402'; limit?: number } = {}): Promise<BaseAgentCandidate[]> {
  const limit = f.limit ?? 12; const now = Math.floor(Date.now() / 1000);
  const q = new URLSearchParams({ chain: '8453', limit: String(limit * 2) }); if (f.wire) q.set('wire', 'ready'); if (f.skill) q.set('skill', f.skill);
  const [reg, flows] = await Promise.all([
    get<{ agents?: RegistryRow[] }>(t, `/registry/agents?${q}`).catch(() => ({ agents: [] as RegistryRow[] })),
    get<{ flows?: FlowRow[] }>(t, `/onboarding/flows?limit=${limit * 4}`).catch(() => ({ flows: [] as FlowRow[] })),
  ]);
  const out: BaseAgentCandidate[] = []; const seen = new Set<string>();
  const push = (c: BaseAgentCandidate | null) => { if (!c) return; const k = `${c.address}:${c.agentId ?? 'card'}`; if (seen.has(k)) return; seen.add(k); out.push(c); };
  for (const r of reg.agents ?? []) push(candidateFromRegistry(r, now));
  for (const fl of flows.flows ?? []) push(candidateFromFlow(fl, fl.created_at ? Math.floor(Date.parse(fl.created_at) / 1000) : now));
  return out.filter((c) => (f.wire ? c.wire === f.wire : true) && (f.skill ? c.skills.some((s) => s.includes(f.skill!)) || c.skills.length === 0 : true)).slice(0, limit);
}

type WireProbe = { status?: string; protocol?: string | null; probedAt?: number; readyAt?: number };
type RegistryRecord = Omit<RegistryRow, 'wire'> & { sources?: string[]; wire?: WireProbe | string | null; skills?: string[]; x402?: { amount?: string; payTo?: string } | null };

/** Attest: identity from the registry record read from chain, reachability from the wire probe, capability from the card. */
export async function attest(t: OnboardTransport, c: BaseAgentCandidate): Promise<Attestation> {
  let rec: RegistryRecord | null = null;
  if (c.agentId !== null) rec = await get<RegistryRecord>(t, `/registry/agents/8453/${c.agentId}`).catch(() => null);
  return attestationFromRecord(c, rec);
}

/** The fold behind `attest`, exported for tests: a record (or none) to the three fields and the derived state. */
export function attestationFromRecord(c: BaseAgentCandidate, rec: RegistryRecord | null): Attestation {
  const onChain = Boolean(rec && (rec.registrationTx || (rec.sources ?? []).includes('OnChain')));
  const identity: Attestation['identity'] = { ok: onChain, ...(rec?.registrationTx && isHex32(rec.registrationTx) ? { tx: rec.registrationTx } : {}) };
  const w: WireProbe | null = rec && typeof rec.wire === 'object' && rec.wire ? rec.wire : null;
  const status = w?.status ?? c.wire;
  const wall = rec?.x402 && isAddress(rec.x402.payTo) ? { amount: String(rec.x402.amount ?? ''), payTo: rec.x402.payTo as Address } : status === 'x402' ? null : null;
  const reachability: Attestation['reachability'] = { ok: status === 'ready', ...(w?.protocol ? { protocol: w.protocol } : {}), ...(w?.probedAt ? { probedAt: w.probedAt } : {}), wall };
  const skills = (rec?.skills && rec.skills.length ? rec.skills : c.skills) ?? [];
  const capability: Attestation['capability'] = { ok: skills.length > 0, skills };
  return { identity, reachability, capability, state: attestationState({ identity, reachability, capability }) };
}

type QuoteReply = { ok?: boolean; premium?: { insurable?: boolean; low?: number; high?: number; rate?: number; label?: string } | null; terms?: { depositRequired?: string }; refusals?: unknown[] };

/** Quote: the premium interval from the seller's record (never a point), and the deposit the rule requires. */
export async function quote(t: OnboardTransport, c: BaseAgentCandidate, ask: { task: string; price: bigint; deadline: number; buyer?: Address; skills?: string[] }): Promise<HireTerms> {
  const q = await post<QuoteReply>(t, '/assurance/quote', { chainId: 8453, seller: c.address, price: ask.price.toString() });
  return termsFromQuote(c, ask, q);
}

/** The fold behind `quote`, exported for tests. The deposit is the larger of the rule and what the layer requires. */
export function termsFromQuote(c: BaseAgentCandidate, ask: { task: string; price: bigint; deadline: number; buyer?: Address; skills?: string[] }, q: QuoteReply): HireTerms {
  const required = q.terms?.depositRequired && /^\d+$/.test(q.terms.depositRequired) ? BigInt(q.terms.depositRequired) : 0n;
  const rule = depositFor(ask.price);
  const p = q.premium;
  const premium = p && p.insurable !== false && typeof p.low === 'number' && typeof p.high === 'number' ? { low: p.low, high: p.high, rate: p.rate ?? 0, label: p.label ?? `${(p.low * 100).toFixed(1)}%–${(p.high * 100).toFixed(1)}%` } : null;
  return { chainId: 8453, jobContract: BASE_JOB_CONTRACT, token: BASE_USDC, buyer: ask.buyer ?? ZERO, seller: c.address, price: ask.price, deadline: ask.deadline, deposit: rule > required ? rule : required, premium, task: ask.task, skills: ask.skills ?? c.skills };
}

type RefReply = { ok?: boolean; answer?: { value?: string; probabilities?: Record<string, number>; confidence?: number }; value?: string; probabilities?: Record<string, number>; confidence?: number; decision?: { id?: string; digest?: string; subject_id?: string; subject?: string; anchor?: { chain?: number; tx?: string | null; status?: string } }; trial?: { calls?: number; used?: number; left?: number }; quota?: { who?: string; left?: number; buy?: string }; who?: string };

/** Judge: one closed question over the sealed evidence, answered with a distribution and a confidence, recorded and anchored before it is used. Throws OnboardError(402|429) when the quota refuses. */
export async function judge(t: OnboardTransport, jobId: Hex, evidence: { state: unknown }, guard: Partial<JevGuard> = {}): Promise<JevDecision> {
  const g = { ...DEFAULT_GUARD, ...guard };
  const r = await post<RefReply>(t, '/judge/ref', { state: evidence.state, question: g.question, options: g.options, chainId: 8453, jobId, subject: jobId, source: 'moonbeam-onboard' });
  return decisionFromRef(r, g.bar);
}

/** The fold behind `judge`, exported for tests: the layer's reply to a JevDecision, ending decided against the bar. */
export function decisionFromRef(r: RefReply, bar: number = JEV_BAR): JevDecision {
  const a = r.answer ?? r;
  const value = isJevOption(a.value) ? a.value : 'cannot_determine';
  const probabilities: Partial<Record<JevOption, number>> = {};
  for (const k of JEV_OPTIONS) if (typeof a.probabilities?.[k] === 'number') probabilities[k] = a.probabilities[k]!;
  const confidence = typeof a.confidence === 'number' ? a.confidence : 0;
  const d = r.decision ?? {};
  const digest = isHex32(d.digest) ? d.digest : ('0x' + '0'.repeat(64)) as Hex;
  const subject = isHex32(d.subject_id) ? d.subject_id : isHex32(d.subject) ? d.subject : ('0x' + '0'.repeat(64)) as Hex;
  const st = d.anchor?.status; const status: 'pending' | 'ok' | 'failed' = st === 'ok' ? 'ok' : st === 'failed' ? 'failed' : 'pending';
  const left = r.trial?.left ?? r.quota?.left ?? -1;
  return {
    value, probabilities, confidence, ending: decisionEnding(value, probabilities, confidence, bar),
    decision: { id: d.id ?? '', digest, subject_id: subject, anchor: { chain: d.anchor?.chain ?? 0, tx: d.anchor?.tx && isHex32(d.anchor.tx) ? d.anchor.tx : null, status } },
    quota: { who: r.quota?.who ?? r.who ?? 'address', left, ...(r.quota?.buy ? { buy: r.quota.buy } : {}) },
  };
}

type PoolRow = { sellerId?: string; seller?: string; vault?: string | null; totalAssets?: string | null; settled?: number; cheated?: number; expired?: number; open?: number; jobs?: number; insurable?: boolean; premium?: { low?: number; high?: number; rate?: number } | null };

/** Record: the seller's settled / cheated counts and the Wilson interval on the cheat rate, from the pools feed. A seller with no row gets the thin record. */
export async function record(t: OnboardTransport, seller: Address): Promise<SellerRecord> {
  const p = await get<{ pools?: PoolRow[] }>(t, '/pools?chain=8453').catch(() => ({ pools: [] as PoolRow[] }));
  const row = (p.pools ?? []).find((x) => (x.sellerId ?? x.seller ?? '').toLowerCase() === seller.toLowerCase());
  return recordFromPool(seller, row ?? null);
}

/** The fold behind `record`, exported for tests. */
export function recordFromPool(seller: Address, row: PoolRow | null): SellerRecord {
  if (!row) return emptyRecord(seller);
  const settled = row.settled ?? 0; const cheated = row.cheated ?? 0;
  const n = settled + cheated;
  const premium = row.insurable !== false && row.premium && typeof row.premium.low === 'number' && typeof row.premium.high === 'number' ? { low: row.premium.low, high: row.premium.high, rate: row.premium.rate ?? 0 } : null;
  return {
    seller, settled, cheated, expired: row.expired ?? 0, open: row.open ?? 0,
    wilson: wilson(cheated, n), calibrated: isCalibrated(settled, cheated), premium,
    pool: { vault: isAddress(row.vault) ? row.vault : null, totalAssets: row.totalAssets != null && /^\d+$/.test(String(row.totalAssets)) ? BigInt(row.totalAssets) : null },
  };
}

/** discover → attest → record → hireable, for one candidate. */
export async function assess(t: OnboardTransport, c: BaseAgentCandidate): Promise<Hireable> {
  const [a, r] = await Promise.all([attest(t, c), record(t, c.address)]);
  return hireable(c, a, r);
}

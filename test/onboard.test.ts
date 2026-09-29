import { describe, it, expect } from 'vitest';
import {
  BASE_ASSURANCE_HOOK, BASE_USDC, BASE_JOB_CONTRACT, JEV_OPTIONS, DEFAULT_GUARD, SIGNATURES, QUOTA_BLOCK,
  isAddress, isHex32, isJevOption, isCandidate, isDecision,
  depositFor, checkDeposit, wilson, isCalibrated, emptyRecord, admit, blocksFor, priceOfBlocks,
  attestationState, decisionEnding, endingOf, ENDING_MONEY, hireable,
  keccak256, keccakHex, bytesToHex, hexToBytes, utf8, selector, jobIdOf, correlatorOf,
  fundCalls, submitCalls, settleCalls,
  candidateFromRegistry, candidateFromFlow, attestationFromRecord, termsFromQuote, decisionFromRef, recordFromPool,
  discover, attest, quote, judge, record, assess, OnboardError,
} from '../src/onboard/index.js';
import type { BaseAgentCandidate, Attestation, SellerRecord, HireTerms, JevDecision, OnboardTransport, QuotaStanding } from '../src/onboard/index.js';

// ── fixtures: what the layer answered on 2026-09-24, verbatim where it matters ──
const SELLER = '0xccf57d593aa2cf8f8329e5e8353f69f2b21e34e9' as const;
const BUYER = '0x0000000000000000000000000000000000000001' as const;
const JOB = ('0x' + '11'.repeat(32)) as `0x${string}`;
const DIGEST = ('0x' + '22'.repeat(32)) as `0x${string}`;
const w = (s: string) => s.padStart(64, '0');

const registryRow = { agentId: 17449, cardHost: 'api.xona-agent.com', chainId: 8453, corroboration: 3, endpoint: 'https://api.xona-agent.com/mcp', endpointKind: 'Mcp', owner: '0x515e7bce44baa5f6e42d16d4b5f27768e7f2f8cc', registrationTx: null, skillCount: 15, status: 'Live', teeServed: false, trust: 560, wire: 'ready', wireProtocol: 'mcp', wireReadyAt: 1790186283 };
const registryRecord = { ...registryRow, skills: ['list-resources', 'image-designer', 'token-news'], sources: ['OnChain', 'Manifest', 'Wire'], wire: { probedAt: 1790186283, protocol: 'mcp', readyAt: 1790186283, status: 'ready' } };
const flowRow = { id: 'fl_1', title: 'Hire dataweb-sandy.vercel.app for crypto analysis', required_skills: ['crypto-analysis'], budget_usdc: 0.0148, created_at: '2026-09-23T21:44:17.073Z', candidate: { chain: 8453, id: '26273', name: 'dataweb-sandy.vercel.app', owner: '0x7bf2426c652db59ef7f1bb31f5da118c2d3db172', endpoint: 'https://dataweb-sandy.vercel.app/a2a', endpoint_kind: 'A2a', kind: 'a2a', wire: { protocol: null, status: 'silent' } } };
const quoteReply = { ok: true, seller: SELLER, record: { settled: 16, cheated: 0 }, premium: { insurable: true, settled: 16, cheated: 0, rate: 0, low: 0, high: 0.1936076805344365, width: 0.1936076805344365, label: '0.0%–19.4% · thin record (16 settled)', chargedUnits: '1936' }, terms: { price: '10000', depositRequired: '10001', depositOffered: null, rule: 'D > P' }, refusals: [] };
const poolRow = { sellerId: SELLER, vault: '0x522728B431E8eb80e0CfDe3c0a0Ae8604Afb32b0', totalAssets: '0', jobs: 16, settled: 16, cheated: 0, insurable: true, premium: { low: 0, high: 0.1936076805344365, rate: 0 } };
const refReply = { ok: true, answer: { value: 'delivered_as_specified', probabilities: { delivered_as_specified: 0.93, delivered_with_defects: 0.04, not_delivered: 0.01, cannot_determine: 0.02 }, confidence: 0.92 }, decision: { id: 'decision-1790239759511-7fc88c5799', digest: '0x7fc88c5799' + 'a'.repeat(54), subject_id: '0x743f1bd0' + 'b'.repeat(56), anchor: { chain: 36927, tx: '0x8d0ab633' + 'c'.repeat(56), status: 'ok' } }, trial: { calls: 3, used: 1, left: 2 } };

const cand = (over: Partial<BaseAgentCandidate> = {}): BaseAgentCandidate => ({ chainId: 8453, address: SELLER, agentId: 1n, cardUrl: null, endpoint: 'https://x.example/mcp', protocol: 'mcp', skills: ['a'], wire: 'ready', source: { feed: 'registry', seenAt: 1 }, ...over });
const att = (over: Partial<Attestation> = {}): Attestation => ({ identity: { ok: true }, reachability: { ok: true }, capability: { ok: true }, state: 'ATTESTED', ...over });
const rec = (over: Partial<SellerRecord> = {}): SellerRecord => ({ ...emptyRecord(SELLER), ...over });
const terms = (over: Partial<HireTerms> = {}): HireTerms => ({ chainId: 8453, jobContract: BASE_JOB_CONTRACT, token: BASE_USDC, buyer: BUYER, seller: SELLER, price: 10000n, deadline: 1790400000, deposit: 12000n, premium: null, task: 'test', skills: [], ...over });

/** a transport over canned answers; records every request so a test can assert the body it sent */
function fake(routes: Record<string, unknown | ((body: unknown) => unknown)>, status: Record<string, number> = {}) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const t: OnboardTransport = {
    base: '/api/onboard',
    fetch: async (url, init) => {
      const path = url.replace('/api/onboard', '');
      const key = Object.keys(routes).find((k) => path.startsWith(k));
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body });
      if (!key) return { ok: false, status: 404, json: async () => ({ error: 'no route' }) };
      const v = routes[key]; const payload = typeof v === 'function' ? (v as (b: unknown) => unknown)(body) : v;
      const st = status[key] ?? 200;
      return { ok: st < 400, status: st, json: async () => payload };
    },
  };
  return { t, calls };
}

// ── shapes and guards ─────────────────────────────────────────────────────────
describe('shape guards', () => {
  it('addresses and bytes32 by length and hex only', () => {
    expect(isAddress(SELLER)).toBe(true); expect(isAddress(SELLER + '0')).toBe(false); expect(isAddress('ccf5')).toBe(false);
    expect(isHex32(JOB)).toBe(true); expect(isHex32(SELLER)).toBe(false); expect(isHex32(42)).toBe(false);
  });
  it('the judge vocabulary is closed and names no dishonesty', () => {
    expect(JEV_OPTIONS).toHaveLength(4);
    for (const o of JEV_OPTIONS) { expect(isJevOption(o)).toBe(true); expect(o).not.toMatch(/cheat|fraud|dishonest/); }
    expect(isJevOption('cheated')).toBe(false);
  });
  it('a candidate needs chain 8453, an address, a bigint-or-null id and a wire state', () => {
    expect(isCandidate(cand())).toBe(true);
    expect(isCandidate({ ...cand(), chainId: 5042 })).toBe(false);
    expect(isCandidate({ ...cand(), agentId: '7' })).toBe(false);
    expect(isCandidate({ ...cand(), wire: 'online' })).toBe(false);
    expect(isCandidate(null)).toBe(false);
  });
  it('a decision needs a value in the vocabulary, a confidence and a 32-byte digest', () => {
    const d = decisionFromRef(refReply);
    expect(isDecision(d)).toBe(true);
    expect(isDecision({ ...d, decision: { ...d.decision, digest: '0x12' } })).toBe(false);
    expect(isDecision({ ...d, value: 'maybe' })).toBe(false);
  });
  it('the default guard carries the bar, the free quota and the anchor log', () => {
    expect(DEFAULT_GUARD.bar).toBe(0.8); expect(DEFAULT_GUARD.quota.free).toBe(3); expect(DEFAULT_GUARD.quota.block).toMatchObject({ calls: 3, grid: 15 });
    expect(isAddress(DEFAULT_GUARD.anchor.log)).toBe(true); expect(DEFAULT_GUARD.options).toBe(JEV_OPTIONS);
  });
});

// ── the deposit rule ──────────────────────────────────────────────────────────
describe('deposit ≥ 1.2 × price', () => {
  it('depositFor rounds up so the rule always holds in integer units', () => {
    expect(depositFor(10000n)).toBe(12000n);
    expect(depositFor(1n)).toBe(2n);
    expect(depositFor(5n)).toBe(6n);
    expect(depositFor(0n)).toBe(0n);
  });
  it('refuses a negative price', () => { expect(() => depositFor(-1n)).toThrow(RangeError); });
  it('checkDeposit accepts at the line and refuses one unit below, by name', () => {
    expect(checkDeposit(10000n, 12000n)).toEqual({ ok: true });
    const r = checkDeposit(10000n, 11999n);
    expect(r.ok).toBe(false); if (!r.ok) { expect(r.code).toBe('DEPOSIT_BELOW_RULE'); expect(r.required).toBe(12000n); expect(r.reason).toMatch(/profit by defaulting/); }
  });
  it('a deposit equal to the price (the contract minimum D > P is not enough here) is refused', () => {
    expect(checkDeposit(10000n, 10001n).ok).toBe(false);
  });
});

// ── the record: an interval, never a point ────────────────────────────────────
describe('wilson interval and calibration', () => {
  it('is null on an empty record: unknown, not zero', () => { expect(wilson(0, 0)).toBeNull(); });
  it('matches the layer’s own upper bound for 0 of 16', () => {
    const [lo, hi] = wilson(0, 16)!;
    expect(lo).toBe(0); expect(hi).toBeCloseTo(0.1936076805344365, 9);
  });
  it('is symmetric-ish around a half and stays inside [0, 1]', () => {
    const [lo, hi] = wilson(5, 10)!; expect(lo).toBeGreaterThan(0.2); expect(hi).toBeLessThan(0.8); expect(lo + hi).toBeCloseTo(1, 10);
    const [l2, h2] = wilson(10, 10)!; expect(h2).toBeCloseTo(1, 12); expect(l2).toBeGreaterThan(0.6);
  });
  it('narrows with n', () => { const a = wilson(0, 5)!; const b = wilson(0, 50)!; expect(a[1] - a[0]).toBeGreaterThan(b[1] - b[0]); });
  it('calibrated needs n ≥ 5 and width ≤ 0.35', () => {
    expect(isCalibrated(4, 0)).toBe(false);   // n = 4
    expect(isCalibrated(5, 0)).toBe(false);   // n = 5 but width 0.43
    expect(isCalibrated(16, 0)).toBe(true);   // width 0.19
    expect(isCalibrated(3, 3)).toBe(false);   // n = 6, width ≈ 0.6
  });
  it('the thin record prices as unknown: no interval, no premium, not calibrated', () => {
    const r = emptyRecord(SELLER); expect(r.wilson).toBeNull(); expect(r.premium).toBeNull(); expect(r.calibrated).toBe(false); expect(r.pool.vault).toBeNull();
  });
});

// ── quota arithmetic ──────────────────────────────────────────────────────────
const standing = (over: Partial<QuotaStanding> = {}): QuotaStanding => ({ free: { calls: 3, used: 0, left: 3 }, credits: { left: 0, blocks: 0 }, burst: { perMinute: 5, usedThisMinute: 0 }, price: { gridPerBlock: 15, gridUsdc: 0.01, usdcPerBlock: 0.15 }, ...over });
describe('quota: 3 free per user, 5 per minute, then blocks of 3 at 15 GRID', () => {
  it('admits on the free lane and counts down', () => { expect(admit(standing())).toEqual({ ok: true, lane: 'free', leftAfter: 2 }); });
  it('falls to credits when the free calls are used', () => { expect(admit(standing({ free: { calls: 3, used: 3, left: 0 }, credits: { left: 3, blocks: 1 } }))).toEqual({ ok: true, lane: 'credits', leftAfter: 2 }); });
  it('refuses by quota with the price of one block at the peg', () => {
    const r = admit(standing({ free: { calls: 3, used: 3, left: 0 } }));
    expect(r.ok).toBe(false); if (!r.ok) { expect(r.code).toBe('QUOTA'); expect(r.buy).toEqual({ blocks: 1, usdc: 0.15 }); expect(r.reason).toMatch(/15 GRID/); }
  });
  it('refuses by burst before it looks at the quota', () => {
    const r = admit(standing({ burst: { perMinute: 5, usedThisMinute: 5 } })); expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('BURST');
  });
  it('blocksFor rounds up to whole blocks and caps at 20', () => {
    expect(blocksFor(1)).toBe(1); expect(blocksFor(3)).toBe(1); expect(blocksFor(4)).toBe(2); expect(blocksFor(0)).toBe(0); expect(blocksFor(1000)).toBe(20); expect(blocksFor(NaN)).toBe(0);
  });
  it('priceOfBlocks is blocks × 15 GRID × the peg, in USDC', () => {
    expect(priceOfBlocks(1, 0.01)).toBe(0.15); expect(priceOfBlocks(2, 0.01)).toBe(0.3); expect(priceOfBlocks(1, 0.001)).toBe(0.015); expect(priceOfBlocks(0, 0.01)).toBe(0);
    expect(QUOTA_BLOCK.calls * 5).toBe(QUOTA_BLOCK.grid); // 5 GRID a call
  });
});

// ── attestation state ─────────────────────────────────────────────────────────
describe('attestation state is derived, never self-reported', () => {
  const s = (i: boolean, r: boolean, c: boolean) => attestationState({ identity: { ok: i }, reachability: { ok: r }, capability: { ok: c } });
  it('ATTESTED = identity on chain and the wire answered', () => { expect(s(true, true, true)).toBe('ATTESTED'); expect(s(true, true, false)).toBe('ATTESTED'); });
  it('MANIFEST_ONLY = identity on chain, a readable card, no answer on the wire', () => { expect(s(true, false, true)).toBe('MANIFEST_ONLY'); });
  it('CLAIMED = anything less', () => { expect(s(true, false, false)).toBe('CLAIMED'); expect(s(false, true, true)).toBe('CLAIMED'); expect(s(false, false, false)).toBe('CLAIMED'); });
});

// ── the judge bar and the ending ──────────────────────────────────────────────
describe('decisionEnding: the 0.80 bar', () => {
  const p = (v: number) => ({ delivered_as_specified: v, delivered_with_defects: 1 - v });
  it('a delivered grade at or above the bar settles', () => { expect(decisionEnding('delivered_as_specified', p(0.8), 0.8)).toBe('Settled'); expect(decisionEnding('delivered_as_specified', p(0.95), 0.97)).toBe('Settled'); });
  it('defects or not delivered above the bar reject', () => {
    expect(decisionEnding('delivered_with_defects', { delivered_with_defects: 0.9 }, 0.9)).toBe('Rejected');
    expect(decisionEnding('not_delivered', { not_delivered: 0.85 }, 0.85)).toBe('Rejected');
  });
  it('below the bar it is a lean: NoGrade', () => { expect(decisionEnding('delivered_as_specified', p(0.79), 0.79)).toBe('NoGrade'); expect(decisionEnding('delivered_as_specified', p(0.95), 0.5)).toBe('NoGrade'); });
  it('the bar applies to both the confidence and the mass on the chosen answer', () => { expect(decisionEnding('delivered_as_specified', p(0.6), 0.9)).toBe('NoGrade'); });
  it('cannot_determine never settles, however confident', () => { expect(decisionEnding('cannot_determine', { cannot_determine: 0.99 }, 0.99)).toBe('NoGrade'); });
  it('a custom bar moves the line', () => { expect(decisionEnding('delivered_as_specified', p(0.75), 0.75, 0.7)).toBe('Settled'); expect(decisionEnding('delivered_as_specified', p(0.85), 0.85, 0.9)).toBe('NoGrade'); });
});

describe('endingOf: the trail first, the judge only above the bar', () => {
  const dec = (value: JevDecision['value'], conf: number): JevDecision => ({ value, probabilities: { [value]: conf }, confidence: conf, ending: 'NoGrade', decision: { id: 'd', digest: DIGEST, subject_id: DIGEST, anchor: { chain: 36927, tx: null, status: 'pending' } }, quota: { who: 'address', left: 2 } });
  it('JobCompleted / PaymentReleased → completed, whatever the grade says', () => {
    expect(endingOf(['JobCreated', 'JobFunded', 'JobSubmitted', 'JobCompleted'])).toBe('completed');
    expect(endingOf(['PaymentReleased'], dec('not_delivered', 0.99))).toBe('completed');
  });
  it('submitted then refunded → rejected; nothing submitted then refunded/expired → expired', () => {
    expect(endingOf(['JobFunded', 'JobSubmitted', 'Refunded'])).toBe('rejected');
    expect(endingOf(['JobFunded', 'JobSubmitted', 'JobRejected'])).toBe('rejected');
    expect(endingOf(['JobFunded', 'Refunded'])).toBe('expired');
    expect(endingOf(['JobFunded', 'JobExpired'])).toBe('expired');
  });
  it('an open job with no grade → expired (the deadline path; nobody paid)', () => { expect(endingOf(['JobCreated', 'JobFunded'])).toBe('expired'); expect(endingOf([])).toBe('expired'); });
  it('submitted then expired: the trail cannot say, so the grade decides above the bar', () => {
    const trail = ['JobFunded', 'JobSubmitted', 'JobExpired'] as const;
    expect(endingOf([...trail], dec('delivered_as_specified', 0.9))).toBe('completed');
    expect(endingOf([...trail], dec('delivered_with_defects', 0.9))).toBe('rejected');
    expect(endingOf([...trail], dec('not_delivered', 0.81))).toBe('rejected');
  });
  it('a lean below the bar does not decide; the deadline path stands', () => {
    expect(endingOf(['JobFunded', 'JobSubmitted', 'JobExpired'], dec('delivered_as_specified', 0.79))).toBe('expired');
    expect(endingOf(['JobFunded', 'JobSubmitted'], dec('delivered_as_specified', 0.79))).toBe('expired');
  });
  it('an abstention never settles', () => { expect(endingOf(['JobFunded', 'JobSubmitted', 'JobExpired'], dec('cannot_determine', 0.99))).toBe('expired'); });
  it('never returns cheat: a grade never touches a pool', () => {
    for (const v of JEV_OPTIONS) for (const c of [0.5, 0.8, 1]) expect(endingOf(['JobFunded', 'JobSubmitted'], dec(v, c))).not.toBe('cheat');
  });
  it('each ending says what it does to the money; only cheat mentions cover', () => {
    for (const e of ['completed', 'expired', 'rejected'] as const) expect(ENDING_MONEY[e]).not.toMatch(/from cover|draw on cover/);
    expect(ENDING_MONEY.cheat).toMatch(/deposit first/); expect(ENDING_MONEY.rejected).toMatch(/pool pays nothing/);
  });
});

// ── hireable, every reason named ──────────────────────────────────────────────
describe('hireable predicate', () => {
  it('attested, ready and thin: hireable, priced as unknown', () => { const h = hireable(cand(), att(), rec()); expect(h.hireable).toBe(true); expect(h.why).toEqual([]); });
  it('names a missing identity', () => { const h = hireable(cand(), att({ identity: { ok: false }, state: 'CLAIMED' }), rec()); expect(h.hireable).toBe(false); expect(h.why[0]).toMatch(/identity not attested/); });
  it('names a silent wire, and says when the wall is the reason', () => {
    expect(hireable(cand({ wire: 'silent' }), att({ reachability: { ok: false } }), rec()).why[0]).toMatch(/wire not ready.*silent/);
    expect(hireable(cand({ wire: 'x402' }), att({ reachability: { ok: false } }), rec()).why[0]).toMatch(/payment wall/);
  });
  it('a ready probe in the attestation rescues a stale candidate wire', () => { expect(hireable(cand({ wire: 'unprobed' }), att(), rec()).hireable).toBe(true); });
  it('a record that exists but could not be priced fails, with the counts', () => {
    const h = hireable(cand(), att(), rec({ settled: 2, cheated: 3, premium: null, wilson: wilson(3, 5) }));
    expect(h.hireable).toBe(false); expect(h.why[0]).toMatch(/2 settled, 3 cheated/);
  });
  it('a malformed premium interval fails as not quotable', () => { expect(hireable(cand(), att(), rec({ settled: 5, premium: { low: 0.5, high: 0.2, rate: 0 } })).why[0]).toMatch(/not quotable/); });
  it('collects every failure, not just the first', () => {
    const h = hireable(cand({ wire: 'unreachable' }), att({ identity: { ok: false }, reachability: { ok: false }, state: 'CLAIMED' }), rec({ settled: 1, premium: null }));
    expect(h.why).toHaveLength(3);
  });
});

// ── keccak, selectors, identifiers ────────────────────────────────────────────
describe('keccak-256 without a library', () => {
  it('known vectors', () => {
    expect(keccakHex(new Uint8Array())).toBe('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(keccakHex(utf8('abc'))).toBe('0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
    expect(keccakHex(utf8('The quick brown fox jumps over the lazy dog'))).toBe('0x4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15');
  });
  it('handles input longer than one rate block', () => { expect(keccak256(new Uint8Array(200).fill(7))).toHaveLength(32); expect(keccakHex(new Uint8Array(136))).not.toBe(keccakHex(new Uint8Array(135))); });
  it('hex round-trips', () => { expect(bytesToHex(hexToBytes(DIGEST))).toBe(DIGEST); expect(() => hexToBytes('0x123')).toThrow(/odd/); });
  it('re-derives every selector the live hook and token accept (pinned against the layer’s calldata)', () => {
    expect(selector(SIGNATURES.approve)).toBe('0x095ea7b3');
    expect(selector(SIGNATURES.fundJob)).toBe('0x48625a99');
    expect(selector(SIGNATURES.submit)).toBe('0xd26ff86e');
    expect(selector(SIGNATURES.complete)).toBe('0x83ccfb84');
    expect(selector(SIGNATURES.reject)).toBe('0x04f999c7');
    expect(selector(SIGNATURES.expire)).toBe('0xc6441798');
  });
  it('jobIdOf is deterministic over the canonical terms and case-insensitive on addresses', () => {
    const a = jobIdOf(terms()); expect(isHex32(a)).toBe(true);
    expect(jobIdOf(terms({ seller: SELLER.toUpperCase().replace('0X', '0x') as `0x${string}` }))).toBe(a);
    expect(jobIdOf(terms({ task: 'other' }))).not.toBe(a); expect(jobIdOf(terms({ price: 10001n }))).not.toBe(a);
  });
  it('correlatorOf binds domain, nonce, payee and chain; any change moves it', () => {
    const base = { domain: 'moonbeam.onboard', nonce: DIGEST, payTo: SELLER, chainId: 8453 };
    const c = correlatorOf(base); expect(isHex32(c)).toBe(true);
    expect(correlatorOf({ ...base, chainId: 5042 })).not.toBe(c); expect(correlatorOf({ ...base, payTo: BUYER })).not.toBe(c); expect(correlatorOf({ ...base, domain: 'x' })).not.toBe(c);
    expect(() => correlatorOf({ ...base, nonce: '0x12' as `0x${string}` })).toThrow(/32 bytes/);
  });
});

// ── unsigned calls, byte-for-byte against the layer ───────────────────────────
describe('fundCalls', () => {
  const t = terms();
  it('is approve then fundJob, both signed by the buyer, both to Base', () => {
    const c = fundCalls(t, { jobId: JOB }); expect(c).toHaveLength(2);
    expect(c.map((x) => x.step)).toEqual(['approve', 'fundJob']); expect(c.every((x) => x.signer === 'buyer' && x.chainId === 8453 && x.value === '0x0')).toBe(true);
    expect(c[0]!.to).toBe(BASE_USDC); expect(c[1]!.to).toBe(BASE_ASSURANCE_HOOK);
  });
  it('the approve is exact-amount to the hook: the same bytes the layer returned', () => {
    expect(fundCalls(t, { jobId: JOB })[0]!.data).toBe('0x095ea7b3000000000000000000000000c0578657eda85e0a246771aa1839ce79b54ee80d0000000000000000000000000000000000000000000000000000000000002710');
  });
  it('the fundJob calldata equals what POST /assurance/call { fund-job } returned for the same terms', () => {
    const live = '0x48625a99' + '11'.repeat(32) + w('ccf57d593aa2cf8f8329e5e8353f69f2b21e34e9') + w('833589fcd6edb6e08f4c7c32d4f71b54bda02913') + w('2710') + w('0') + w('2ee0') + w('6ab75600') + w('93a80') + w('0');
    expect(fundCalls(t, { jobId: JOB })[1]!.data).toBe(live);
  });
  it('an evaluator and a grade window land in the last two words', () => {
    const d = fundCalls(t, { jobId: JOB, evaluator: BUYER, gradeWindow: 200 })[1]!.data;
    expect(d.slice(-128, -64)).toBe(w('c8')); expect(d.slice(-64)).toBe(w('1'));
  });
  it('derives the job id from the terms when none is given', () => { expect(fundCalls(t)[1]!.data.slice(10, 74)).toBe(jobIdOf(t).slice(2)); });
  it('refuses a deposit below the rule, a zero price and a bad deadline', () => {
    expect(() => fundCalls(terms({ deposit: 11999n }))).toThrow(/1\.2/);
    expect(() => fundCalls(terms({ price: 0n, deposit: 0n }))).toThrow(/positive/);
    expect(() => fundCalls(terms({ deadline: 1.5 }))).toThrow(/unix seconds/);
  });
  it('the effect names the amounts and says the allowance is exact, never standing', () => {
    const [a, f] = fundCalls(t, { jobId: JOB }); expect(a!.effect).toMatch(/exactly 10000/); expect(a!.effect).toMatch(/never a standing allowance/); expect(f!.effect).toMatch(/12000 from the seller/);
  });
});

describe('submitCalls and settleCalls', () => {
  it('submit(jobId, evidenceDigest) by the seller: the layer’s bytes', () => {
    const c = submitCalls({ jobId: JOB, evidenceDigest: DIGEST, correlator: DIGEST, submittedAt: 1 });
    expect(c).toHaveLength(1); expect(c[0]!.signer).toBe('seller'); expect(c[0]!.data).toBe('0xd26ff86e' + '11'.repeat(32) + '22'.repeat(32));
  });
  it('completed → complete(jobId): the layer’s bytes', () => { const c = settleCalls(JOB, 'completed'); expect(c[0]!.data).toBe('0x83ccfb84' + '11'.repeat(32)); expect(c[0]!.signer).toBe('buyer'); expect(c[0]!.effect).toMatch(/final/); });
  it('rejected → reject(jobId, verdictDigest): the layer’s bytes; the digest is required', () => {
    expect(settleCalls(JOB, 'rejected', DIGEST)[0]!.data).toBe('0x04f999c7' + '11'.repeat(32) + '22'.repeat(32));
    expect(() => settleCalls(JOB, 'rejected')).toThrow(/verdict digest/);
  });
  it('expired → expire(jobId), anyone: the layer’s bytes', () => { const c = settleCalls(JOB, 'expired'); expect(c[0]!.data).toBe('0xc6441798' + '11'.repeat(32)); expect(c[0]!.signer).toBe('anyone'); });
  it('cheat is refused here: no judge adapter on Base', () => { expect(() => settleCalls(JOB, 'cheat')).toThrow(/no adapter is deployed on Base/); });
  it('refuses a job id that is not bytes32', () => { expect(() => settleCalls(SELLER, 'completed')).toThrow(/bytes32/); });
});

// ── the folds from the layer’s replies ────────────────────────────────────────
describe('folds', () => {
  it('candidateFromRegistry: a Base row to a candidate; other chains fold to null', () => {
    const c = candidateFromRegistry(registryRow, 7)!;
    expect(c).toMatchObject({ chainId: 8453, address: registryRow.owner, agentId: 17449n, endpoint: registryRow.endpoint, protocol: 'mcp', wire: 'ready', source: { feed: 'registry', seenAt: 7 } });
    expect(c.cardUrl).toBe('https://api.xona-agent.com/.well-known/agent.json'); expect(c.skills).toEqual([]);
    expect(candidateFromRegistry({ ...registryRow, chainId: 1 }, 7)).toBeNull();
    expect(candidateFromRegistry({ ...registryRow, wire: null, wireProtocol: null, endpointKind: 'A2a' }, 7)).toMatchObject({ wire: 'unprobed', protocol: 'a2a' });
    // the full record (GET /registry/agents/8453/:id) carries the probe as an object; the list carries a string
    expect(candidateFromRegistry({ ...registryRow, wire: { status: 'ready', protocol: 'mcp' }, wireProtocol: null }, 7)).toMatchObject({ wire: 'ready', protocol: 'mcp' });
  });
  it('candidateFromFlow: the scanner’s candidate with its required skills; a seller-only flow folds to null', () => {
    const c = candidateFromFlow(flowRow, 9)!;
    expect(c).toMatchObject({ address: flowRow.candidate.owner, agentId: 26273n, protocol: 'a2a', wire: 'silent', skills: ['crypto-analysis'], source: { feed: 'flows', seenAt: 9 } });
    expect(candidateFromFlow({ id: 'x', candidate: { chain: 8453, name: '0xccf5…34e9' } }, 9)).toBeNull();
  });
  it('attestationFromRecord: OnChain source attests identity, the probe attests the wire, skills attest capability', () => {
    const a = attestationFromRecord(cand({ agentId: 17449n, skills: [] }), registryRecord);
    expect(a.identity.ok).toBe(true); expect(a.identity.tx).toBeUndefined();
    expect(a.reachability).toMatchObject({ ok: true, protocol: 'mcp', probedAt: 1790186283, wall: null });
    expect(a.capability.ok).toBe(true); expect(a.capability.skills).toHaveLength(3); expect(a.state).toBe('ATTESTED');
  });
  it('attestationFromRecord: no record at all is CLAIMED even if the candidate says ready', () => {
    const a = attestationFromRecord(cand({ skills: [] }), null); expect(a.identity.ok).toBe(false); expect(a.state).toBe('CLAIMED');
  });
  it('attestationFromRecord: on chain with a card but a silent wire is MANIFEST_ONLY', () => {
    const a = attestationFromRecord(cand(), { ...registryRecord, wire: { status: 'silent' } }); expect(a.state).toBe('MANIFEST_ONLY'); expect(a.reachability.ok).toBe(false);
  });
  it('termsFromQuote: the deposit is the larger of the rule and the layer’s requirement; the premium is the interval', () => {
    const t = termsFromQuote(cand(), { task: 'x', price: 10000n, deadline: 1790400000, buyer: BUYER }, quoteReply);
    expect(t.deposit).toBe(12000n); expect(t.premium).toMatchObject({ low: 0, rate: 0 }); expect(t.premium!.high).toBeCloseTo(0.1936, 3); expect(t.premium!.label).toMatch(/thin record/);
    expect(t.jobContract).toBe(BASE_JOB_CONTRACT); expect(t.token).toBe(BASE_USDC); expect(t.buyer).toBe(BUYER);
  });
  it('termsFromQuote: a layer requirement above the rule wins; an uninsurable reply prices as unknown', () => {
    expect(termsFromQuote(cand(), { task: 'x', price: 10000n, deadline: 1 }, { terms: { depositRequired: '15000' } }).deposit).toBe(15000n);
    expect(termsFromQuote(cand(), { task: 'x', price: 10000n, deadline: 1 }, { premium: { insurable: false, low: 0, high: 1 } }).premium).toBeNull();
  });
  it('decisionFromRef: value, distribution, confidence, ending against the bar, the anchored decision and the quota left', () => {
    const d = decisionFromRef(refReply);
    expect(d.value).toBe('delivered_as_specified'); expect(d.confidence).toBe(0.92); expect(d.ending).toBe('Settled');
    expect(d.decision.id).toBe('decision-1790239759511-7fc88c5799'); expect(d.decision.anchor).toMatchObject({ chain: 36927, status: 'ok' }); expect(d.quota.left).toBe(2);
  });
  it('decisionFromRef: a lean is NoGrade; a flat reply and a pending anchor still fold', () => {
    expect(decisionFromRef({ ...refReply, answer: { ...refReply.answer, confidence: 0.7 } }).ending).toBe('NoGrade');
    const d = decisionFromRef({ value: 'not_delivered', probabilities: { not_delivered: 0.9 }, confidence: 0.9 });
    expect(d.ending).toBe('Rejected'); expect(d.decision.anchor.status).toBe('pending'); expect(d.decision.anchor.tx).toBeNull(); expect(d.quota.left).toBe(-1);
  });
  it('recordFromPool: the live row for 0xccf5 → 16 settled, calibrated, the interval and the vault', () => {
    const r = recordFromPool(SELLER, poolRow);
    expect(r).toMatchObject({ settled: 16, cheated: 0, calibrated: true, pool: { vault: poolRow.vault, totalAssets: 0n } });
    expect(r.wilson![1]).toBeCloseTo(0.1936, 3); expect(r.premium).toMatchObject({ low: 0, rate: 0 });
  });
  it('recordFromPool: no row is the thin record; insurable:false drops the premium', () => {
    expect(recordFromPool(SELLER, null)).toEqual(emptyRecord(SELLER));
    expect(recordFromPool(SELLER, { ...poolRow, insurable: false }).premium).toBeNull();
  });
});

// ── the fetching functions, against a fake transport ──────────────────────────
describe('transport functions', () => {
  it('discover merges registry and flows, dedupes, and filters by wire', async () => {
    const { t, calls } = fake({ '/registry/agents': { agents: [registryRow, registryRow] }, '/onboarding/flows': { flows: [flowRow] } });
    const all = await discover(t, {}); expect(all.map((c) => c.agentId)).toEqual([17449n, 26273n]);
    expect(calls.some((c) => c.url.includes('/registry/agents?chain=8453'))).toBe(true);
    const ready = await discover(t, { wire: 'ready' }); expect(ready).toHaveLength(1); expect(ready[0]!.wire).toBe('ready');
  });
  it('discover survives one feed failing and respects the limit', async () => {
    const { t } = fake({ '/registry/agents': { agents: [registryRow, { ...registryRow, agentId: 2 }, { ...registryRow, agentId: 3 }] } });
    expect(await discover(t, { limit: 2 })).toHaveLength(2);
  });
  it('discover filters by skill when the candidate names skills', async () => {
    const { t } = fake({ '/onboarding/flows': { flows: [flowRow, { ...flowRow, id: 'f2', required_skills: ['risk-scoring'], candidate: { ...flowRow.candidate, id: '99' } }] } });
    const r = await discover(t, { skill: 'risk' }); expect(r.map((c) => c.agentId)).toEqual([99n]);
  });
  it('attest reads the registry record for the id and folds it; a card-only candidate is CLAIMED without a read', async () => {
    const { t, calls } = fake({ '/registry/agents/8453/17449': registryRecord });
    expect((await attest(t, cand({ agentId: 17449n }))).state).toBe('ATTESTED'); expect(calls).toHaveLength(1);
    expect((await attest(t, cand({ agentId: null }))).state).toBe('CLAIMED'); expect(calls).toHaveLength(1);
  });
  it('quote posts the seller and the price in smallest units and folds the interval', async () => {
    const { t, calls } = fake({ '/assurance/quote': quoteReply });
    const tt = await quote(t, cand(), { task: 'x', price: 10000n, deadline: 1790400000 });
    expect(calls[0]!.body).toEqual({ chainId: 8453, seller: SELLER, price: '10000' }); expect(tt.deposit).toBe(12000n); expect(tt.premium!.label).toMatch(/19\.4%/);
  });
  it('judge posts the state, the printed question and the closed options, forwards the API key, and folds the decision', async () => {
    const { t, calls } = fake({ '/judge/ref': refReply }); t.apiKey = 'k1';
    const d = await judge(t, JOB, { state: { reply: 'ok' } });
    expect(calls[0]!.headers['x-api-key']).toBe('k1'); expect(calls[0]!.body).toMatchObject({ state: { reply: 'ok' }, question: DEFAULT_GUARD.question, options: [...JEV_OPTIONS], chainId: 8453, jobId: JOB });
    expect(d.ending).toBe('Settled'); expect(d.decision.anchor.status).toBe('ok');
  });
  it('judge: a quota refusal surfaces as OnboardError with the status and the body (the price)', async () => {
    const body = { ok: false, error: 'the 3 free calls are used', price: { usdc_per_block: 0.15 } };
    const { t } = fake({ '/judge/ref': body }, { '/judge/ref': 402 });
    await expect(judge(t, JOB, { state: 'x' })).rejects.toBeInstanceOf(OnboardError);
    await expect(judge(t, JOB, { state: 'x' })).rejects.toMatchObject({ status: 402, message: 'the 3 free calls are used', body });
  });
  it('judge honours a custom bar through the guard', async () => {
    const { t } = fake({ '/judge/ref': { ...refReply, answer: { ...refReply.answer, confidence: 0.75, probabilities: { delivered_as_specified: 0.75 } } } });
    expect((await judge(t, JOB, { state: 'x' })).ending).toBe('NoGrade');
    expect((await judge(t, JOB, { state: 'x' }, { bar: 0.7 as unknown as 0.8 })).ending).toBe('Settled');
  });
  it('record finds the seller’s pool row case-insensitively; a missing feed gives the thin record', async () => {
    const { t } = fake({ '/pools': { pools: [poolRow] } });
    expect((await record(t, SELLER.toUpperCase().replace('0X', '0x') as `0x${string}`)).settled).toBe(16);
    expect((await record(t, BUYER)).settled).toBe(0);
    const { t: t2 } = fake({}); expect(await record(t2, SELLER)).toEqual(emptyRecord(SELLER));
  });
  it('assess runs attest and record together and returns the predicate', async () => {
    const { t } = fake({ '/registry/agents/8453/17449': registryRecord, '/pools': { pools: [] } });
    const h = await assess(t, cand({ agentId: 17449n, address: registryRecord.owner as `0x${string}` }));
    expect(h.hireable).toBe(true); expect(h.attestation.state).toBe('ATTESTED'); expect(h.record.wilson).toBeNull();
  });
  it('a non-JSON error still becomes an OnboardError naming the path and status', async () => {
    const t: OnboardTransport = { base: '/p', fetch: async () => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } }) };
    await expect(quote(t, cand(), { task: 'x', price: 1n, deadline: 1 })).rejects.toMatchObject({ status: 502, message: 'POST /assurance/quote → 502' });
  });
});

// 0.8.0: aligned with the coordination layer as it answers on 2026-10-21. Every fixture here is a recorded live answer
// (test/fixtures/layer/*-2026-10-21.json, examples/data/x402-wall-402.json); LIVE=1 runs the same reads live (live.test.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverTypedDataAddress } from 'viem';
import { CoordError, refusalOf, okOrThrow } from '../src/errors/index.js';
import { coverQuotePlan, quoteCover, DEFAULT_COVER_VENUE, COVER_VENUES } from '../src/cover/index.js';
import { parseJobRef, jobRefKey, holdOf, readJobs, ACP_V3 } from '../src/jobs/index.js';
import {
  pickAccept, baseAccept, chainIdOf, caipOf, transferAuthorization, paymentHeaders, paymentHeader, paymentPayload, x402FromHeader, quoteWall, subscribe,
  PAYMENT_HEADER, LEGACY_PAYMENT_HEADER, X402_SOLANA_NETWORK,
} from '../src/x402/index.js';
import { sellerRailOf, quoteSale, quoteBase, attestSale, subscribePlan, readSale, readResellerView, SELLER_VENUES } from '../src/resale/index.js';
import { readProof } from '../src/proof/index.js';
import { POOL_LINE, poolChainOf, depositCalls, BASE_GLMR } from '../src/pools/index.js';
import { judge, OnboardError } from '../src/onboard/index.js';
import {
  systemOneRequest, askSystemOne, askJev, jevModel, JEV_MODEL_ALIASES, SYSTEM_ONE_URL, gradeJob, systemOneFetch,
  answerRecordedAt, answerLogTotals, readJudgeAdapter, ANSWER_LOGS,
} from '../src/judge/index.js';
import { JEV_ANSWER_LOG, JEV_ANSWER_LOG_V2, JUDGE_ADAPTER_V5, REGISTRY } from '../src/acp/moonbeam-acp.generated.js';
import { toOutcome } from '../src/acp/outcome.js';
import { foldTask } from '../src/acp/lifecycle.js';
import { localClock } from '../src/index.js';
import { encodeFunction, encodeParams } from '../src/abi/index.js';
import type { BaseReader } from '../src/rpc/index.js';

const root = join(import.meta.dirname, '..');
const fx = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const R = fx('test/fixtures/layer/refusals-2026-10-21.json');
const WALL = fx('examples/data/x402-wall-402.json');
const RULE = fx('test/fixtures/layer/settle-rule.vectors.json');
const BUYER = '0x0000000000000000000000000000000000000001';

type Call = { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } | undefined };
/** a transport answering one recorded (status, body); the calls it saw are kept */
function answering(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: Call[] = [];
  const t = {
    base: 'https://layer.test/v1',
    fetch: async (url: string, init?: Call['init']) => {
      calls.push({ url, init });
      return { ok: status >= 200 && status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body), headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } };
    },
  };
  return { t, calls };
}

describe('1. GET /v1/cover/quote names its venue', () => {
  it('the plan sends venue (default erc8183), and takes it as a parameter', () => {
    expect(DEFAULT_COVER_VENUE).toBe('erc8183');
    const p = coverQuotePlan({ buyer: BUYER, job: 1, network: 'devnet' });
    expect(p.query).toMatchObject({ venue: 'erc8183', buyer: BUYER, job: '1', network: 'devnet' });
    expect(p.path).toMatch(/^\/cover\/quote\?venue=erc8183&/);
    expect(coverQuotePlan({ buyer: BUYER, venue: 'memo-acp', job: '77' }).query.venue).toBe('memo-acp');
    expect(COVER_VENUES).toEqual(['erc8183', 'bitagent', 'memo-acp', 'x402', 'olas-mech']);
  });
  it('a keyed job id names its venue and chain; inputs a venue cannot be quoted from are refused before any call', () => {
    expect(coverQuotePlan({ buyer: BUYER, job: 'bitagent:8453:8566' }).query).toMatchObject({ venue: 'bitagent', chain: '8453', job: '8566' });
    expect(() => coverQuotePlan({ buyer: BUYER, venue: 'erc8183', job: 'bitagent:8453:8566' })).toThrow(/names venue bitagent/);
    expect(() => coverQuotePlan({ buyer: BUYER })).toThrow(/names the job/);
    expect(() => coverQuotePlan({ buyer: BUYER, venue: 'x402' })).toThrow(/pay_to, amount and nonce/);
    expect(() => coverQuotePlan({ buyer: 'me', job: 1 })).toThrow(/buyer/);
    expect(() => coverQuotePlan({ buyer: BUYER, job: `0x${'ab'.repeat(32)}` })).toThrow(/hook/);
  });
  it('quoteCover: the layer\'s 409 is an answer (insurable: false, why[]); its 400 "venue is required" a CoordError', async () => {
    const { t, calls } = answering(R.cover_not_insurable.status, R.cover_not_insurable.body);
    const q = await quoteCover(t as never, { buyer: BUYER, job: 1, network: 'devnet' });
    expect(q).toMatchObject({ ok: false, insurable: false });
    if (!q.ok) expect(q.why).toContain('only the job’s client can buy cover on it');
    expect(calls[0]!.url).toMatch(/venue=erc8183/);
    const bad = answering(R.cover_no_venue.status, R.cover_no_venue.body);
    const e = await quoteCover(bad.t as never, { buyer: BUYER, job: 1 }).catch((x) => x);
    expect(e).toBeInstanceOf(CoordError); expect(e).toMatchObject({ status: 400, code: 'bad_param' }); expect(e.message).toMatch(/venue is required/);
  });
});

describe('2. refusals in both shapes, one reader everywhere', () => {
  const openaiOnly = { error: R.openai_invalid_key.body.error };
  it('refusalOf reads the OpenAI error object and the layer\'s own string, and never throws', () => {
    expect(refusalOf(openaiOnly, 401, 'x')).toMatchObject({ status: 401, message: 'that API key is not valid, or has been revoked', type: 'authentication_error', code: 'invalid_api_key', param: null });
    expect(refusalOf(R.openai_invalid_key.body, 401, 'x')).toMatchObject({ message: 'that API key is not valid, or has been revoked', code: 'invalid_api_key' });
    expect(refusalOf(R.cover_no_venue.body, 400, 'x')).toMatchObject({ message: 'venue is required', code: 'bad_param', type: null });
    expect(refusalOf({ error: { type: 'x' } }, 500, 'fallback').message).toBe('fallback');
    expect(refusalOf({ error: { message: 'm', param: 'model' } }, 400, 'f')).toMatchObject({ message: 'm', param: 'model' });
    for (const odd of [null, undefined, 'plain text', 42, [], { error: 7 }, { error: null }]) expect(() => refusalOf(odd, 500, 'f')).not.toThrow();
    expect(new CoordError(refusalOf(openaiOnly, 401, 'x')).message).toBe('that API key is not valid, or has been revoked (invalid_api_key)');
    expect(() => okOrThrow({ ok: true, status: 200 }, { ok: false, error: { message: 'inner' } }, 'GET /x')).toThrow(/inner/);
  });
  const reads: [string, (t: never) => Promise<unknown>][] = [
    ['proof', (t) => readProof(t, `0x${'12'.repeat(32)}`)],
    ['resale sale', (t) => readSale(t, 'rs_abc_0123456789')],
    ['reseller view', (t) => readResellerView(t)],
    ['onboard judge', (t) => judge(t, `0x${'12'.repeat(32)}` as never, { state: 'x' })],
    ['x402 wall', (t) => quoteWall(t, '/x402/class/mcp.digest')],
    ['cover', (t) => quoteCover(t, { buyer: BUYER, job: 1 })],
    ['jobs', (t) => readJobs(t, [74926])],
  ];
  for (const [name, read] of reads) {
    it(`${name}: an OpenAI-shaped refusal throws a CoordError with its words, never "[object Object]"`, async () => {
      const e = await read(answering(401, openaiOnly).t as never).catch((x: CoordError) => x) as CoordError;
      expect(e).toBeInstanceOf(CoordError);
      expect(e.message).toMatch(/that API key is not valid/); expect(e.message).not.toMatch(/object Object/);
      expect(e).toMatchObject({ status: 401, code: 'invalid_api_key', type: 'authentication_error' });
      const f = await read(answering(400, R.cover_no_venue.body).t as never).catch((x: CoordError) => x) as CoordError;
      expect(f).toBeInstanceOf(CoordError); expect(f.code).toBe('bad_param');
    });
  }
  it('an OnboardError is a CoordError (status, code and body kept)', async () => {
    const e = await judge(answering(402, { ok: false, code: 'payment_required', error: { message: 'no free grade left' } }).t as never, `0x${'12'.repeat(32)}` as never, { state: 'x' }).catch((x) => x);
    expect(e).toBeInstanceOf(OnboardError); expect(e).toBeInstanceOf(CoordError);
    expect(e).toMatchObject({ status: 402, code: 'payment_required' }); expect(e.message).toMatch(/no free grade left/);
  });
  it('subscribe returns a refusal (either shape) instead of throwing on it', async () => {
    const s = await subscribe(answering(429, openaiOnly).t as never);
    expect(s.accept).toBeNull(); expect(s.refusal).toMatchObject({ status: 429, code: 'invalid_api_key' });
  });
});

describe('3. Jev over System One: TypeSafe by default, or a coordination door', () => {
  const questions = { spec_met: { type: 'choice' as const, instructions: 'met?', criteria: { yes: 'yes', no: 'no' } } };
  it('the default door is api.typesafe.ai with your key as Bearer', () => {
    const r = systemOneRequest(undefined, 'k_typesafe', { model: 'jev-1.13.0', state: 's', questions });
    expect(r.url).toBe(`${SYSTEM_ONE_URL}/v1/systemone`); expect(SYSTEM_ONE_URL).toBe('https://api.typesafe.ai');
    expect(r.headers).toMatchObject({ authorization: 'Bearer k_typesafe' }); expect(r.headers['x-api-key']).toBeUndefined();
  });
  it('the coordination door: <base>/systemone, X-API-Key = your coordination key, x-systemone-key = your provider key; the same body', () => {
    const r = systemOneRequest({ via: 'coord', base: 'https://layer.test/v1/', apiKey: 'tfr_test', provider: 'typesafe' }, 'k_typesafe', { model: 'jev-1-14-0', state: 's', questions });
    expect(r.url).toBe('https://layer.test/v1/systemone');
    expect(r.headers).toEqual({ 'content-type': 'application/json', accept: 'application/json', 'x-api-key': 'tfr_test', 'x-systemone-key': 'k_typesafe', 'x-systemone-provider': 'typesafe' });
    expect(JSON.parse(r.body)).toEqual({ model: 'jev-1.14.0', state: 's', questions });
    expect(() => systemOneRequest({ via: 'coord', base: 'http://layer.test/v1', apiKey: 'tfr_test' }, 'k', { model: 'm', state: 1, questions })).toThrow(/https/);
    expect(() => systemOneRequest({ via: 'coord', base: 'https://layer.test/v1', apiKey: '' }, 'k', { model: 'm', state: 1, questions })).toThrow(/coordination key/);
  });
  it('model aliases: jev-1-13-0 → jev-1.13.0, jev-1-14-0 → jev-1.14.0, typesafe-jev → jev-latest', () => {
    expect(JEV_MODEL_ALIASES).toEqual({ 'jev-1-13-0': 'jev-1.13.0', 'jev-1-14-0': 'jev-1.14.0', 'typesafe-jev': 'jev-latest' });
    expect(['jev-1-13-0', 'jev-1-14-0', 'typesafe-jev', 'jev-1.13.0'].map(jevModel)).toEqual(['jev-1.13.0', 'jev-1.14.0', 'jev-latest', 'jev-1.13.0']);
  });
  const ANSWER = { model: 'jev-1.13.0', answers: { spec_met: { type: 'choice', choice: 'yes', confidence: 0.93, probabilities: { yes: 0.93, no: 0.07 } } }, usage: { input_tokens: 10, output_tokens: 2 } };
  it('askSystemOne (askJev) returns the same answer shape from either door; a refusal of the door is a CoordError', async () => {
    expect(askJev).toBe(askSystemOne);
    const seen: Call[] = [];
    const f = async (url: string, init: Call['init']) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => ANSWER }; };
    const a = await askSystemOne({ state: 's', questions, key: 'k', route: { via: 'coord', base: 'https://layer.test/v1', apiKey: 'tfr_test' }, model: 'typesafe-jev', fetch: f as never });
    expect(a).toEqual(ANSWER); expect(JSON.parse(seen[0]!.init!.body!).model).toBe('jev-latest');
    const no = async () => ({ ok: false, status: 409, json: async () => ({ ok: false, code: 'resale_not_live', error: 'the provider is in byok: send x-systemone-key' }) });
    const e = await askSystemOne({ state: 's', questions, key: 'k', route: { via: 'coord', base: 'https://layer.test/v1', apiKey: 'tfr_test' }, fetch: no as never }).catch((x) => x);
    expect(e).toBeInstanceOf(CoordError); expect(e.code).toBe('resale_not_live');
    const s1 = await askSystemOne({ state: 's', questions, key: 'k', fetch: (async () => ({ ok: false, status: 401, json: async () => R.systemone_no_key.body })) as never }).catch((x) => x);
    expect(s1.message).toMatch(/X-API-Key header required/);
  });
  it('gradeJob through the coordination door: the grader\'s System One call carries the door\'s headers, and grades', async () => {
    const seen: Call[] = [];
    const rubricAnswers = { spec_met: 'yes', unsupported_claim: 'no', ending: 'complete', cheat_shaped: 'no' } as Record<string, string>;
    const f = async (url: string, init: Call['init']) => {
      seen.push({ url, init });
      const qs = Object.keys(JSON.parse(init!.body!).questions);
      return { ok: true, status: 200, json: async () => ({ model: 'jev-1.13.0', answers: Object.fromEntries(qs.map((q) => [q, { type: 'choice', choice: rubricAnswers[q] ?? 'no', confidence: 0.97, probabilities: { [rubricAnswers[q] ?? 'no']: 0.97 } }])) }) };
    };
    const receipt = await gradeJob({ jobId: `0x${'5b'.repeat(32)}`, evidence: { task: 'say hi', delivery: 'hi' }, key: 'k_typesafe', systemOne: { via: 'coord', base: 'https://layer.test/v1', apiKey: 'tfr_test' }, fetch: f as never });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://layer.test/v1/systemone');
    expect(seen[0]!.init!.headers).toMatchObject({ 'x-api-key': 'tfr_test', 'x-systemone-key': 'k_typesafe' });
    expect(seen[0]!.init!.headers!['authorization']).toBeUndefined();
    expect(receipt.verdict).toBe('complete');
    const wrapped = systemOneFetch({ via: 'coord', base: 'https://layer.test/v1', apiKey: 'tfr_test' }, (async () => ({ ok: false, status: 401, json: async () => R.openai_invalid_key.body })) as never);
    await expect(wrapped('x', { headers: { authorization: 'Bearer k' }, body: JSON.stringify({ model: 'jev-1.13.0', state: 1, questions }) })).rejects.toThrow(/not valid/);
  });
});

describe('4. x402: PAYMENT-SIGNATURE, and the offer chosen by network', () => {
  it('the recorded wall offers six networks, Solana among them; the entry is chosen by network, Base by default', () => {
    expect(WALL.x402.accepts.map((a: { network: string }) => a.network)).toEqual(['eip155:8453', 'eip155:42161', 'eip155:5042', 'eip155:4663', 'eip155:143', X402_SOLANA_NETWORK]);
    expect(pickAccept(WALL).network).toBe('eip155:8453');
    expect(pickAccept(WALL, { network: 'arbitrum' })).toMatchObject({ network: 'eip155:42161', asset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' });
    expect(pickAccept(WALL, { network: ['eip155:10', 'robinhood', 'base'] }).network).toBe('eip155:4663');
    expect(pickAccept(WALL, { network: 'solana' })).toMatchObject({ payTo: 'GQcEn5pLcweo7qaiy3rDdsiUPiygygmFBaixNtNqhQVD', extra: { feePayer: 'F742C4VfFLQ9zRQyithoj5229ZgtX2WqKCSFKgH2EThq' } });
    expect(() => pickAccept(WALL, { network: 'eip155:10' })).toThrow(/no exact payment on eip155:10 \(it offers: eip155:8453/);
    expect(baseAccept(WALL).network).toBe('eip155:8453');
    expect([chainIdOf('base'), chainIdOf('eip155:5042'), chainIdOf('solana'), caipOf('monad')]).toEqual([8453, 5042, null, 'eip155:143']);
  });
  it('the EIP-3009 typed data is on the entry\'s own chain (Arbitrum: 42161); a Solana entry is refused, not mis-built', async () => {
    const acct = privateKeyToAccount(`0x${'59'.repeat(32)}`);
    const arb = pickAccept(WALL, { network: 'arbitrum' });
    const t = transferAuthorization(arb, { from: acct.address, nonce: `0x${'01'.repeat(32)}`, now: 1_000 });
    expect(t.domain).toEqual({ name: 'USD Coin', version: '2', chainId: 42161, verifyingContract: arb.asset });
    expect(t.message).toMatchObject({ to: arb.payTo, value: '5455', validBefore: '1300' });
    const sig = await acct.signTypedData(t as never);
    expect(await recoverTypedDataAddress({ ...(t as unknown as Record<string, unknown>), signature: sig } as never)).toBe(acct.address);
    expect(transferAuthorization(pickAccept(WALL, { network: 'robinhood' }), { from: acct.address }).domain).toMatchObject({ name: 'Global Dollar', version: '1', chainId: 4663 });
    expect(() => transferAuthorization(pickAccept(WALL, { network: 'solana' }), { from: acct.address })).toThrow(/not an EIP-3009 transfer/);
  });
  it('v2 travels in PAYMENT-SIGNATURE with the accepted entry; X-PAYMENT for v1, or beside it with legacy', () => {
    const a = baseAccept(WALL);
    const auth = { from: BUYER, to: a.payTo, value: '5455', validAfter: '0', validBefore: '9', nonce: `0x${'22'.repeat(32)}` };
    const sig = `0x${'11'.repeat(65)}`;
    expect(PAYMENT_HEADER).toBe('PAYMENT-SIGNATURE'); expect(LEGACY_PAYMENT_HEADER).toBe('X-PAYMENT');
    const h = paymentHeaders(a, auth, sig);
    expect(Object.keys(h)).toEqual(['PAYMENT-SIGNATURE']);
    expect(JSON.parse(Buffer.from(h['PAYMENT-SIGNATURE']!, 'base64').toString())).toEqual({ x402Version: 2, accepted: a, payload: { signature: sig, authorization: auth } });
    expect(Object.keys(paymentHeaders(a, auth, sig, { legacy: true }))).toEqual(['PAYMENT-SIGNATURE', 'X-PAYMENT']);
    expect(Object.keys(paymentHeaders(a, auth, sig, { x402Version: 1 }))).toEqual(['X-PAYMENT']);
    expect(paymentPayload(a, auth, sig, 1)).toEqual({ x402Version: 1, scheme: 'exact', network: 'eip155:8453', payload: { signature: sig, authorization: auth } });
    expect(paymentHeader(a, auth, sig)).toBe(h['PAYMENT-SIGNATURE']);
  });
  it('a 402 whose body has no accepts is read from its PAYMENT-REQUIRED header', async () => {
    const header = Buffer.from(JSON.stringify(WALL.x402)).toString('base64');
    expect(x402FromHeader(header).accepts).toHaveLength(6);
    const { t } = answering(402, { ok: false, code: 'payment_required' }, { 'payment-required': header });
    const w = await quoteWall(t as never, '/x402/class/mcp.digest', { network: 'eip155:5042' });
    expect(w.accept).toMatchObject({ network: 'eip155:5042', asset: '0x3600000000000000000000000000000000000000' });
  });
  it('subscribe picks the entry of the plan\'s chain', async () => {
    const s = await subscribe(answering(402, WALL).t as never, subscribePlan({ usdc: 1, chainId: 42161 }));
    expect(s.accept?.network).toBe('eip155:42161');
  });
});

describe('5. the seller\'s leg settles on the seller\'s own venue (SETTLE_ON_SELLER_VENUE_v1)', () => {
  it('sellerRailOf passes every vector the layer publishes for the rule', () => {
    expect(RULE.rule).toBe('SETTLE_ON_SELLER_VENUE_v1');
    expect(RULE.vectors.length).toBeGreaterThanOrEqual(10);
    for (const v of RULE.vectors) expect(sellerRailOf(v.in), v.id).toEqual(v.want);
  });
  it('quoteSale prices a seller hired on any venue the scheme knows; the buyer side stays on Base; quoteBase keeps both on Base', () => {
    const sol = quoteSale({ venue_in: 'x402-base', venue_out: 'x402-solana', seller_price: 9207n });
    expect(sol.ok).toBe(true); if (sol.ok) expect(sol.legs.find((l: { leg: string }) => l.leg === 'seller_share')).toMatchObject({ venue: 'x402-solana', units: '9207' });
    expect(SELLER_VENUES).toContain('acpv3-arc');
    expect(quoteSale({ venue_in: 'x402-solana' as never, venue_out: 'x402-base', seller_price: 1n })).toMatchObject({ ok: false });
    expect(quoteSale({ venue_in: 'x402-base', venue_out: 'nowhere', seller_price: 1n })).toMatchObject({ ok: false });
    expect(quoteBase({ venue_in: 'x402-base', venue_out: 'x402-solana' as never, seller_price: 1n })).toMatchObject({ ok: false });
  });
  it('the network is a field: attestSale, subscribePlan and the pool builders take it; Moonbeam\'s pool line stays GLMR on Base', () => {
    expect(attestSale({ saleKey: 'rs_x_0123456789', step: 'settled', chainId: 42161 }, { networks: 'none' }).mark.subject).not.toBe(attestSale({ saleKey: 'rs_x_0123456789', step: 'settled' }, { networks: 'none' }).mark.subject);
    expect(subscribePlan({ usdc: 1, chainId: 5042 }).body.chainId).toBe(5042);
    expect(() => subscribePlan({ usdc: 1, chainId: -1 })).toThrow(/chain id/);
    expect(POOL_LINE).toEqual({ network: 'eip155:8453', chainId: 8453, asset: BASE_GLMR, symbol: 'GLMR', decimals: 18 });
    expect(poolChainOf({ network: 'eip155:36927' })).toBe(36927);
    expect(() => poolChainOf({ network: 'solana:x' })).toThrow(/eip155/);
    const calls = depositCalls({ network: 'eip155:36927', pool: `0x${'aa'.repeat(20)}`, asset: BASE_GLMR, amount: 10n ** 19n, receiver: BUYER });
    expect(calls.every((c) => c.chainId === 36927)).toBe(true);
    expect(() => depositCalls({ network: POOL_LINE.network, pool: `0x${'aa'.repeat(20)}`, asset: BASE_GLMR, amount: 10n ** 19n, receiver: BUYER })).toThrow(/not open/);
  });
});

describe('6. job views: needs_review is its own hold; contract-keyed ids', () => {
  it('a bare number is ACP v3 on Base; <label>:<chain>:<id> names its contract; a 32-byte id is a hook job', () => {
    expect(parseJobRef(74926)).toEqual({ kind: 'acp-v3', label: 'acp-v3', chainId: 8453, jobId: '74926' });
    expect(ACP_V3.contract).toBe('0x238E541BfefD82238730D00a2208E5497F1832E0');
    expect(parseJobRef('bitagent:8453:8566')).toEqual({ kind: 'contract', label: 'bitagent', chainId: 8453, jobId: '8566' });
    expect(parseJobRef(`0x${'AB'.repeat(32)}`)).toMatchObject({ kind: 'hook', chainId: null, jobId: `0x${'ab'.repeat(32)}` });
    for (const id of ['74926', 'bitagent:8453:8566', 'bitagent:56:12', `0x${'ab'.repeat(32)}`]) expect(jobRefKey(parseJobRef(id))).toBe(id);
    expect(() => parseJobRef('job-1')).toThrow(/bitagent:8453:8566/);
  });
  it('holdOf: needs_review (graded, a person reviews) is not awaiting_grade (nobody has graded)', () => {
    expect(holdOf({ verdict: 'needs_review', decision: 'decision-9' })).toEqual({ held_by: 'needs_review', why: 'graded, not finally: a person reviews the decision (decision-9)', decision: 'decision-9' });
    expect(holdOf({ verdict: null }).held_by).toBe('awaiting_grade');
  });
  it('toOutcome: a submitted job whose grade came back needs_review is pending needsReview, not awaitingGrading', () => {
    const A = (n: number) => `0x${String(n).repeat(40)}` as const;
    const s = foldTask([
      { kind: 'jobCreated', jobId: 1n, client: A(1), provider: A(2), evaluator: A(3), expiredAt: 1_800_000_000, hook: `0x${'0'.repeat(40)}` },
      { kind: 'jobFunded', jobId: 1n, payer: A(1), amount: 1_000_000n },
      { kind: 'jobSubmitted', jobId: 1n, provider: A(2), memoHash: `0x${'cd'.repeat(32)}` },
    ] as never);
    const clock = localClock(1_800_000_000 - 100);
    expect(toOutcome(s, clock)).toEqual({ verdict: null, pending: 'awaitingGrading' });
    expect(toOutcome(s, clock, { verdict: 'needs_review' })).toEqual({ verdict: null, pending: 'needsReview' });
    expect(toOutcome(s, clock, { verdict: 'complete' })).toEqual({ verdict: null, pending: 'awaitingGrading' });
  });
  it('readJobs sends keyed and bare ids in one read, and marks a needs_review row held', async () => {
    const rows = { ok: true, jobs: [
      { id: 'bitagent:8453:8566', found: true, source: 'observatory', job: { jobId: 'bitagent:8453:8566', ending: 'open', verdict: 'excluded:open' } },
      { id: '74926', found: true, source: 'observatory', job: { jobId: '74926', ending: 'completed', verdict: 'excluded:unpaid' } },
      { id: `0x${'cd'.repeat(32)}`, found: true, source: 'observatory', job: { ending: 'expired_delivered', verdict: 'needs_review', decision_id: 'd-1' } },
    ] };
    const { t, calls } = answering(200, rows);
    const out = await readJobs(t as never, ['bitagent:8453:8566', 74926, `0x${'cd'.repeat(32)}`]);
    expect(decodeURIComponent(calls[0]!.url)).toContain(`/jobs?ids=bitagent:8453:8566,74926,0x${'cd'.repeat(32)}`);
    expect(out.map((r) => r.ref?.kind)).toEqual(['contract', 'acp-v3', 'hook']);
    expect(out.map((r) => r.hold?.held_by ?? null)).toEqual([null, null, 'needs_review']);
    await expect(readJobs(t as never, ['nope'])).rejects.toThrow(RangeError);
  });
});

describe('7. both answer logs and JudgeAdapterV5 on Base', () => {
  it('the registry names both answer logs and the adapter (generated from the address registry)', () => {
    expect(JEV_ANSWER_LOG.address).toBe('0x8e9B9cE86a2d55c10318607b0c815B7B8C66254d');
    expect(JEV_ANSWER_LOG_V2).toMatchObject({ name: 'JevAnswerLogV2', address: '0xC08dfc61d702AEA45d1EF2515d8BDA36d548C75c', chainId: 8453, status: 'live' });
    expect(JUDGE_ADAPTER_V5).toMatchObject({ name: 'JudgeAdapterV5', address: '0x5242dE388a846d16641744dEB095eD63990E7be8', chainId: 8453, status: 'live' });
    expect(REGISTRY).toMatchObject({ answerLogV2: JEV_ANSWER_LOG_V2.address, judgeAdapterV5: JUDGE_ADAPTER_V5.address });
    expect(ANSWER_LOGS.map((l) => l.name)).toEqual(['JevAnswerLog', 'JevAnswerLogV2']);
  });
  // a reader answering the values read on Base at block 52,904,287 (2026-10-21)
  const D = `0x${'ab'.repeat(32)}`;
  const word = (types: string[], v: unknown[]) => encodeParams(types, v as never);
  const reader: BaseReader = {
    chainId: 8453, urls: async () => ['mock'],
    call: async <T,>(_m: string, p: readonly unknown[]) => {
      const { to, data } = p[0] as { to: string; data: string };
      const at = (a: string) => to.toLowerCase() === a.toLowerCase();
      if (data === encodeFunction('recordedAt(bytes32)', [D])) return word(['uint64'], [at(JEV_ANSWER_LOG.address) ? 0 : 52_700_000]) as T;
      if (data === encodeFunction('total()', [])) return word(['uint256'], [at(JEV_ANSWER_LOG.address) ? 41n : 0n]) as T;
      if (at(JUDGE_ADAPTER_V5.address) && data === encodeFunction('hook()', [])) return word(['address'], ['0x93122A47d1824afFA3bAa5751aacf4919F67eb25']) as T;
      if (at(JUDGE_ADAPTER_V5.address) && data === encodeFunction('decisionLog()', [])) return word(['address'], [REGISTRY.decisionLog]) as T;
      if (at(JUDGE_ADAPTER_V5.address) && data === encodeFunction('releaseDelay()', [])) return word(['uint64'], [3600]) as T;
      throw new Error(`unexpected call ${to} ${data.slice(0, 10)}`);
    },
  };
  it('answerRecordedAt looks the digest up in both logs', async () => {
    const r = await answerRecordedAt(reader, D);
    expect(r.recorded).toBe(true);
    expect(r.logs).toEqual([{ name: 'JevAnswerLog', address: JEV_ANSWER_LOG.address, block: 0 }, { name: 'JevAnswerLogV2', address: JEV_ANSWER_LOG_V2.address, block: 52_700_000 }]);
    await expect(answerRecordedAt(reader, '0x12')).rejects.toThrow(/32 bytes/);
    expect((await answerLogTotals(reader)).map((x) => x.total)).toEqual([41n, 0n]);
  });
  it('readJudgeAdapter reads the adapter\'s hook, decision log and delay', async () => {
    expect(await readJudgeAdapter(reader)).toEqual({ address: JUDGE_ADAPTER_V5.address, hook: '0x93122a47d1824affa3baa5751aacf4919f67eb25', decisionLog: REGISTRY.decisionLog.toLowerCase(), releaseDelay: 3600 });
  });
});

describe('8. the package depends on no workflow-node package, and its public text names no internal host', () => {
  const pkg = fx('package.json');
  it('dependencies are the grader and the premium maths only', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@taifoon/jev', '@taifoon/jev-wilson']);
    expect(pkg.version).toBe('0.8.0');
    for (const m of ['./cover', './jobs', './errors']) expect(pkg.exports[m]).toBeDefined();
  });
  it('README, examples and skills name neither the layer\'s host nor n8n', () => {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const files = ['README.md', ...readdirSync(join(root, 'examples')).filter((f: string) => f.endsWith('.mjs') || f.endsWith('.md')).map((f: string) => `examples/${f}`)];
    for (const f of files) {
      const text = readFileSync(join(root, f), 'utf8');
      expect(text, f).not.toMatch(/taifoon\.dev|coord\.taifoon|\bn8n\b/i);
    }
  });
});

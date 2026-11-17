// _PLAYGROUND_STREAM_v1_: the coord stream port of the playground (src/playground/stream.ts), against a FAKE transport only.
//   1. the request bodies: POST /v1/settle, the sign envelope on POST /v1/pipe/send, its ack, and the proof read, field by field
//      as coord's contracts name them (lang/cue/sign.cue sign.request, lang/cue/api-bodies.cue PipeEnvelope · PipeAck);
//   2. the purpose-to-network check, both ways, before any request;
//   3. the signer's answers: shadow (would sign), a refusal with the signer's code, and 401 · 402 · 429 → StreamRefused, never retried;
//   4. a light turns on only from an ack plus a proven transaction;
//   5. a shadow run reports every Moonbeam step as "would sign" and no light past Bought;
//   6. the live script's guard: LIVE=1 and the devnet only.
// No request leaves the process: the transport is a function that records what it is asked and answers coord's shapes.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getAddress, keccak256, toBytes, type Hex } from 'viem';
import type { EconomyQuote } from '../src/economy/index.js';
import type { OnboardTransport } from '../src/onboard/index.js';
import {
  StreamRefused, coordStream, fakePorts, playground, purposeNetRefusal, settleBody, signedText, SIGN_REQUEST_SCHEMA,
} from '../src/playground/index.js';
import type { CaseId, CoordStreamOptions, Placement, PlanArgs, PlanStep, Ports, Via } from '../src/playground/index.js';

const A = (b: string): `0x${string}` => getAddress(`0x${b.repeat(40 / b.length)}`);
const DEV: Placement = { chainId: 36927, hook: A('a1'), token: A('a4'), judgeAdapter: A('a2'), pool: A('a3'), vault: A('a5') };
const BASE: Placement = { chainId: 8453, hook: A('c1'), token: A('c4'), judgeAdapter: A('c2'), pool: A('c3'), vault: A('c5'), windows: { reviewS: 60, disputeS: 60, arbitrationS: 120 } };
const PARTIES = { buyer: A('b1'), seller: A('b2'), backer: A('b3') };
const QUOTE: EconomyQuote = { price: 1_000_000n, premium: 111_750n, toBackers: 94_803n, protocolFee: 16_947n, deposit: 1_111_750n,
  compensation: 111_750n, evaluatorFee: 10_000n, coverCap: 1_000_000n };
const args = (via?: Via): PlanArgs => ({ market: 'erc8183-base', quote: QUOTE, salt: ('0x' + '33'.repeat(32)) as Hex, parties: PARTIES, deadline: 1_800_000_660,
  evidenceDigest: ('0x' + '22'.repeat(32)) as Hex, verdictDigest: ('0x' + '44'.repeat(32)) as Hex, ...(via ? { via } : {}) });
const dev = playground({ net: 'devnet', placement: DEV });
const base = playground({ net: 'base', placement: BASE, allowMainnet: true, budget: { perRunUnits: 10_000_000n }, devnetGreen: { market: 'erc8183-base', runs: ['r1', 'r2'] } });
const REQUESTER = 'moonbeam-playground';
const PAYOUT_TX = ('0x' + 'ee'.repeat(32)) as Hex;
/** what the seller is owed on a completed job: the plan's own transfer, so the payout's Transfer matches it */
const sellerUnits = (): bigint => dev.plan('delivered-accepted', args()).steps.find((s) => s.ends)!.expects.transfers![0]!.units;

// ── the fake transport ──────────────────────────────────────────────────────────────────────────────────────────────────

interface Req { method: string; path: string; body: unknown; headers: Record<string, string> }
interface FakeCoord {
  /** the signer's mode for every devnet purpose (GET /v1/sign/status) */
  mode?: string;
  /** the sign result for a request: default from the mode (shadow → shadowed, armed → released) */
  result?: (purpose: string, requestId: string) => Record<string, unknown>;
  /** a status forced on one route (e.g. 402 on /pipe/send) */
  fail?: { path: RegExp; status: number };
  /** which transactions coord proves (default: all) */
  proven?: (tx: string) => boolean;
  /** the recorded settlement's transactions (GET /v1/settle/:id); null → 404 */
  settled?: () => string[] | null;
}

/** The fake chain is fakePorts' own: a wallet or a sender gets a transaction whose events the plan expects. */
function fakeCoord(f: FakeCoord = {}) {
  const fp = fakePorts();
  const log: Req[] = [];
  const inbox: Record<string, unknown>[] = [];
  let sends = 0;
  const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const t: OnboardTransport = {
    base: 'https://coord.example/v1',
    fetch: async (url, init) => {
      const path = url.replace('https://coord.example/v1', '');
      const body = init?.body ? JSON.parse(init.body) : undefined;
      log.push({ method: init?.method ?? 'GET', path, body, headers: init?.headers ?? {} });
      if (f.fail && f.fail.path.test(path)) return reply(f.fail.status, { ok: false, code: f.fail.status === 402 ? 'payment_required' : 'refused' });
      if (path === '/sign/status')
        return reply(200, { schema: 'taifoon.sign.status.v1', purposes: ['devnet.evaluate', 'devnet.arbitrate', 'devnet.keeper', 'devnet.payout']
          .map((id) => ({ id, mode: f.mode ?? 'shadow', key: 'devnet-tryout', vault: 'none', counts: null })) });
      if (path === '/pipe/send') {
        const id = keccak256(toBytes(`envelope:${++sends}`));
        const req = JSON.parse((body as { payload: string }).payload) as { purpose: string };
        const res = f.result ? f.result(req.purpose, id)
          : (f.mode ?? 'shadow') === 'shadow' ? { state: 'shadowed', would_sign: { to: '0x' + '0'.repeat(40), digest: '0x' + '0'.repeat(64) } }
          : { state: 'released', signature: '0x' + 'ab'.repeat(65) };
        inbox.push({ id: keccak256(toBytes(`result:${sends}`)), envelope: { kind: 'sign', reply_to: id, payload: JSON.stringify({ schema: 'taifoon.sign.result.v1', request: id, purpose: req.purpose, ...res, trace: { seq: sends, head: '0x' } }) } });
        return reply(200, { id, state: 'queued', carrier: 'inbox', batch: null });
      }
      if (path.startsWith(`/pipe/inbox/${REQUESTER}`)) return reply(200, { who: REQUESTER, envelopes: inbox.splice(0) });
      if (path === '/pipe/ack') return reply(200, { id: (body as { id: string }).id, state: 'acked' });
      let m = /^\/proof\/tx\/(\d+)\/(0x[0-9a-f]{64})$/.exec(path);
      if (m) { const ok = (f.proven ?? (() => true))(m[2]!); return reply(200, { ok: true, chain_id: Number(m[1]), tx: m[2], proven: ok, checks: { block_hash_matches: ok }, proof: ok ? {} : null }); }
      m = /^\/chain\/(\d+)\/tx\/(0x[0-9a-f]{64})$/.exec(path);
      if (m) {
        const events = m[2] === PAYOUT_TX ? [{ name: 'Transfer', args: { to: PARTIES.seller, value: sellerUnits() } }] : await fp.chain.event(m[2] as Hex);
        return reply(200, { tx: { hash: m[2], status: 'success', events: events.map((e) => ({ event: e.name, args: e.args ? Object.fromEntries(Object.entries(e.args).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])) : null })) }, final: true });
      }
      m = /^\/settle\/(0x[0-9a-f]{64})$/.exec(path);
      if (m) { const txs = f.settled ? f.settled() : null; return txs ? reply(200, { id: m[1], source: 'keeper', txs: txs.map((hash) => ({ role: 'tx', hash })) }) : reply(404, { ok: false, error: 'unknown' }); }
      if (path === '/settle') return reply(200, { ok: true, jobId: '0x' + '77'.repeat(32), calls: [] });
      return reply(404, { ok: false, error: `no route ${path}` });
    },
  };
  return { t, log, fp, paths: () => log.map((r) => `${r.method} ${r.path.split('?')[0]}`) };
}

const seal = async (text: string) => Buffer.from(keccak256(toBytes(text)).slice(2), 'hex').toString('base64');
const streamOf = (c: ReturnType<typeof fakeCoord>, o: Partial<CoordStreamOptions> = {}) =>
  coordStream(c.t, { requester: REQUESTER, seal, nonce: () => 'n1', now: () => Date.UTC(2026, 10, 17), ...o });
/** ports: the fake wallet and clock, the coord stream and its chain read */
const portsOf = (c: ReturnType<typeof fakeCoord>, cs: ReturnType<typeof coordStream>): Ports =>
  ({ wallet: c.fp.wallet, stream: cs, chain: { event: cs.chain.event, waitUntil: c.fp.chain.waitUntil } });
const stepOf = (id: CaseId, fn: string, via?: Via): PlanStep => dev.plan(id, args(via)).steps.find((s) => s.fn === fn)!;

// ── 1. bodies ───────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('_PLAYGROUND_STREAM_v1_ the request bodies', () => {
  it('POST /v1/settle: kind, chainId, buyer, seller, price, evidence, ref, deadline (the settle route\'s fields)', async () => {
    const c = fakeCoord();
    const cs = streamOf(c);
    const terms = { chainId: 36927, buyer: PARTIES.buyer, seller: PARTIES.seller, price: 1_000_000n, evidence: ('0x' + '22'.repeat(32)) as Hex, refId: 'job-1', deadline: 1_800_000_660, viaUs: true };
    expect(settleBody(terms)).toEqual({ kind: 'agent', chainId: 36927, buyer: PARTIES.buyer, seller: PARTIES.seller, price: '1000000',
      evidence: '0x' + '22'.repeat(32), ref: { id: 'job-1' }, deadline: 1_800_000_660, via: 'us' });
    const r = await cs.planSale(terms);
    expect(r.ok).toBe(true);
    expect(c.log).toHaveLength(1);
    expect(c.log[0]).toMatchObject({ method: 'POST', path: '/settle', body: settleBody(terms) });
  });

  it('the sign request: a pipe envelope of kind sign to the signer, its payload the ten request fields, sealed over schema + payload', async () => {
    const c = fakeCoord();
    const texts: string[] = [];
    const cs = streamOf(c, { seal: async (x) => { texts.push(x); return seal(x); } });
    const step = stepOf('no-show', 'expire');
    const ans = await cs.sign(step);
    expect(ans.status).toBe('shadow');
    expect(c.paths()).toEqual(['GET /sign/status', 'POST /pipe/send', 'GET /pipe/inbox/moonbeam-playground', 'POST /pipe/ack']);
    const env = c.log[1]!.body as Record<string, unknown>;
    expect(env).toMatchObject({ schema: 'taifoon.pipe.envelope.v1', kind: 'sign', from: { agent: REQUESTER }, to: { agent: 'coord-sign' },
      order_key: 'sign:devnet.keeper:n1', ttl_s: 600, reply_to: null, sig: { scheme: 'ed25519', by: REQUESTER } });
    const payload = env['payload'] as string;
    expect(env['payload_digest']).toBe(keccak256(toBytes(payload)));
    const body = JSON.parse(payload);
    // sign.cue sign.request.fields, in its order
    expect(Object.keys(body)).toEqual(['schema', 'purpose', 'requester', 'vault', 'key', 'request', 'evidence', 'nonce', 'at', 'ttl_s']);
    expect(body).toMatchObject({ schema: SIGN_REQUEST_SCHEMA, purpose: 'devnet.keeper', requester: REQUESTER, vault: 'none', key: 'devnet-tryout',
      request: { chain: 36927, to: DEV.hook, fn: 'expire', data: step.call.data, value: '0x0' }, evidence: null, nonce: 'n1', at: '2026-11-17T00:00:00.000Z' });
    // the request key signs "<schema>\n<payload>", and the envelope carries that signature
    expect(texts).toEqual([signedText(payload)]);
    expect((env['sig'] as { sig: string }).sig).toBe(await seal(signedText(payload)));
    // the inbox is read by long-poll on the server (wait=25), the result acked with the PipeAck body { id, by }
    expect(c.log[2]!.path).toBe('/pipe/inbox/moonbeam-playground?wait=25&limit=50');
    expect(c.log[3]!.body).toEqual({ id: expect.stringMatching(/^0x[0-9a-f]{64}$/), by: REQUESTER });
  });

  it('the proof read: GET /v1/proof/tx/<chain>/<hash>, and the events only once it is proven (GET /v1/chain/<chain>/tx/<hash>)', async () => {
    const tx = ('0x' + '12'.repeat(32)) as Hex;
    const c = fakeCoord({ proven: () => false });
    const cs = streamOf(c);
    expect(await cs.chain.event(tx)).toEqual([]);
    expect(c.paths()).toEqual([`GET /proof/tx/36927/${tx}`]);
    const c2 = fakeCoord();
    const open = (await c2.fp.wallet.sign(stepOf('no-show', 'openJobWithEconomy'))).tx!;
    const evs = await streamOf(c2).chain.event(open);
    expect(c2.paths()).toEqual([`GET /proof/tx/36927/${open}`, `GET /chain/36927/tx/${open}`]);
    expect(evs.map((e) => e.name)).toEqual(['JobOpened', 'EconomyCommitted']);
  });

  it('the port forwards only the transport\'s own header and reads no environment', async () => {
    const c = fakeCoord();
    const cs = coordStream({ ...c.t, apiKey: 'k-test' }, { requester: REQUESTER, seal });
    await cs.sign(stepOf('no-show', 'expire'));
    expect(c.log.every((r) => r.headers['x-api-key'] === 'k-test')).toBe(true);
    expect(() => coordStream(c.t, { requester: 'Not An Id' })).toThrow(/requester/);
  });
});

// ── 2. purpose to network ───────────────────────────────────────────────────────────────────────────────────────────────

describe('_PLAYGROUND_STREAM_v1_ a purpose signs on its own network only', () => {
  it('devnet.* on the devnet only; every other purpose never on the devnet; no third chain', () => {
    expect(purposeNetRefusal('devnet.keeper', 36927)).toBeNull();
    expect(purposeNetRefusal('keeper.end', 8453)).toBeNull();
    expect(purposeNetRefusal('devnet.payout', 8453)).toMatch(/devnet purpose: it never signs on chain 8453/);
    expect(purposeNetRefusal('payout.seller', 36927)).toMatch(/not a devnet purpose/);
    expect(purposeNetRefusal('test.evaluate', 36927)).toMatch(/test ref/);
    expect(purposeNetRefusal('devnet.keeper', 5042)).toMatch(/neither the devnet/);
  });

  it('a coord:devnet.* step on Base, and a Base purpose on the devnet, are refused before any request', async () => {
    const c = fakeCoord();
    const cs = streamOf(c);
    const baseKeeper = base.plan('no-show', args()).steps.find((s) => s.fn === 'expire')!;
    expect(baseKeeper.signer).toBe('coord:keeper.end');
    const a = await cs.sign({ ...baseKeeper, signer: 'coord:devnet.keeper' });
    expect(a).toMatchObject({ tx: null, status: 'refused', reason: expect.stringMatching(/^purpose_network: devnet\.keeper is a devnet purpose/) });
    const b = await cs.sign({ ...stepOf('no-show', 'expire'), signer: 'coord:keeper.end' });
    expect(b).toMatchObject({ tx: null, status: 'refused', reason: expect.stringMatching(/^purpose_network: keeper\.end is not a devnet purpose/) });
    expect(c.log).toEqual([]);
  });
});

// ── 3. answers ──────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('_PLAYGROUND_STREAM_v1_ the signer\'s answers', () => {
  it('shadow: "would sign", with what the signer built, and no transaction', async () => {
    const a = await streamOf(fakeCoord({ mode: 'shadow' })).sign(stepOf('delivered-accepted', 'postVerdict'));
    expect(a).toMatchObject({ tx: null, ack: null, status: 'shadow', would: { to: expect.any(String) } });
  });

  it('a refusal carries the signer\'s code and words', async () => {
    const c = fakeCoord({ result: () => ({ state: 'refused', refusal: { code: 'rule', why: 'sign-devnet-call: the contract is not one of the purpose\'s calls' } }) });
    const a = await streamOf(c).sign(stepOf('delivered-accepted', 'postVerdict'));
    expect(a).toEqual({ tx: null, ack: null, status: 'refused', reason: 'rule: sign-devnet-call: the contract is not one of the purpose\'s calls' });
    const t = await streamOf(fakeCoord({ result: () => ({ state: 'throttled', refusal: { code: 'throttled', why: 'a budget is spent' } }) })).sign(stepOf('no-show', 'expire'));
    expect(t.status).toBe('refused');
    expect(t.reason).toMatch(/^throttled:/);
  });

  it('a purpose the register does not name, or no seal, is not routable: nothing is sent', async () => {
    const c = fakeCoord();
    const a = await coordStream(c.t, { requester: REQUESTER }).sign(stepOf('no-show', 'expire'));
    expect(a).toMatchObject({ tx: null, status: 'not_routable', reason: expect.stringMatching(/no seal/) });
    expect(c.log).toEqual([]);
    const c2 = fakeCoord();
    const b = await streamOf(c2).sign({ ...stepOf('no-show', 'expire'), signer: 'coord:devnet.unknown' });
    expect(b).toMatchObject({ status: 'not_routable', reason: expect.stringMatching(/not in the signer's register/) });
    expect(c2.paths()).toEqual(['GET /sign/status']);
  });

  for (const status of [401, 402, 429] as const) {
    it(`a ${status} becomes StreamRefused and stops the run, asked once and never retried`, async () => {
      const c = fakeCoord({ fail: { path: /^\/pipe\/send$/, status } });
      const cs = streamOf(c);
      const e = await dev.run('no-show', args(), portsOf(c, cs)).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(StreamRefused);
      expect((e as StreamRefused).status).toBe(status);
      expect(c.paths().filter((p) => p === 'POST /pipe/send')).toHaveLength(1);
      expect(c.paths().at(-1)).toBe('POST /pipe/send');
    });
  }

  it('a 402 on any route stops too (the status read, the proof read)', async () => {
    const c = fakeCoord({ fail: { path: /^\/sign\/status$/, status: 402 } });
    await expect(streamOf(c).sign(stepOf('no-show', 'expire'))).rejects.toBeInstanceOf(StreamRefused);
    const c2 = fakeCoord({ fail: { path: /^\/proof\/tx\//, status: 401 } });
    await expect(streamOf(c2).chain.event(('0x' + '12'.repeat(32)) as Hex)).rejects.toMatchObject({ name: 'StreamRefused', status: 401 });
  });
});

// ── 4. lights: an ack plus a proven transaction ─────────────────────────────────────────────────────────────────────────

describe('_PLAYGROUND_STREAM_v1_ a light turns on only from an ack plus a proven transaction', () => {
  /** an armed run of delivered-accepted: the evaluator's verdict released and sent by the caller's sender */
  async function armed(f: FakeCoord) {
    const c = fakeCoord({ mode: 'armed', ...f });
    const sent: Hex[] = [];
    const cs = streamOf(c, { send: async ({ step }) => { const tx = (await c.fp.stream.sign(step)).tx!; sent.push(tx); return tx; } });
    const out = await dev.run('delivered-accepted', args(), portsOf(c, cs));
    return { c, out, sent, on: out.lights.filter((l) => l.on).map((l) => l.light) };
  }
  it('an armed step: released, sent by the caller\'s sender, acked as signed with its transaction', async () => {
    const r = await armed({ settled: () => null });
    expect(r.sent).toHaveLength(1);
    expect(r.out.steps.find((s) => s.fn === 'postVerdict')).toMatchObject({ tx: r.sent[0], ok: true, ack: { stage: 'signed', tx: r.sent[0] } });
  });

  it('no recorded settlement: no ack, so no light, though every transaction is proven', async () => {
    const r = await armed({ settled: () => null });
    expect(r.out.status).toBe('ran');
    expect(r.on).toEqual([]);
    expect(r.out.lights.filter((l) => l.light !== 'paid').map((l) => l.why)).toEqual(['listed', 'bought', 'delivered', 'settled'].map((l) => `no ${l} ack on the stream`));
    expect(r.out.lights.find((l) => l.light === 'paid')!.why).toBe('not settled');
  });

  it('acked but the payout not proven: paid stays off, the rest on', async () => {
    let txs: string[] = [];
    const c = fakeCoord({ mode: 'armed', proven: (tx) => tx !== PAYOUT_TX, settled: () => txs });
    const cs = streamOf(c, { send: async ({ step }) => (await c.fp.stream.sign(step)).tx! });
    const run = dev.run('delivered-accepted', args(), { ...portsOf(c, cs), stream: { sign: cs.sign, settle: async (p, steps) => { txs = [...steps.map((s) => s.tx!), PAYOUT_TX]; return cs.settle(p, steps); } } });
    const out = await run;
    expect(out.lights.filter((l) => l.on).map((l) => l.light)).toEqual(['listed', 'bought', 'delivered', 'settled']);
    expect(out.lights.find((l) => l.light === 'paid')).toMatchObject({ on: false, ack: { stage: 'paid', tx: PAYOUT_TX }, event: null });
  });

  it('acked and proven: all five lights on, the paid one from the payout\'s own Transfer to the seller', async () => {
    let txs: string[] = [];
    const c = fakeCoord({ mode: 'armed', settled: () => txs });
    const cs = streamOf(c, { send: async ({ step }) => (await c.fp.stream.sign(step)).tx! });
    const out = await dev.run('delivered-accepted', args(), { ...portsOf(c, cs), stream: { sign: cs.sign, settle: async (p, steps) => { txs = [...steps.map((s) => s.tx!), PAYOUT_TX]; return cs.settle(p, steps); } } });
    expect(out.lights.filter((l) => l.on).map((l) => l.light)).toEqual(['listed', 'bought', 'delivered', 'settled', 'paid']);
  });

  it('a step whose transaction is not proven shows no event: the run stops there', async () => {
    const c = fakeCoord({ mode: 'armed', proven: () => false, settled: () => [] });
    const cs = streamOf(c);
    const out = await dev.run('delivered-accepted', args(), portsOf(c, cs));
    expect(out).toMatchObject({ status: 'stopped', stopped: { step: 0, fn: 'approve' } });
    expect(out.lights.some((l) => l.on)).toBe(false);
  });
});

// ── 5. shadow runs ──────────────────────────────────────────────────────────────────────────────────────────────────────

describe('_PLAYGROUND_STREAM_v1_ a shadow run', () => {
  /** the settlement record holds what went on chain: the user's own steps up to the first one that only would sign */
  const shadowRun = async (id: CaseId, via?: Via, o: Partial<CoordStreamOptions> = {}) => {
    let txs: string[] = [];
    const c = fakeCoord({ mode: 'shadow', settled: () => txs });
    const cs = streamOf(c, o);
    const out = await dev.run(id, args(via), { ...portsOf(c, cs), stream: { sign: cs.sign, settle: async (p, steps) => { txs = steps.filter((s) => s.tx).map((s) => s.tx!); return cs.settle(p, steps); } } });
    return { c, out, on: out.lights.filter((l) => l.on).map((l) => l.light) };
  };
  const moonbeamSteps = (id: CaseId, via?: Via) => dev.plan(id, args(via)).steps.filter((s) => s.signer.startsWith('coord:')).map((s) => s.fn);

  it('no-show: the keeper\'s expiry would sign; Listed and Bought on, nothing past Bought', async () => {
    const { out, on } = await shadowRun('no-show');
    expect(out.status).toBe('would_sign');
    expect(out.wouldSign!.map((w) => [w.fn, w.signer, w.status])).toEqual([['expire', 'coord:devnet.keeper', 'shadow']]);
    expect(out.wouldSign!.map((w) => w.fn)).toEqual(moonbeamSteps('no-show'));
    expect(on).toEqual(['listed', 'bought']);
    expect(out.lights.find((l) => l.light === 'settled')).toMatchObject({ on: false, why: expect.stringMatching(/would sign only: no transaction/) });
    expect(out.steps.find((s) => s.fn === 'expire')).toMatchObject({ tx: null, ok: false, sign: { status: 'shadow' } });
  });

  it('rejected (arbitrated): the evaluator and the arbitrator each would sign; the seller\'s dispute is not sent; nothing past Bought settles', async () => {
    const { out, on, c } = await shadowRun('rejected', 'arbitrated');
    expect(out.status).toBe('would_sign');
    expect(out.wouldSign!.map((w) => `${w.fn} ${w.signer}`)).toEqual(['postVerdict coord:devnet.evaluate', 'resolveDispute coord:devnet.arbitrate']);
    expect(out.wouldSign!.map((w) => w.fn)).toEqual(moonbeamSteps('rejected', 'arbitrated'));
    expect(out.steps.find((s) => s.fn === 'dispute')).toMatchObject({ tx: null, sign: { status: 'skipped' } });
    expect(c.paths().filter((p) => p === 'POST /pipe/send')).toHaveLength(2);
    expect(on.filter((l) => l === 'settled' || l === 'paid')).toEqual([]);
  });

  it('with no seal every Moonbeam step is not routable: no request goes out, and no light past Bought', async () => {
    const { out, on, c } = await shadowRun('rejected', 'arbitrated', { seal: undefined as never });
    expect(out.wouldSign!.map((w) => w.status)).toEqual(['not_routable', 'not_routable']);
    expect(c.paths().filter((p) => p.startsWith('POST /pipe'))).toEqual([]);
    expect(on.filter((l) => l === 'settled' || l === 'paid')).toEqual([]);
  });
});

// ── 6. the live script ──────────────────────────────────────────────────────────────────────────────────────────────────

describe('_PLAYGROUND_STREAM_v1_ the live script refuses', () => {
  const load = async () => (await import(pathToFileURL(join(__dirname, '..', 'scripts', 'e2e-devnet-playground.mjs')).href)) as
    { guard: (env: Record<string, string | undefined>) => { ok: true; chainId: number } | { ok: false; why: string }; DEVNET_CHAIN: number };
  it('without LIVE=1', async () => {
    const { guard } = await load();
    expect(guard({})).toMatchObject({ ok: false, why: expect.stringMatching(/LIVE=1/) });
    expect(guard({ LIVE: 'true' })).toMatchObject({ ok: false });
    expect(guard({ LIVE: '0', MOONBEAM_DEVNET_CHAIN_ID: '36927' })).toMatchObject({ ok: false });
  });
  it('on any chain but the devnet 36927', async () => {
    const { guard, DEVNET_CHAIN } = await load();
    expect(DEVNET_CHAIN).toBe(36927);
    for (const c of ['8453', '1', '5042', 'abc', '36927.5']) expect(guard({ LIVE: '1', MOONBEAM_DEVNET_CHAIN_ID: c }), c).toMatchObject({ ok: false, why: expect.stringMatching(/not the devnet/) });
    expect(guard({ LIVE: '1' })).toEqual({ ok: true, chainId: 36927 });
    expect(guard({ LIVE: '1', MOONBEAM_DEVNET_CHAIN_ID: '36927' })).toEqual({ ok: true, chainId: 36927 });
  });
});

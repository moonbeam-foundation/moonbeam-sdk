/**
 * The coord stream port (`coordStream`): a playground run's Moonbeam-signed steps go to the coord signer as sign requests on the
 * coord pipe, and its lights read the chain through coord's proof read. Built on coord's documented routes only; the port makes a
 * request only through the transport it is given, and never reads a key or an environment secret.
 *
 *   sign(step)      a `coord:<purpose>` step → one sign request (a pipe envelope of kind `sign` to the signer, POST /v1/pipe/send),
 *                   its result read from the requester's inbox (GET /v1/pipe/inbox/:who) and acked (POST /v1/pipe/ack)
 *   settle(plan)    the stage acks of a run: the recorded settlement of the job (GET /v1/settle/:id), each tx matched to a step
 *   planSale(body)  the unsigned plan of a sale (POST /v1/settle)
 *   chain.event(tx) the events of a transaction, only once coord proves it (GET /v1/proof/tx/:chain/:tx → proven, then
 *                   GET /v1/chain/:chain/tx/:hash → tx.events[])
 *
 * What the signer answers maps to the port's results: shadow is "would sign" (no transaction, so no light); a refusal carries the
 * signer's code and words; a 401, 402 or 429 from any route throws `StreamRefused`, which stops the run. Nothing is retried.
 *
 * A sign request is signed by the requester's own Ed25519 request key over "<request schema>\n<payload>" (coord
 * lang/cue/sign.cue `sign.request.sig`). This port holds no key: the caller may pass `seal`, a function that returns that signature.
 * Without one, every sign request answers `not_routable` and nothing is sent.
 */
import { keccakHex } from '../onboard/index.js';
import type { Hex, OnboardTransport } from '../onboard/index.js';
import type { Plan, PlanStep } from './index.js';
import type { Ack, ChainEvent, ChainPort, RunStepResult, SignAnswer, StreamPort } from './ports.js';
import type { LightId } from './cases.js';
import { keyedFetch } from '../core/keyed.js';

/** The devnet and Base chain ids a playground runs on. */
export const STREAM_CHAINS = Object.freeze({ devnet: 36927, base: 8453 } as const);

// the wire's own names (coord lang/cue/sign.cue `sign.request`, lang/cue/api-bodies.cue PipeEnvelope)
export const PIPE_ENVELOPE_SCHEMA = 'taifoon.pipe.envelope.v1';
export const SIGN_REQUEST_SCHEMA = 'taifoon.sign.request.v1';
export const SIGN_RESULT_SCHEMA = 'taifoon.sign.result.v1';
/** the signer's own inbox: a request goes `to: { agent: SIGNER_INBOX }` (sign.cue deploy.inbox) */
export const SIGNER_INBOX = 'coord-sign';

/** A refusal that stops the run: a 401 (a key is needed), 402 (payment is needed) or 429 (rate limited). Never retried. */
export class StreamRefused extends Error {
  override name = 'StreamRefused';
  constructor(readonly status: 401 | 402 | 429, readonly route: string, readonly body: unknown) {
    super(`refused (${status}) by ${route}: the run stops here, nothing is retried`);
  }
}

/** The purpose a `coord:<purpose>` signer names, or null for any other signer. */
export const purposeOf = (signer: string): string | null => (signer.startsWith('coord:') ? signer.slice('coord:'.length) : null);

/**
 * Why a purpose may not sign on a chain, or null when it may. A `devnet.*` purpose signs on the devnet (36927) only; every other
 * purpose never signs there. A test ref (`coord:test.*`) is never a purpose of the signer; a chain other than the two is refused.
 */
export function purposeNetRefusal(purpose: string, chainId: number): string | null {
  if (!/^[a-z]+(\.[a-z_*]+)+$/.test(purpose)) return `${purpose} is not a purpose name`;
  if (purpose.startsWith('test.')) return `${purpose} is a test ref, not a purpose of the signer`;
  const devnetPurpose = purpose.startsWith('devnet.');
  if (chainId === STREAM_CHAINS.devnet) return devnetPurpose ? null : `${purpose} is not a devnet purpose: chain ${chainId} signs only devnet.* purposes`;
  if (chainId === STREAM_CHAINS.base) return devnetPurpose ? `${purpose} is a devnet purpose: it never signs on chain ${chainId}` : null;
  return `chain ${chainId} is neither the devnet (${STREAM_CHAINS.devnet}) nor Base (${STREAM_CHAINS.base})`;
}

/** A purpose as the signer's status read names it (GET /v1/sign/status → purposes[]). */
export interface SignerPurpose { id: string; mode: string; key: string; vault: string }

/** The request a requester signs: coord lang/cue/sign.cue `sign.request.fields`. */
export interface SignRequestBody {
  schema: typeof SIGN_REQUEST_SCHEMA;
  purpose: string;
  requester: string;
  vault: string;
  key: string;
  /** the purpose's arguments: the call the plan built (the signer rebuilds what it signs from its register and these) */
  request: { chain: number; to: string; fn: string; data: string; value: string };
  evidence: null;
  nonce: string;
  at: string;
  ttl_s: number;
}

/** The text a request key signs: the request schema, a newline, the exact payload. */
export const signedText = (payload: string): string => `${SIGN_REQUEST_SCHEMA}\n${payload}`;

/** One sign request as a pipe envelope (coord lang/cue/api-bodies.cue PipeEnvelope; sign.cue `sign.request`). Pure. */
export function signEnvelope(body: SignRequestBody, sig: string, createdAt: string): Record<string, unknown> {
  const payload = JSON.stringify(body);
  return {
    schema: PIPE_ENVELOPE_SCHEMA, kind: 'sign',
    from: { agent: body.requester }, to: { agent: SIGNER_INBOX },
    order_key: `sign:${body.purpose}:${body.nonce}`,
    payload, payload_digest: keccakHex(new TextEncoder().encode(payload)),
    ttl_s: body.ttl_s, max_attempts: 5, created_at: createdAt, reply_to: null,
    sig: { scheme: 'ed25519', by: body.requester, sig },
  };
}

/** The terms of one sale's unsigned plan (POST /v1/settle: kind, chainId, buyer, seller, price, evidence, ref, deadline). */
export interface SaleTerms {
  chainId: number;
  buyer: string;
  seller: string;
  price: bigint;
  evidence: Hex;
  refId: string;
  deadline?: number;
  /** settle through Moonbeam's own judge adapter (the planner's `via: "us"`) */
  viaUs?: boolean;
}
/** The body of POST /v1/settle. Pure. */
export function settleBody(t: SaleTerms): Record<string, unknown> {
  return {
    kind: 'agent', chainId: t.chainId, buyer: t.buyer, seller: t.seller, price: t.price.toString(), evidence: t.evidence, ref: { id: t.refId },
    ...(t.deadline !== undefined ? { deadline: t.deadline } : {}), ...(t.viaUs ? { via: 'us' } : {}),
  };
}

export interface CoordStreamOptions {
  /** the requester id the signer's register names; never a key */
  requester: string;
  /** the chain the chain reads go to (default: the devnet) */
  chainId?: number;
  /** the requester's Ed25519 signature (base64) over `signedText(payload)`, made wherever the request key lives. Without it, no sign
   *  request can be sent and every one answers not_routable */
  seal?: (text: string) => Promise<string>;
  /** sends a released signature to the chain and returns its tx hash. Without it, a released signature has no transaction */
  send?: (a: { signature: string; step: PlanStep }) => Promise<Hex>;
  /** inbox long-polls per request (each up to 25 s on the server, never a sleep here); default 3 */
  polls?: number;
  /** clock and nonce (tests) */
  now?: () => number;
  nonce?: () => string;
}

export interface CoordStream extends StreamPort {
  readonly requester: string;
  /** the chain port's read: events only for a transaction coord proves; `waitUntil` needs a chain clock this port does not read */
  readonly chain: ChainPort;
  /** the unsigned plan of a sale (POST /v1/settle) */
  planSale(t: SaleTerms): Promise<{ ok: boolean; status: number; body: unknown }>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const STOPS = new Set([401, 402, 429]);

/** Event args as coord serves them, with decimal strings read as integers (a transfer's value). */
const argsOf = (a: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (!isObj(a)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) out[k] = typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : v;
  return out;
};

/** The coord stream port over a transport (see the module's header). */
export function coordStream(t: OnboardTransport, o: CoordStreamOptions): CoordStream {
  if (!o || typeof o.requester !== 'string' || !/^[a-z][a-z0-9-]*(:[a-z0-9-]+)?$/.test(o.requester))
    throw new TypeError('coordStream needs { requester }: an id the signer\'s register names (lowercase, e.g. moonbeam-playground)');
  const requester = o.requester;
  const chainId = o.chainId ?? STREAM_CHAINS.devnet;
  const polls = o.polls ?? 3;
  const now = o.now ?? (() => Date.now());
  let n = 0;
  const nonce = o.nonce ?? (() => `${now().toString(36)}-${(++n).toString(36)}`);

  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ ok: boolean; status: number; body: unknown }> {
    const headers: Record<string, string> = { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) };
    const r = await keyedFetch(t, `${t.base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const j = await r.json().catch(() => null);
    if (STOPS.has(r.status)) throw new StreamRefused(r.status as 401 | 402 | 429, `${method} ${path.split('?')[0]}`, j);
    return { ok: r.ok, status: r.status, body: j };
  }

  let register: Promise<Map<string, SignerPurpose>> | null = null;
  const purposes = (): Promise<Map<string, SignerPurpose>> => (register ??= call('GET', '/sign/status').then((r) => {
    const m = new Map<string, SignerPurpose>();
    const rows = isObj(r.body) && Array.isArray(r.body['purposes']) ? r.body['purposes'] : [];
    for (const p of rows) if (isObj(p) && typeof p['id'] === 'string') m.set(p['id'], { id: p['id'], mode: String(p['mode'] ?? ''), key: String(p['key'] ?? ''), vault: String(p['vault'] ?? '') });
    return m;
  }).catch((e) => { register = null; throw e; }));

  /** read the requester's inbox for the result of request `id`; ack it once read */
  async function resultOf(id: string): Promise<{ result: Obj; envelopeId: string } | null> {
    for (let i = 0; i < polls; i++) {
      const r = await call('GET', `/pipe/inbox/${encodeURIComponent(requester)}?wait=25&limit=50`);
      const rows = isObj(r.body) && Array.isArray(r.body['envelopes']) ? r.body['envelopes'] : [];
      for (const row of rows) {
        if (!isObj(row)) continue;
        const env = isObj(row['envelope']) ? row['envelope'] : row;
        const envelopeId = String(row['id'] ?? env['id'] ?? '');
        if (env['kind'] !== 'sign' || env['reply_to'] !== id || typeof env['payload'] !== 'string') continue;
        let res: unknown; try { res = JSON.parse(env['payload']); } catch { continue; }
        if (!isObj(res) || res['schema'] !== SIGN_RESULT_SCHEMA || res['request'] !== id) continue;
        if (res['state'] === 'held') continue; // held: read again until its hold ends or the polls run out
        await call('POST', '/pipe/ack', { id: envelopeId, by: requester });
        return { result: res, envelopeId };
      }
    }
    return null;
  }

  async function sign(step: PlanStep): Promise<SignAnswer> {
    const purpose = purposeOf(step.signer);
    const refused = (reason: string): SignAnswer => ({ tx: null, ack: null, status: 'refused', reason });
    if (purpose === null) return refused(`${step.signer} is not a coord signer: the stream signs coord:<purpose> steps only`);
    const bad = purposeNetRefusal(purpose, step.call.chainId);
    if (bad) return refused(`purpose_network: ${bad}`);
    if (!o.seal) return { tx: null, ack: null, status: 'not_routable', reason: `a sign request is signed by the requester's Ed25519 request key; this port was given no seal for ${requester}, so nothing was sent` };

    const reg = await purposes();
    const p = reg.get(purpose);
    if (!p) return { tx: null, ack: null, status: 'not_routable', reason: `${purpose} is not in the signer's register (GET /v1/sign/status)` };
    if (p.mode === 'killed') return refused(`killed: ${purpose} is killed; nothing is signed`);
    if (p.mode !== 'shadow' && p.mode !== 'armed') return refused(`not_armed: ${purpose} is ${p.mode || 'not armed'}`);

    const at = new Date(now()).toISOString();
    const body: SignRequestBody = {
      schema: SIGN_REQUEST_SCHEMA, purpose, requester, vault: p.vault, key: p.key,
      request: { chain: step.call.chainId, to: step.call.to, fn: step.fn, data: step.call.data, value: step.call.value },
      evidence: null, nonce: nonce(), at, ttl_s: 600,
    };
    const envelope = signEnvelope(body, await o.seal(signedText(JSON.stringify(body))), at);
    const sent = await call('POST', '/pipe/send', envelope);
    const id = isObj(sent.body) && typeof sent.body['id'] === 'string' ? sent.body['id'] : null;
    if (!sent.ok || !id) return refused(`the pipe refused the request (${sent.status}): ${JSON.stringify(sent.body)}`);

    const got = await resultOf(id);
    if (!got) return { tx: null, ack: null, status: 'no_answer', reason: `no result for ${id} in ${requester}'s inbox after ${polls} reads` };
    const r = got.result;
    const state = String(r['state']);
    const refusal = isObj(r['refusal']) ? r['refusal'] : null;
    const words = refusal ? `${String(refusal['code'] ?? state)}: ${String(refusal['why'] ?? '')}`.trim() : state;
    switch (state) {
      case 'shadowed':
        return { tx: null, ack: null, status: 'shadow', reason: `${purpose} is in shadow: the signer would sign and signed nothing`, would: r['would_sign'] ?? null };
      case 'released': {
        const signature = typeof r['signature'] === 'string' ? r['signature'] : null;
        if (!signature) return refused(`released with no signature (${id})`);
        if (!o.send) return { tx: null, ack: { id: got.envelopeId, stage: 'signed' }, status: 'signed', reason: 'released: this port was given no sender, so no transaction went out' };
        const tx = await o.send({ signature, step });
        return { tx, ack: { id: got.envelopeId, stage: 'signed', tx }, status: 'signed' };
      }
      default: // refused · throttled · expired: the signer's own code and words
        return refused(words);
    }
  }

  async function settle(plan: Plan, steps: readonly RunStepResult[]): Promise<{ acks: readonly Ack[] } | null> {
    for (const s of plan.steps) { const pp = purposeOf(s.signer); if (pp && purposeNetRefusal(pp, plan.chainId)) return { acks: [] }; }
    if (!plan.jobId) return { acks: [] };
    const r = await call('GET', `/settle/${plan.jobId}`);
    if (!r.ok || !isObj(r.body)) return { acks: [] };
    const row = isObj(r.body['settlement']) ? r.body['settlement'] : r.body;
    const txs = Array.isArray(row['txs']) ? row['txs'] : [];
    const hashes = new Set(txs.map((x) => (isObj(x) && typeof x['hash'] === 'string' ? x['hash'].toLowerCase() : '')).filter((h) => HEX32.test(h)));
    const acks: Ack[] = [];
    const ack = (stage: LightId, tx: Hex) => acks.push({ id: `settle:${plan.jobId}:${stage}`, stage, tx });
    const mine = new Set<string>();
    for (const s of steps) {
      if (!s.ok || !s.tx) continue;
      mine.add(s.tx.toLowerCase());
      if (!hashes.has(s.tx.toLowerCase())) continue;
      if (s.fn === 'openJobWithEconomy') { ack('listed', s.tx); ack('bought', s.tx); }
      if (s.fn === 'submit') ack('delivered', s.tx);
      if (s.ends) ack('settled', s.tx);
    }
    // the payout: a recorded transaction of the sale that is none of the run's own steps
    const payout = [...hashes].find((h) => !mine.has(h));
    if (payout && acks.some((a) => a.stage === 'settled')) ack('paid', payout as Hex);
    return { acks };
  }

  const chain: ChainPort = {
    async event(tx: Hex): Promise<readonly ChainEvent[]> {
      if (!HEX32.test(tx)) return [];
      const proof = await call('GET', `/proof/tx/${chainId}/${tx}`);
      if (!proof.ok || !isObj(proof.body) || proof.body['proven'] !== true) return [];
      const read = await call('GET', `/chain/${chainId}/tx/${tx}`);
      const txRow = isObj(read.body) && isObj(read.body['tx']) ? read.body['tx'] : null;
      if (!read.ok || !txRow || !Array.isArray(txRow['events'])) return [];
      const out: ChainEvent[] = [];
      for (const e of txRow['events']) {
        if (!isObj(e) || typeof e['event'] !== 'string') continue; // a log the known table does not decode names no event
        const args = argsOf(e['args']);
        out.push({ name: e['event'], ...(args ? { args } : {}) });
      }
      return out;
    },
    async waitUntil(): Promise<void> {
      throw new Error('the coord stream port reads no chain clock: pass a chain port with waitUntil for a case that waits on a window');
    },
  };

  return Object.freeze({
    requester, chain, sign, settle,
    planSale: (s: SaleTerms) => call('POST', '/settle', settleBody(s)),
  });
}

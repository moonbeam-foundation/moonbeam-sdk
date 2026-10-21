/**
 * The judge for Moonbeam's assurance hook on Base: Jev (TypeSafe System One, calibrated closed answers) graded against
 * the published RUBRIC_v1, composed in code under THRESHOLDS_v1, recorded on the answer and decision logs, and turned
 * into the one call that ends a GLMR job on the hook — complete(jobId) or reject(jobId, digest).
 *
 * The same five calls as the Jev SDK, bound to Moonbeam: the subject is (Base, the hook, the job id), the recorder is
 * "moonbeam", the evaluator call goes to the hook. Nothing here signs: the job's buyer or a hook evaluator does.
 */
import { evaluatorCall, facts, grade, record, verify } from '@taifoon/jev';
import type { EvaluatorCall, FactsInput, GradeInput, Network, Receipt, Recorded, UnsignedCall, Verification } from '@taifoon/jev';
import { keccak256Hex } from '../adapters/stamp.js';
import { attest } from '../attest/index.js';
import type { AttestCall, AttestMissing, StampVerdict } from '../attest/index.js';
import { CoordError, jsonOf, refusalOf } from '../errors/index.js';

/** Moonbeam ACP on Base: the hook, the GLMR token, its tenant. */
export const MOONBEAM_JUDGE = Object.freeze({
  tenant: 'moonbeam',
  chainId: 8453,
  hook: '0xc0578657Eda85e0a246771aa1839ce79b54eE80d',
  token: Object.freeze({ symbol: 'GLMR', address: '0xB3846fD356c2149ee8D30b0449088Dc74e265459', decimals: 18 }),
});

const JOB_ID = /^0x[0-9a-fA-F]{64}$/;
const jobIdOf = (jobId: string): string => {
  if (!JOB_ID.test(jobId)) throw new Error(`a Moonbeam job id is the hook's 32-byte id, got ${jobId.slice(0, 20)}`);
  return jobId.toLowerCase();
};

export type GradeJobInput = Omit<GradeInput, 'subject' | 'caller'> & {
  jobId: string;
  /** where Jev is asked with your `key`: TypeSafe itself (the default), or a coordination endpoint's System One door */
  systemOne?: SystemOneRoute;
};

/** Grade one job on the hook: facts first (a failed check rejects without asking Jev), then RUBRIC_v1, then the receipt.
 *  With `key`, Jev is asked over System One: at api.typesafe.ai by default, or through `systemOne: { via: 'coord', … }`. */
export async function gradeJob(input: GradeJobInput): Promise<Receipt> {
  const { jobId, systemOne, ...rest } = input;
  const routed = systemOne && input.key ? { endpoint: systemOne.via === 'coord' ? systemOne.base : systemOne.endpoint ?? SYSTEM_ONE_URL, fetch: systemOneFetch(systemOne, input.fetch) } : {};
  return grade({ ...rest, ...routed, subject: { chainId: MOONBEAM_JUDGE.chainId, at: MOONBEAM_JUDGE.hook, ref: jobIdOf(jobId) }, caller: MOONBEAM_JUDGE.tenant });
}

// ── System One: one request, one answer, two doors ─────────────────────────────────────────────────────────────────────
// The System One request { model, state, questions } and its answer { model, answers, usage } are the same at TypeSafe
// (POST https://api.typesafe.ai/v1/systemone, your TypeSafe key as Bearer) and at a coordination endpoint's door
// (POST <base>/systemone: your coordination key as X-API-Key, the provider's key in x-systemone-key for that one call).

/** TypeSafe's own System One host (the default door). */
export const SYSTEM_ONE_URL = 'https://api.typesafe.ai';
/** Other spellings of the Jev models, and the name each stands for. */
export const JEV_MODEL_ALIASES: Readonly<Record<string, string>> = Object.freeze({ 'jev-1-13-0': 'jev-1.13.0', 'jev-1-14-0': 'jev-1.14.0', 'typesafe-jev': 'jev-latest' });
/** A Jev model name, with an alias read as the model it stands for (`jev-1-14-0` → `jev-1.14.0`). */
export const jevModel = (m: string): string => JEV_MODEL_ALIASES[m] ?? m;

export type SystemOneRoute =
  /** TypeSafe itself: your TypeSafe key as Bearer. `endpoint` overrides the host (https only). */
  | { via?: 'typesafe'; endpoint?: string; model?: string }
  /** a coordination endpoint's door: `base` as the other transports take it (…/v1), `apiKey` your coordination key
   *  (sent as X-API-Key); your provider key (`key`) travels in x-systemone-key for that call only. */
  | { via: 'coord'; base: string; apiKey: string; provider?: string; model?: string };
export type SystemOneQuestion = { type: 'noul' | 'choice' | 'score'; instructions: string; criteria?: unknown };
export type SystemOneAnswer = { model: string | null; answers: Record<string, Record<string, unknown>>; usage?: { input_tokens?: number; output_tokens?: number } };

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const httpsOnly = (u: string) => { if (!/^https:\/\//.test(u)) throw new RangeError('a key is only sent over https'); return u.replace(/\/$/, ''); };
/** The URL and headers of one System One call on a route. Pure. */
export function systemOneRequest(route: SystemOneRoute | undefined, key: string, body: { model: string; state: unknown; questions: Record<string, SystemOneQuestion> }): { url: string; headers: Record<string, string>; body: string } {
  if (!key) throw new RangeError('System One takes your provider key (TypeSafe: console.typesafe.ai)');
  const model = jevModel(route?.model ?? body.model);
  const json = JSON.stringify({ ...body, model });
  if (route?.via === 'coord') {
    if (!route.apiKey) throw new RangeError('the coordination door takes your coordination key (apiKey, sent as X-API-Key)');
    return { url: `${httpsOnly(route.base)}/systemone`, headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': route.apiKey, 'x-systemone-key': key, ...(route.provider ? { 'x-systemone-provider': route.provider } : {}) }, body: json };
  }
  return { url: `${httpsOnly(route?.endpoint ?? SYSTEM_ONE_URL)}/v1/systemone`, headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${key}` }, body: json };
}

/** Ask System One once: the same request and answer on either door. A refusal (either shape) throws a CoordError. */
export async function askSystemOne(a: { state: unknown; questions: Record<string, SystemOneQuestion>; key: string; model?: string; route?: SystemOneRoute; fetch?: FetchLike }): Promise<SystemOneAnswer> {
  const req = systemOneRequest(a.route, a.key, { model: a.model ?? 'jev-1.13.0', state: a.state, questions: a.questions });
  const f = a.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const r = await f(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: AbortSignal.timeout(65_000) });
  const j = await jsonOf(r);
  if (!r.ok) throw new CoordError(refusalOf(j, r.status, `System One answered ${r.status}`));
  const o = (j ?? {}) as Partial<SystemOneAnswer>;
  if (!o.answers || typeof o.answers !== 'object') throw new CoordError(refusalOf(j, r.status, 'System One answered with no answers'));
  return { model: o.model ?? null, answers: o.answers, ...(o.usage ? { usage: o.usage } : {}) };
}
/** askJev: askSystemOne with the Jev model (the default, jev-1.13.0, or any alias). */
export const askJev = askSystemOne;

/**
 * A fetch for the Jev SDK's grader that sends its System One call through `route`: the body is kept (the model read
 * through its alias), the headers are the route's, and a refusal throws a CoordError with the door's own words.
 */
export function systemOneFetch(route: SystemOneRoute, inner?: typeof fetch): typeof fetch {
  const f = (inner ?? globalThis.fetch) as unknown as FetchLike;
  return (async (_url: unknown, init?: { body?: unknown; headers?: unknown; signal?: AbortSignal }) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    const key = String(h['authorization'] ?? h['Authorization'] ?? '').replace(/^Bearer\s+/i, '');
    const body = JSON.parse(String(init?.body ?? '{}')) as { model: string; state: unknown; questions: Record<string, SystemOneQuestion> };
    const req = systemOneRequest(route, key, body);
    const r = await f(req.url, { method: 'POST', headers: req.headers, body: req.body, ...(init?.signal ? { signal: init.signal } : {}) });
    const j = await jsonOf(r);
    if (!r.ok) throw new CoordError(refusalOf(j, r.status, `System One answered ${r.status}`));
    return { ok: true, status: r.status, json: async () => j } as unknown as Response;
  }) as typeof fetch;
}

/** The deterministic checks for a job: delivered, and whatever the job's class can prove (values or functions). */
export const jobFacts = (input: FactsInput) => facts(input);

/** the composed verdict → the stamp's REF code. Jev is asked only when the facts found a delivery, so a reject is a
 *  delivery with defects (2); needs_review cannot be determined yet (4). */
export const STAMP_VERDICT_OF: Readonly<Record<Receipt['verdict'], StampVerdict>> = Object.freeze({ complete: 1, reject: 2, needs_review: 4 });
const NETWORKS: Record<Exclude<Network, 'none'>, number[]> = { devnet: [36927], base: [8453], both: [36927, 8453] };
export type GradeRecord = {
  networks: number[]; status: 'ready' | 'partial' | 'missing' | 'sent' | 'none';
  calls: AttestCall[]; missing: AttestMissing[];
  digests: { answers: string; decision: string; input: string; subject: string; stampSubject: string; receipt: string };
  sent?: string[];
};

/**
 * The record of a graded job: JevAnswerLog.record, JevDecisionLog.record and GradeStampRegistry.stamp, as unsigned calls.
 * Recording is on by default, on Base; `network` (none | devnet | base | both) or `networks` (chain ids) choose others,
 * `none` turns it off. A contract a network lacks is listed in `missing` (Base has no stamp registry today). The call
 * data is the Jev SDK's own (same subject, digests, model and uris), so a record verifies with verifyGrade.
 */
export async function recordGrade(receipt: Receipt, opts: { network?: Network; networks?: readonly number[]; uri?: string; stamp?: boolean; send?: (call: UnsignedCall) => Promise<string> } = {}): Promise<GradeRecord> {
  if (!receipt.decision || !receipt.answersRecord || !receipt.answersDigest) throw new Error(`nothing to record: Jev was not asked (${receipt.reasons[0] ?? receipt.verdict}) — the facts decided`);
  const chains = opts.network === 'none' ? 'none' as const : opts.network ? NETWORKS[opts.network] : opts.networks ?? [8453];
  const model = (receipt.answersRecord.upstream_model ?? receipt.answersRecord.model ?? 'jev').slice(0, 64);
  const uri = (kind: string, d: string) => (opts.uri ? `${opts.uri.replace(/\/$/, '')}/${d}` : `urn:jev:${kind}:${d}`).slice(0, 512);
  const s = receipt.chainSubject;
  const ref = /^0x[0-9a-fA-F]{64}$/.test(s.ref) ? s.ref.toLowerCase() : keccak256Hex(`0x${Buffer.from(s.ref, 'utf8').toString('hex')}`);
  const a = attest({
    kind: receipt.decision.kind, subject: { chainId: s.chainId, contract: s.at ?? `0x${'0'.repeat(40)}`, jobId: ref },
    digest: receipt.decision.digest as `0x${string}`, confidenceBps: receipt.decision.confidenceBps, model, uri: uri('decision', receipt.decision.digest),
    answers: { useCase: receipt.answersRecord.use_case, inputDigest: receipt.inputDigest as `0x${string}`, answersDigest: receipt.answersDigest as `0x${string}`, uri: uri('answers', receipt.answersDigest) },
    verdict: opts.stamp === false ? null : STAMP_VERDICT_OF[receipt.verdict], mode: 2,
  }, { networks: chains });
  if (a.mark.subject !== receipt.subjectId) throw new Error('recordGrade: the attestation subject differs from the receipt\'s subject id');
  const out: GradeRecord = {
    networks: a.networks, status: a.status, calls: a.calls, missing: a.missing,
    digests: { answers: receipt.answersDigest, decision: receipt.decision.digest, input: receipt.inputDigest, subject: receipt.subjectId, stampSubject: a.mark.stampSubject, receipt: receipt.receiptHash },
  };
  if (opts.send && a.calls.length) { out.sent = []; for (const c of a.calls) out.sent.push(await opts.send(c as UnsignedCall)); out.status = 'sent'; }
  return out;
}
/** the Jev SDK's own record() (network flag none | devnet | base | both), unchanged */
export const recordGradeJev = (receipt: Receipt, opts: { network?: Network; uri?: string; send?: (call: UnsignedCall) => Promise<string> } = {}): Promise<Recorded> => record(receipt, opts);

/**
 * The call that ends the job on the hook: complete(jobId) for complete, reject(jobId, digest) for reject — the digest is
 * the decision digest (or the receipt hash when facts alone decided). null for needs_review: the job stays held until
 * the buyer or an evaluator decides, or anyone expires it after the deadline.
 */
export function endJob(jobId: string, receipt: Pick<Receipt, 'verdict' | 'decision' | 'receiptHash'>): EvaluatorCall | null {
  return evaluatorCall('assurance-hook', jobIdOf(jobId), receipt.verdict, receipt.decision?.digest ?? receipt.receiptHash, { to: MOONBEAM_JUDGE.hook, chainId: MOONBEAM_JUDGE.chainId });
}

/** Recompute every digest in a receipt (or take an answers digest) and find the log rows that hold it. */
/**
 * Recompute every fingerprint of a receipt and find its record on chain. `x` is a receipt, or a recorded answers
 * digest (32 bytes) to look up. Moonbeam lives on Base, so the lookup reads Base unless you pass network 'devnet'.
 */
export const verifyGrade = (x: Receipt | string, opts: { rpc?: string; chain?: boolean; network?: 'base' | 'devnet' } = {}): Promise<Verification> =>
  verify(x, { ...opts, network: opts.network ?? 'base' });

export type { Receipt, Recorded, EvaluatorCall, Verification, FactsInput };

// ── the job's record: the task and the delivery, for a hook that stores neither ─────────────────────────────────────
// The hook keeps the parties, the amounts, the deadline and a 32-byte evidence digest, never the task. A grader that
// reads only the chain then cannot tell what was asked. The job's record carries both, each bound so a reader can
// check it: the delivery's keccak256 must equal the evidence digest the seller sealed with submit, and the task is
// signed by the job's buyer (EIP-191) over taskMessage(). These are pure; the buyer's own wallet signs the message.

/** keccak256 of the UTF-8 bytes of a text (the task, or the delivery whose digest the seller seals with submit). */
export const textDigest = (text: string): string => keccak256Hex('0x' + Buffer.from(text, 'utf8').toString('hex'));

/** The exact text the job's buyer signs (EIP-191 personal_sign) to bind a task to one hook job. */
export function taskMessage(p: { jobId: string; task: string; chainId?: number; hook?: string }): string {
  const chainId = p.chainId ?? MOONBEAM_JUDGE.chainId; const hook = (p.hook ?? MOONBEAM_JUDGE.hook).toLowerCase();
  return ['ERC-8183 assurance-hook job: the task the buyer asked for', `chain: ${chainId}`, `hook: ${hook}`, `job: ${p.jobId.toLowerCase()}`, `task keccak256: ${textDigest(p.task)}`].join('\n');
}

/** The body a partner sends to put a job's task and delivery in its record; `task_signature` is the buyer's signature over taskMessage(). */
export function jobRecordBody(p: { task?: string; taskSignature?: string; delivery?: string; chainId?: number }): { chainId: number; task?: string; task_signature?: string; delivery?: string } {
  return { chainId: p.chainId ?? MOONBEAM_JUDGE.chainId, ...(p.task !== undefined ? { task: p.task } : {}), ...(p.taskSignature ? { task_signature: p.taskSignature } : {}), ...(p.delivery !== undefined ? { delivery: p.delivery } : {}) };
}

// ── the answer logs and the evaluator adapter on Base (0.8.0) ─────────────────────────────────────────────────────────
// Jev's answers are recorded in two logs on Base: JevAnswerLog and JevAnswerLogV2 (the same JevAnswered event and
// recordedAt(digest); V2's recorder rotates under a guardian). A reader looks a digest up in both. JudgeAdapterV5 is the
// evaluator adapter that posts an anchored verdict to its hook after a vetoable delay; readJudgeAdapter reads what it is
// bound to from the chain itself.
import { JEV_ANSWER_LOG, JEV_ANSWER_LOG_V2, JUDGE_ADAPTER_V5 } from '../acp/moonbeam-acp.generated.js';
import { encodeFunction, decodeStatic } from '../abi/index.js';
import { ethCall, type BaseReader } from '../rpc/index.js';

/** The answer logs on Base, oldest first. */
export const ANSWER_LOGS = Object.freeze([
  Object.freeze({ name: 'JevAnswerLog', address: JEV_ANSWER_LOG.address }),
  Object.freeze({ name: 'JevAnswerLogV2', address: JEV_ANSWER_LOG_V2.address }),
] as const);
export { JEV_ANSWER_LOG, JEV_ANSWER_LOG_V2, JUDGE_ADAPTER_V5 };

/** The block of the first trusted record of an answers digest in each answer log on Base (0: none there). */
export async function answerRecordedAt(reader: BaseReader, answersDigest: string): Promise<{ digest: string; recorded: boolean; logs: { name: string; address: string; block: number }[] }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(answersDigest)) throw new RangeError('an answers digest is 32 bytes');
  const data = encodeFunction('recordedAt(bytes32)', [answersDigest]);
  const logs = await Promise.all(ANSWER_LOGS.map(async (l) => ({ name: l.name, address: l.address, block: Number(decodeStatic(['uint64'], await ethCall(reader, l.address, data))[0]) })));
  return { digest: answersDigest.toLowerCase(), recorded: logs.some((l) => l.block > 0), logs };
}

/** How many answers each log on Base holds (total()). */
export async function answerLogTotals(reader: BaseReader): Promise<{ name: string; address: string; total: bigint }[]> {
  const data = encodeFunction('total()', []);
  return Promise.all(ANSWER_LOGS.map(async (l) => ({ name: l.name, address: l.address, total: decodeStatic(['uint256'], await ethCall(reader, l.address, data))[0] as bigint })));
}

/** JudgeAdapterV5 on Base, read from the chain: the hook it posts verdicts to, the decision log it anchors on, its delay. */
export async function readJudgeAdapter(reader: BaseReader, address: string = JUDGE_ADAPTER_V5.address): Promise<{ address: string; hook: string; decisionLog: string; releaseDelay: number }> {
  const read = async (fn: string, t: string) => decodeStatic([t], await ethCall(reader, address, encodeFunction(fn, [])))[0];
  const [hook, decisionLog, releaseDelay] = await Promise.all([read('hook()', 'address'), read('decisionLog()', 'address'), read('releaseDelay()', 'uint64')]);
  return { address, hook: String(hook), decisionLog: String(decisionLog), releaseDelay: Number(releaseDelay) };
}

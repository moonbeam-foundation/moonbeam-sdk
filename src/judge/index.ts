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

export type GradeJobInput = Omit<GradeInput, 'subject' | 'caller'> & { jobId: string };

/** Grade one job on the hook: facts first (a failed check rejects without asking Jev), then RUBRIC_v1, then the receipt. */
export async function gradeJob(input: GradeJobInput): Promise<Receipt> {
  const { jobId, ...rest } = input;
  return grade({ ...rest, subject: { chainId: MOONBEAM_JUDGE.chainId, at: MOONBEAM_JUDGE.hook, ref: jobIdOf(jobId) }, caller: MOONBEAM_JUDGE.tenant });
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

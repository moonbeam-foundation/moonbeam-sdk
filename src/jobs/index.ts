/**
 * @moonbeam-foundation/sdk/jobs: a job's id, whichever market it is on, and where a job that has not ended is held.
 *
 *   parseJobRef(id)        a bare number is a Virtuals ACP v3 (ERC-8183) job on Base; `<label>:<chainId>:<jobId>` names the
 *                          contract the job lives in (`bitagent:8453:8566`); a 32-byte hex id is an assurance-hook job
 *   jobRefKey(ref)         the id back, as the layer spells it
 *   holdOf(step)           why a delivered job is not settled yet: `awaiting_grade` (nobody has graded it) and
 *                          `needs_review` (it was graded, not finally: a person reviews the decision) are different holds
 *   readJobs(t, ids)       GET /v1/jobs?ids=… (≤ 50, any id space), each row with its parsed id and its hold
 */
import type { OnboardTransport } from '../onboard/index.js';
import { jsonOf, okOrThrow } from '../errors/index.js';

export type JobRefKind = 'acp-v3' | 'contract' | 'hook';
export type JobRef = {
  kind: JobRefKind;
  /** the market's label: `acp-v3` for a bare number, the key's label (`bitagent`, …), `hook` for a 32-byte id */
  label: string;
  /** the chain the job lives on; null for a hook id, whose chain the reader names */
  chainId: number | null;
  /** the market's own id: the number, or the 32-byte id (lowercase) */
  jobId: string;
};

/** Where an unlabelled number lives: the Virtuals ACP v3 contract on Base. */
export const ACP_V3 = Object.freeze({ label: 'acp-v3', chainId: 8453, contract: '0x238E541BfefD82238730D00a2208E5497F1832E0', source: 'acp-base' } as const);

const KEYED = /^([a-z][a-z0-9-]*):(\d+):(\d+|0x[0-9a-fA-F]{64})$/;
const HOOK = /^0x[0-9a-fA-F]{64}$/;

/** Parse a job id. Throws a RangeError on anything that is none of the three shapes. Pure. */
export function parseJobRef(id: string | number | bigint): JobRef {
  const s = String(id).trim();
  if (/^\d+$/.test(s)) return { kind: 'acp-v3', label: ACP_V3.label, chainId: ACP_V3.chainId, jobId: BigInt(s).toString() };
  if (HOOK.test(s)) return { kind: 'hook', label: 'hook', chainId: null, jobId: s.toLowerCase() };
  const m = KEYED.exec(s);
  if (m) return { kind: 'contract', label: m[1]!, chainId: Number(m[2]), jobId: /^0x/.test(m[3]!) ? m[3]!.toLowerCase() : BigInt(m[3]!).toString() };
  throw new RangeError(`a job id is a number (ACP v3 on Base), <label>:<chainId>:<jobId> (e.g. bitagent:8453:8566) or a 32-byte hook id, not ${s.slice(0, 40)}`);
}

/** The id as the layer spells it: a bare number for ACP v3, `<label>:<chainId>:<jobId>` for a keyed one, the 32-byte id for a hook job. Pure. */
export function jobRefKey(r: JobRef): string {
  if (r.kind === 'acp-v3') return r.jobId;
  if (r.kind === 'hook') return r.jobId;
  return `${r.label}:${r.chainId}:${r.jobId}`;
}

export type JobHold = 'awaiting_grade' | 'needs_review';
/** Why a delivered, unsettled job waits. A needs_review verdict is its own hold, never "not graded yet". Pure. */
export function holdOf(step: { verdict?: string | null; decision?: string | null }): { held_by: JobHold; why: string; decision: string | null } {
  const v = typeof step.verdict === 'string' ? step.verdict : null;
  const decision = step.decision ?? null;
  if (v === 'needs_review') return { held_by: 'needs_review', why: `graded, not finally: a person reviews the decision${decision ? ` (${decision})` : ''}`, decision };
  return { held_by: 'awaiting_grade', why: 'delivered; nobody has graded the delivery yet', decision };
}

export type JobRow = {
  id: string; found: boolean; source: string | null;
  job: (Record<string, unknown> & { ending?: string | null; verdict?: string | null }) | null;
  chain_read?: Record<string, unknown> | null;
  /** the id, parsed (null when the layer echoed an id this SDK does not parse) */
  ref: JobRef | null;
  /** set when the layer's verdict is needs_review: the job is held for a person's review, not waiting for a grade */
  hold: ReturnType<typeof holdOf> | null;
};

/** GET /v1/jobs?ids=…: up to 50 jobs of any id space in one read. A malformed id is refused before any call. */
export async function readJobs(t: OnboardTransport, ids: readonly (string | number | bigint)[], o: { chain?: number; live?: boolean } = {}): Promise<JobRow[]> {
  if (!ids.length || ids.length > 50) throw new RangeError('read 1 to 50 jobs at once');
  const keys = ids.map((i) => jobRefKey(parseJobRef(i)));
  const q = new URLSearchParams({ ids: keys.join(',') });
  if (o.chain !== undefined) q.set('chain', String(o.chain));
  if (o.live) q.set('live', '1');
  const r = await t.fetch(`${t.base}/jobs?${q}`, { method: 'GET', headers: { accept: 'application/json', ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) } });
  const j = okOrThrow<{ jobs?: Omit<JobRow, 'ref' | 'hold'>[] }>(r, await jsonOf(r), 'GET /jobs');
  return (j.jobs ?? []).map((row) => {
    let ref: JobRef | null = null; try { ref = parseJobRef(row.id); } catch { ref = null; }
    const v = row.job?.verdict ?? null;
    const hold = v === 'needs_review' ? holdOf({ verdict: v, decision: typeof row.job?.['decision_id'] === 'string' ? row.job['decision_id'] as string : null }) : null;
    return { ...row, job: row.job ?? null, ref, hold };
  });
}

/**
 * Stamp adapter — a grade, stamped on chain, that anyone recomputes.
 *
 * Mirrors `@taifoon/stamp` so an integrator holding a Verdict from this SDK can put its digest on
 * chain in one of two places without a second dependency:
 *   - the GradeStampRegistry (immutable, append-only; deployed on the Taifoon devnet today), or
 *   - the ERC-8004 Reputation Registry, as feedback about the agent that did the work.
 *
 * Pure: everything here returns calldata or a hash. Nothing signs, nothing sends, nothing reads a
 * clock. A stamp is an attestation, never a proof; `mode` says which kind of grade it carries.
 */
import { createHash } from 'node:crypto';

import { ERC8004_CANONICAL } from '../erc8004/registry.generated.js';

export const STAMP_VERDICTS = ['delivered_as_specified', 'delivered_with_defects', 'not_delivered', 'cannot_determine'] as const;
export type StampVerdict = (typeof STAMP_VERDICTS)[number];
export const STAMP_VERDICT_CODE: Readonly<Record<StampVerdict, 1 | 2 | 3 | 4>> = Object.freeze({ delivered_as_specified: 1, delivered_with_defects: 2, not_delivered: 3, cannot_determine: 4 });
export const STAMP_MODE = Object.freeze({ deterministic: 1, calibrated: 2 } as const);
export type StampMode = keyof typeof STAMP_MODE;

/** deployed registries; the devnet is the only one today (Base and Arc go through the deployer ceremony) */
export const GRADE_STAMP_REGISTRY: Readonly<Record<number, string>> = Object.freeze({ 36927: '0xff5B4852AC7066D04FEd8de97bdA52401d03ad6E' });
/** the ERC-8004 Reputation Registry sits at one address on every chain it is deployed to */
export const ERC8004_REPUTATION_REGISTRY = ERC8004_CANONICAL.reputation!.toLowerCase();

/** The grade as the judge answered it: closed question, answer list, model version, and the three fields. */
export interface Grade {
  id: string;
  question: string;
  options: readonly string[];
  model: string | null;
  value: StampVerdict;
  probabilities: Readonly<Record<string, number>>;
  confidence: number;
}

/** Canonical form: this exact key order, no whitespace. The digest is sha256 over it. */
export function canonicalGrade(g: Grade): string {
  return JSON.stringify({ id: g.id, question: g.question, options: g.options, model: g.model, value: g.value, probabilities: g.probabilities, confidence: g.confidence });
}
export function gradeDigest(g: Grade): string { return '0x' + createHash('sha256').update(canonicalGrade(g)).digest('hex'); }

// ── minimal ABI encoding, so this adapter carries no chain library ─────────────────────────────────
const hex = (n: bigint, bytes = 32) => n.toString(16).padStart(bytes * 2, '0');
const word = (n: bigint | number) => hex(BigInt(n));
const addr = (a: string) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const b32 = (h: string) => { const s = h.toLowerCase().replace(/^0x/, ''); if (s.length !== 64) throw new Error('expected 32 bytes'); return s; };
const utf8 = (s: string) => Buffer.from(s, 'utf8');
const dyn = (s: string) => { const b = utf8(s); const padded = Math.ceil(b.length / 32) * 32; return word(b.length) + b.toString('hex').padEnd(padded * 2, '0'); };
/** abi.encode over a head/tail layout: static words inline, dynamic strings offset-pointed */
function abiEncode(parts: Array<{ kind: 'static'; word: string } | { kind: 'string'; value: string }>): string {
  const headLen = parts.length * 32; let tail = ''; let head = '';
  for (const p of parts) {
    if (p.kind === 'static') head += p.word;
    else { head += word(headLen + tail.length / 2); tail += dyn(p.value); }
  }
  return head + tail;
}
export function keccak256Hex(hexData: string): string {
  // Keccak-256 without a dependency: a compact implementation of the permutation.
  const RC = [1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n];
  const ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]];
  const M = (1n << 64n) - 1n; const rol = (x: bigint, n: number) => n === 0 ? x : (((x << BigInt(n)) | (x >> BigInt(64 - n))) & M);
  const bytes = Buffer.from(hexData.replace(/^0x/, ''), 'hex'); const rate = 136;
  const padded = Buffer.concat([bytes, Buffer.alloc(rate - (bytes.length % rate))]); padded[bytes.length] = (padded[bytes.length] ?? 0) ^ 0x01; padded[padded.length - 1] = (padded[padded.length - 1] ?? 0) ^ 0x80;
  const st: bigint[] = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) st[i] = st[i]! ^ padded.readBigUInt64LE(off + i * 8);
    for (let r = 0; r < 24; r++) {
      const c = [0, 1, 2, 3, 4].map((x) => st[x]! ^ st[x + 5]! ^ st[x + 10]! ^ st[x + 15]! ^ st[x + 20]!);
      const d = [0, 1, 2, 3, 4].map((x) => c[(x + 4) % 5]! ^ rol(c[(x + 1) % 5]!, 1));
      for (let i = 0; i < 25; i++) st[i] = st[i]! ^ d[i % 5]!;
      const b: bigint[] = new Array(25).fill(0n);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rol(st[x + 5 * y]!, ROT[x]![y]!);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) st[x + 5 * y] = b[x + 5 * y]! ^ (~b[(x + 1) % 5 + 5 * y]! & b[(x + 2) % 5 + 5 * y]!);
      st[0] = st[0]! ^ RC[r]!;
    }
  }
  const out = Buffer.alloc(32); for (let i = 0; i < 4; i++) out.writeBigUInt64LE(st[i]!, i * 8);
  return '0x' + out.toString('hex');
}
const selector = (sig: string) => keccak256Hex('0x' + utf8(sig).toString('hex')).slice(0, 10);

/** subjectOf(chainId, contract, jobId) exactly as the registry computes it: keccak256(abi.encode("taifoon.stamp.subject.v1", chainId, contract, jobId)). */
export function subjectOf(chainId: number | bigint, jobContract: string, jobId: string | number | bigint): string {
  const id32 = typeof jobId === 'string' && jobId.startsWith('0x') ? b32(jobId) : hex(BigInt(jobId));
  return keccak256Hex('0x' + abiEncode([{ kind: 'string', value: 'taifoon.stamp.subject.v1' }, { kind: 'static', word: word(BigInt(chainId)) }, { kind: 'static', word: addr(jobContract) }, { kind: 'static', word: id32 }]));
}

export interface UnsignedCall { chainId: number; to: string; data: string; value: '0x0'; what: string; signer: string }

/** The unsigned `stamp(subject, digest, verdict, mode, model, uri)` call for the GradeStampRegistry. */
export function encodeStamp(a: { chainId: number; subject: string; grade: Grade; mode: StampMode; uri: string; registry?: string }): UnsignedCall {
  const registry = a.registry ?? GRADE_STAMP_REGISTRY[a.chainId];
  if (!registry) throw new Error(`no GradeStampRegistry known on chain ${a.chainId}`);
  const data = selector('stamp(bytes32,bytes32,uint8,uint8,string,string)') + abiEncode([
    { kind: 'static', word: b32(a.subject) }, { kind: 'static', word: b32(gradeDigest(a.grade)) },
    { kind: 'static', word: word(STAMP_VERDICT_CODE[a.grade.value]) }, { kind: 'static', word: word(STAMP_MODE[a.mode]) },
    { kind: 'string', value: a.grade.model ?? 'unknown' }, { kind: 'string', value: a.uri },
  ]);
  return { chainId: a.chainId, to: registry, data, value: '0x0', what: `stamp ${a.grade.value} (${a.mode}) for subject ${a.subject.slice(0, 10)}… — append-only, never edited`, signer: 'anyone; the stamper is whoever signs' };
}

/** The unsigned ERC-8004 `giveFeedback(...)` call carrying the grade as feedback about `agentId`: tag1 "jev-grade", tag2 the verdict, value the confidence in hundredths, feedbackHash the digest. */
export function encodeErc8004Feedback(a: { chainId: number; agentId: number | bigint; grade: Grade; endpoint: string; feedbackURI: string; registry?: string }): UnsignedCall {
  const value = BigInt(Math.round(Math.max(0, Math.min(1, a.grade.confidence)) * 100));
  const data = selector('giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)') + abiEncode([
    { kind: 'static', word: word(BigInt(a.agentId)) }, { kind: 'static', word: word(value) }, { kind: 'static', word: word(2) },
    { kind: 'string', value: 'jev-grade' }, { kind: 'string', value: a.grade.value }, { kind: 'string', value: a.endpoint }, { kind: 'string', value: a.feedbackURI },
    { kind: 'static', word: b32(gradeDigest(a.grade)) },
  ]);
  return { chainId: a.chainId, to: a.registry ?? ERC8004_REPUTATION_REGISTRY, data, value: '0x0', what: `ERC-8004 feedback on agent ${a.agentId}: jev-grade / ${a.grade.value}, value ${value} (confidence, 2 decimals), feedbackHash = grade digest`, signer: 'any address that is not the agent’s owner or operator' };
}

/** Does a stamp's digest match a grade you hold? The whole point of the registry. */
export function verifyStamp(stampDigest: string, grade: Grade): boolean { return stampDigest.toLowerCase() === gradeDigest(grade).toLowerCase(); }

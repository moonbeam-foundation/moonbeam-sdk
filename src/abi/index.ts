/**
 * A small ABI encoder (and decoder for the static words of logs) for the calls this SDK builds, so nothing here needs a
 * chain library: uintN, intN ≥ 0, address, bool, bytesN, bytes, string, tuples and arrays (fixed or dynamic), nested.
 * Types are written the way Solidity prints them, with or without names: `(uint64 chainId,bytes32[] siblings)[]`.
 * Pinned against viem's encodeAbiParameters in test/abi.test.ts.
 */
import { bytesToHex, hexToBytes, keccakHex, utf8, type Hex } from '../onboard/index.js';

export type AbiType =
  | { kind: 'uint'; bits: number } | { kind: 'address' } | { kind: 'bool' } | { kind: 'fixed'; size: number }
  | { kind: 'bytes' } | { kind: 'string' }
  | { kind: 'tuple'; components: { name: string | null; type: AbiType }[] }
  | { kind: 'array'; of: AbiType; length: number | null };
export type AbiValue = string | number | bigint | boolean | readonly AbiValue[] | { readonly [k: string]: AbiValue };

/** split a comma list at depth 0 */
function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim());
}

/** a parameter `type name` → its parts (a lone type has no name) */
export function splitName(p: string): { type: string; name: string | null } {
  const m = /^(.*\S)\s+([A-Za-z_$][\w$]*)$/s.exec(p.trim());
  const KW = /^(memory|calldata|storage|indexed)$/;
  if (m && KW.test(m[2]!)) return { type: splitName(m[1]!).type, name: null };
  if (m) { const inner = splitName(m[1]!); return { type: inner.name && KW.test(inner.name) ? inner.type : m[1]!.trim().replace(/\s+(memory|calldata|storage|indexed)$/, ''), name: m[2]! }; }
  return { type: p.trim(), name: null };
}

/** parse one type, e.g. `(uint8 a,bytes b)[]`, `tuple(uint8)`, `bytes32[3]`, `address` */
export function parseType(src: string): AbiType {
  let s = src.trim();
  const arr = /^(.*)\[(\d*)\]$/s.exec(s);
  if (arr && !s.endsWith(')')) return { kind: 'array', of: parseType(arr[1]!), length: arr[2] ? Number(arr[2]) : null };
  if (s.startsWith('tuple(')) s = s.slice(5);
  if (s.startsWith('(')) {
    // the matching close of the first '(' must end the string (arrays were handled above)
    let depth = 0; let end = -1;
    for (let i = 0; i < s.length; i++) { if (s[i] === '(') depth++; if (s[i] === ')') { depth--; if (depth === 0) { end = i; break; } } }
    if (end !== s.length - 1) {
      const tail = s.slice(end + 1); const m = /^\[(\d*)\]$/.exec(tail);
      if (!m) throw new Error(`abi: cannot parse ${src}`);
      return { kind: 'array', of: parseType(s.slice(0, end + 1)), length: m[1] ? Number(m[1]) : null };
    }
    const inner = s.slice(1, -1);
    return { kind: 'tuple', components: (inner ? splitTop(inner) : []).map((c) => { const p = splitName(c); return { name: p.name, type: parseType(p.type) }; }) };
  }
  const tail = /^(.*)\[(\d*)\]$/.exec(s);
  if (tail) return { kind: 'array', of: parseType(tail[1]!), length: tail[2] ? Number(tail[2]) : null };
  if (s === 'address') return { kind: 'address' };
  if (s === 'bool') return { kind: 'bool' };
  if (s === 'string') return { kind: 'string' };
  if (s === 'bytes') return { kind: 'bytes' };
  const u = /^uint(\d*)$/.exec(s); if (u) return { kind: 'uint', bits: u[1] ? Number(u[1]) : 256 };
  const b = /^bytes(\d+)$/.exec(s); if (b) return { kind: 'fixed', size: Number(b[1]) };
  throw new Error(`abi: unsupported type ${src}`);
}

/** the canonical (name-free) form of a type, as selectors hash it */
export function canonical(t: AbiType): string {
  switch (t.kind) {
    case 'uint': return `uint${t.bits}`;
    case 'fixed': return `bytes${t.size}`;
    case 'tuple': return `(${t.components.map((c) => canonical(c.type)).join(',')})`;
    case 'array': return `${canonical(t.of)}[${t.length ?? ''}]`;
    default: return t.kind;
  }
}

const isDynamic = (t: AbiType): boolean =>
  t.kind === 'bytes' || t.kind === 'string' || (t.kind === 'array' && (t.length === null || isDynamic(t.of))) || (t.kind === 'tuple' && t.components.some((c) => isDynamic(c.type)));
const word = (n: bigint) => { if (n < 0n || n >= 1n << 256n) throw new RangeError(`abi: ${n} does not fit a word`); return n.toString(16).padStart(64, '0'); };
const padRight = (hex: string) => hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');

function encodeOne(t: AbiType, v: AbiValue): string {
  switch (t.kind) {
    case 'uint': { const n = BigInt(v as string | number | bigint); if (n >= 1n << BigInt(t.bits)) throw new RangeError(`abi: ${n} overflows uint${t.bits}`); return word(n); }
    case 'bool': return word(v ? 1n : 0n);
    case 'address': { const a = String(v); if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`abi: not an address: ${a}`); return a.slice(2).toLowerCase().padStart(64, '0'); }
    case 'fixed': { const h = String(v).replace(/^0x/, ''); if (h.length !== t.size * 2 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error(`abi: not bytes${t.size}: ${v}`); return h.toLowerCase().padEnd(64, '0'); }
    case 'bytes': { const h = String(v).replace(/^0x/, ''); if (h.length % 2 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error(`abi: not bytes: ${v}`); return word(BigInt(h.length / 2)) + padRight(h.toLowerCase()); }
    case 'string': { const h = bytesToHex(utf8(String(v))).slice(2); return word(BigInt(h.length / 2)) + padRight(h); }
    case 'array': {
      const items = v as readonly AbiValue[];
      if (!Array.isArray(items)) throw new Error('abi: an array type needs an array value');
      if (t.length !== null && items.length !== t.length) throw new Error(`abi: expected ${t.length} items, got ${items.length}`);
      const body = encodeSeq(items.map(() => t.of), items);
      return t.length === null ? word(BigInt(items.length)) + body : body;
    }
    case 'tuple': {
      const vals = Array.isArray(v) ? (v as readonly AbiValue[]) : t.components.map((c, i) => {
        const o = v as { readonly [k: string]: AbiValue };
        const x = c.name !== null ? o[c.name] : o[i];
        if (x === undefined) throw new Error(`abi: tuple field ${c.name ?? i} is missing`);
        return x;
      });
      return encodeSeq(t.components.map((c) => c.type), vals);
    }
  }
}

function encodeSeq(types: readonly AbiType[], values: readonly AbiValue[]): string {
  if (types.length !== values.length) throw new Error(`abi: ${types.length} types, ${values.length} values`);
  const heads: string[] = []; const tails: string[] = [];
  const headSize = types.reduce((a, t) => a + (isDynamic(t) ? 32 : staticSize(t)), 0);
  let tailLen = 0;
  types.forEach((t, i) => {
    const enc = encodeOne(t, values[i]!);
    if (isDynamic(t)) { heads.push(word(BigInt(headSize + tailLen))); tails.push(enc); tailLen += enc.length / 2; } else heads.push(enc);
  });
  return heads.join('') + tails.join('');
}
function staticSize(t: AbiType): number {
  if (t.kind === 'tuple') return t.components.reduce((a, c) => a + staticSize(c.type), 0);
  if (t.kind === 'array' && t.length !== null) return t.length * staticSize(t.of);
  return 32;
}

/** abi.encode(values) for the given types (strings or parsed) */
export function encodeParams(types: readonly (string | AbiType)[], values: readonly AbiValue[]): Hex {
  return `0x${encodeSeq(types.map((t) => (typeof t === 'string' ? parseType(t) : t)), values)}` as Hex;
}
/** the function's selector from a signature with or without names, e.g. `verify((bytes32 h)[] x)` */
export function signatureOf(fn: string): string {
  const m = /^([A-Za-z_$][\w$]*)\((.*)\)$/s.exec(fn.trim());
  if (!m) throw new Error(`abi: not a function signature: ${fn}`);
  return `${m[1]}(${paramsOf(m[2]!).map(canonical).join(',')})`;
}
const paramsOf = (list: string): AbiType[] => (list.trim() ? splitTop(list) : []).map((p) => parseType(splitName(p).type));
/** calldata: selector ‖ abi.encode(args) */
export function encodeFunction(fn: string, args: readonly AbiValue[]): Hex {
  const m = /^([A-Za-z_$][\w$]*)\((.*)\)$/s.exec(fn.trim());
  if (!m) throw new Error(`abi: not a function signature: ${fn}`);
  const types = paramsOf(m[2]!);
  const sel = keccakHex(utf8(signatureOf(fn))).slice(0, 10);
  return `${sel}${encodeSeq(types, args)}` as Hex;
}
export const topicOf = (eventSignature: string): Hex => keccakHex(utf8(signatureOf(eventSignature)));

/** decode the static head words of log data or a return value (uint, bool, address, bytesN only) */
export function decodeStatic(types: readonly string[], data: string): (bigint | boolean | string)[] {
  const h = data.replace(/^0x/, '');
  return types.map((ts, i) => {
    const w = h.slice(i * 64, i * 64 + 64); if (w.length < 64) throw new Error('abi: data too short');
    const t = parseType(ts);
    if (t.kind === 'uint') return BigInt(`0x${w}`);
    if (t.kind === 'bool') return BigInt(`0x${w}`) !== 0n;
    if (t.kind === 'address') return `0x${w.slice(24)}`;
    if (t.kind === 'fixed') return `0x${w.slice(0, t.size * 2)}`;
    throw new Error(`abi: decodeStatic does not decode ${ts}`);
  });
}
export { hexToBytes };

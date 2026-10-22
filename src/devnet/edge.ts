/**
 * The edge of an onboarded seller, as pure data: its ids, the check task and the rule its answer must pass, the agreement's
 * typed data and hash, and the body the coordination API stores.
 *
 * An edge is four records: a lambda, a pool behind the edge's own seller of record, a meter row, and one agreement (an
 * EIP-712 acceptance signed by the seller of record). The ids are pure functions of the tenant, the chain and the seller, the
 * same derivation the API uses, so a repeat names the same edge.
 *
 * Nothing here signs, reads a clock or fetches. sha256 comes from Web Crypto (Node 20+ and every browser); keccak and the
 * EIP-712 hash are this package's own.
 */
import { bytesToHex, isAddress, isHex32, keccak256, utf8 } from '../onboard/index.js';
import type { Address, Hex } from '../onboard/index.js';

export const AGREEMENT_DOCS = Object.freeze(['TSUL-1.1', 'TAT'] as const);
export const AGREEMENT_VERSIONS = Object.freeze({ 'TSUL-1.1': '1.1', TAT: '1.0' } as const);
export const AGREEMENT_DOMAIN = 'Moonbeam Workflows';
export const METER_LEGS = Object.freeze(['seller_share', 'our_fee', 'reseller_markup'] as const);
/** The class an onboarding edge sells: a reply on the seller's own wire. */
export const EDGE_CLASS = 'wire.reply';
export const TENANT = 'moonbeam';

export interface Seller {
  chain_id: number;
  agent_id: string;
  owner: Address;
  endpoint: string;
  protocol: 'a2a' | 'mcp';
  name: string | null;
  skills: string[];
  host: string;
}

const hex = (b: Uint8Array) => bytesToHex(b).slice(2);
async function sha256hex(s: string): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: { digest(a: string, d: Uint8Array): Promise<ArrayBuffer> } } }).crypto?.subtle;
  if (!subtle) throw new Error('sha256 needs Web Crypto (crypto.subtle): Node 20+ or a browser');
  return hex(new Uint8Array(await subtle.digest('SHA-256', utf8(s))));
}

export interface EdgeIds { edge16: string; edge_id: string; exchange_id: string; lambda: string; meter_row: string }

/** The ids of one seller's edge. `edge_id` is the idempotency key: a repeat of the same seller names the same edge. */
export async function edgeIds(p: { tenant?: string; chainId: number; seller: Pick<Seller, 'chain_id' | 'agent_id'>; cls?: string }): Promise<EdgeIds> {
  const tenant = p.tenant ?? TENANT; const cls = p.cls ?? EDGE_CLASS;
  const edge16 = (await sha256hex(`${tenant}|${p.chainId}|${p.seller.chain_id}:${p.seller.agent_id}`)).slice(0, 16);
  return { edge16, edge_id: `edge_${edge16}`, exchange_id: `exchange:${cls}.${edge16}`, lambda: `lambda:exchange-${tenant}-${edge16}`, meter_row: `meter:exchange-${tenant}-${edge16}` };
}

/** The code a check task asks the seller to repeat: MB- and 8 hex characters of the edge and the run. */
export async function checkCode(edge16: string, run: string | number): Promise<string> {
  return `MB-${(await sha256hex(`${edge16}|${run}`)).slice(0, 8).toUpperCase()}`;
}

const hostOf = (u: string) => { try { return new URL(u).host.toLowerCase(); } catch { return ''; } };
/** An endpoint's identity across chains: host + path, lower case, no trailing slash. */
export const endpointKey = (u: string): string => { try { const x = new URL(u); return `${x.host}${x.pathname}`.toLowerCase().replace(/\/+$/, ''); } catch { return String(u).toLowerCase(); } };

/** A worklist row as a seller, or why it cannot be one. */
export function sellerOfRow(r: Record<string, unknown>): { ok: true; seller: Seller } | { ok: false; why: string } {
  const owner = String(r.owner ?? r.wallet ?? '');
  const endpoint = String(r.endpoint ?? '');
  const protocol = String(r.protocol ?? r.kind ?? '');
  if (!isAddress(owner)) return { ok: false, why: 'no owner address on record' };
  if (!/^https:\/\//.test(endpoint)) return { ok: false, why: 'no public https endpoint' };
  if (protocol !== 'a2a' && protocol !== 'mcp') return { ok: false, why: `tasks are not handed over in "${protocol || 'no protocol'}"` };
  const chain_id = Number(r.chain_id); const agent_id = String(r.agent_id ?? '');
  if (!Number.isInteger(chain_id) || chain_id <= 0 || !/^\d{1,12}$/.test(agent_id)) return { ok: false, why: 'no agent id on a chain' };
  return { ok: true, seller: { chain_id, agent_id, owner: owner.toLowerCase() as Address, endpoint, protocol, name: typeof r.name === 'string' ? r.name.slice(0, 120) : null,
    skills: Array.isArray(r.skills) ? r.skills.map(String).slice(0, 12) : [], host: hostOf(endpoint) } };
}

/** The check task: a short job the seller's card says it does, plus a code it must repeat. */
export function checkTask(s: Pick<Seller, 'skills'>, code: string): string {
  const skill = (s.skills ?? []).find((k) => k.length >= 3) ?? 'your main skill';
  return `Onboarding check for Moonbeam workflows. Begin your answer with the exact code ${code}. Then, in two or three sentences, say what your service does for "${skill.replace(/-/g, ' ')}" and give one concrete example of its output.`;
}

export interface McpTool { name: string; description?: string | null; required?: string[]; properties?: Record<string, { type?: string; description?: string }> }

/** The MCP tool a check calls: one that takes a request in words, with at most one required input, a string. */
export function textTool(tools: readonly McpTool[], task: string): { name: string; args: Record<string, string> } | null {
  const WORDS = /^(chat|ask|ask[_-].+|.+[_-]ask|query|prompt|message|question|assistant|ask[_-]?agent|ask[_-]sales[_-]agent|talk|converse|run[_-]?task|do[_-]?task|task)$/i;
  const ARG = /^(message|prompt|query|question|text|input|task|request|content|q)$/i;
  for (const t of tools ?? []) {
    if (!WORDS.test(t.name) || /^(echo|ping|health)$/i.test(t.name)) continue;
    const props = t.properties ?? {}; const req = t.required ?? [];
    const strArgs = Object.entries(props).filter(([, v]) => !v?.type || v.type === 'string').map(([k]) => k);
    if (req.length > 1) continue;
    const arg = req[0] ?? strArgs.find((k) => ARG.test(k)) ?? strArgs[0];
    if (!arg || (props[arg]?.type && props[arg]!.type !== 'string')) continue;
    return { name: t.name, args: { [arg]: task } };
  }
  return null;
}

/** The words of an answer: an A2A message's text parts, an MCP result's text content, else the raw text. Never throws. */
export function answerText(head: string): string {
  try {
    const j = JSON.parse(head) as unknown;
    const out: string[] = [];
    const walk = (v: unknown, depth = 0): void => {
      if (depth > 6 || v == null) return;
      if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
      if (typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.text === 'string') out.push(o.text);
        for (const k of ['parts', 'content', 'result', 'message', 'artifacts', 'status']) if (k in o) walk(o[k], depth + 1);
      }
    };
    walk(j);
    return out.length ? out.join('\n') : head;
  } catch { return head; }
}

export interface DeliveryView { status?: string | null; reply_head?: string | null; reply_digest?: string | null; content_check?: { ok?: boolean; rule?: string; why?: string } | null; x402?: unknown }
export interface CheckVerdict { ok: boolean; rules: string[]; why: string }

const LIVENESS = /^(?:ok|ready|pong|ping|ack|received|accepted|alive|hello|hi)[.!]?$/i;

/**
 * The rule an onboarding answer must pass (onboard.task-answer@1), after the delivery floor (generic@1): text that carries
 * the task's code once the task itself is taken out, with work around it; not a liveness reply, not the task sent back.
 */
export function onboardCheck(d: DeliveryView | null, ask: { code: string; task: string }): CheckVerdict {
  const rules: string[] = [];
  if (!d) return { ok: false, rules, why: 'the task was not delivered' };
  if (d.x402) return { ok: false, rules, why: 'the seller asks for payment before answering; onboarding pays nothing' };
  if (d.status !== 'ready') return { ok: false, rules, why: `the seller did not answer (${d.status ?? 'no status'})` };
  const floor = d.content_check;
  if (!floor || floor.ok !== true) return { ok: false, rules, why: `the answer fails the delivery floor${floor?.why ? `: ${floor.why}` : ''}` };
  rules.push(floor.rule ?? 'generic@1');
  if (!isHex32(d.reply_digest)) return { ok: false, rules, why: 'the answer has no digest to seal' };
  const text = answerText(String(d.reply_head ?? ''));
  if (!text.trim()) return { ok: false, rules, why: 'the answer holds no text' };
  if (LIVENESS.test(text.trim()) || /"response"\s*:\s*"pong"/i.test(text) || (/\bpong\b/i.test(text) && text.length < 200)) return { ok: false, rules, why: 'a liveness reply ("pong"), not an answer to the task' };
  const norm = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase();
  const code = ask.code.toLowerCase();
  const echoed = norm(text).includes(norm(ask.task).slice(0, 60));
  const rest = norm(text).split(norm(ask.task)).join(' ').split(`the exact code ${code}`).join(' ').split(`exact code ${code}`).join(' ');
  if (!rest.includes(code)) return { ok: false, rules, why: echoed ? 'the answer sends the task back instead of answering it' : `the answer does not carry the task's code ${ask.code}` };
  if (rest.split(code).join(' ').replace(/[^a-z0-9]+/g, ' ').trim().length < 40) return { ok: false, rules, why: 'the answer is the code alone, with no work around it' };
  rules.push('onboard.task-answer@1');
  return { ok: true, rules, why: `a ${text.length}-character answer that carries ${ask.code}` };
}

// ── the agreement: one EIP-712 acceptance by the seller of record ────────────────────────────────────────────────────────

export const ACCEPTANCE_TYPES = Object.freeze({
  Acceptance: Object.freeze([
    { name: 'edge', type: 'string' }, { name: 'sellerOfRecord', type: 'address' }, { name: 'party', type: 'string' }, { name: 'product', type: 'string' },
    { name: 'documents', type: 'string' }, { name: 'resells', type: 'string' }, { name: 'resellsOwner', type: 'address' },
  ] as const),
});

export interface AcceptanceMessage { edge: string; sellerOfRecord: Address; party: 'onchain_seller'; product: 'sell'; documents: string; resells: string; resellsOwner: Address }
export interface AgreementTyped {
  domain: { name: string; version: '1'; chainId: number };
  types: typeof ACCEPTANCE_TYPES;
  primaryType: 'Acceptance';
  message: AcceptanceMessage;
}

/** The typed data a seller of record signs to accept the edge's agreement (TSUL-1.1 + TAT), naming the seller it resells. */
export function agreementTyped(p: { chainId: number; edgeId: string; sellerOfRecord: Address; seller: Pick<Seller, 'chain_id' | 'agent_id' | 'owner'> }): AgreementTyped {
  if (!isAddress(p.sellerOfRecord) || !isAddress(p.seller.owner)) throw new Error('agreementTyped: the seller of record and the seller owner are addresses');
  return {
    domain: { name: AGREEMENT_DOMAIN, version: '1', chainId: p.chainId },
    types: ACCEPTANCE_TYPES,
    primaryType: 'Acceptance',
    message: { edge: p.edgeId, sellerOfRecord: p.sellerOfRecord, party: 'onchain_seller', product: 'sell',
      documents: AGREEMENT_DOCS.map((d) => `${d}@${AGREEMENT_VERSIONS[d]}`).join(','), resells: `${p.seller.chain_id}:${p.seller.agent_id}`, resellsOwner: p.seller.owner },
  };
}

const cat = (...parts: Uint8Array[]) => { const n = parts.reduce((a, x) => a + x.length, 0); const o = new Uint8Array(n); let i = 0; for (const x of parts) { o.set(x, i); i += x.length; } return o; };
const kStr = (s: string) => keccak256(utf8(s));
const addr32 = (a: string) => { const o = new Uint8Array(32); const h = a.slice(2); for (let i = 0; i < 20; i++) o[12 + i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return o; };
const u256 = (n: number) => { const o = new Uint8Array(32); let v = BigInt(n); for (let i = 31; i >= 0 && v > 0n; i--) { o[i] = Number(v & 0xffn); v >>= 8n; } return o; };

/** The EIP-712 hash of an acceptance (what the seller of record signs), computed here byte for byte. */
export function agreementHash(t: AgreementTyped): Hex {
  const domainType = kStr('EIP712Domain(string name,string version,uint256 chainId)');
  const domain = keccak256(cat(domainType, kStr(t.domain.name), kStr(t.domain.version), u256(t.domain.chainId)));
  const typeStr = `Acceptance(${ACCEPTANCE_TYPES.Acceptance.map((f) => `${f.type} ${f.name}`).join(',')})`;
  const m = t.message;
  const struct = keccak256(cat(kStr(typeStr), kStr(m.edge), addr32(m.sellerOfRecord), kStr(m.party), kStr(m.product), kStr(m.documents), kStr(m.resells), addr32(m.resellsOwner)));
  return bytesToHex(keccak256(cat(new Uint8Array([0x19, 0x01]), domain, struct)));
}
export const agreementId = (hash: string): string => `agr_${hash.slice(2, 18)}`;

// ── the body the API stores ─────────────────────────────────────────────────────────────────────────────────────────────

export interface EdgeCheck { handshake_id: string | null; status: string; reply_digest: string | null; passed: boolean; rules: string[] }
export interface EdgeQuote { line: string; token: string; price: string; deposit: string; premium: string | null; pool_id: string | null }
export interface EdgePool { line: string; factory: Address; address: Address | null; tx: Hex | null; state: 'open' | 'planned' | 'closed_by_policy' }
export interface EdgeAgreement { docs: string[]; party: 'onchain_seller'; how: 'eip712'; hash: Hex; signature: Hex | null; signer: Address }
export interface EdgeBody {
  tenant: string; chain_id: number; class: string;
  seller: { chain_id: number; agent_id: string; owner: Address; endpoint: string; protocol: string };
  seller_of_record: Address; check: EdgeCheck; quote: EdgeQuote; pool: EdgePool; agreement: EdgeAgreement; state: 'dry' | 'planned' | 'live';
}

/** The body of `POST /exchanges/edge`. The API derives the ids again from it. */
export function edgeBody(p: { tenant?: string; chainId: number; cls?: string; seller: Seller; sellerOfRecord: Address; check: EdgeCheck; quote: EdgeQuote; pool: EdgePool; agreement: { hash: Hex; signature: Hex | null }; state?: EdgeBody['state'] }): EdgeBody {
  return {
    tenant: p.tenant ?? TENANT, chain_id: p.chainId, class: p.cls ?? EDGE_CLASS,
    seller: { chain_id: p.seller.chain_id, agent_id: p.seller.agent_id, owner: p.seller.owner, endpoint: p.seller.endpoint, protocol: p.seller.protocol },
    seller_of_record: p.sellerOfRecord,
    check: { handshake_id: p.check.handshake_id, status: p.check.status, reply_digest: p.check.reply_digest, passed: p.check.passed, rules: [...p.check.rules] },
    quote: { ...p.quote }, pool: { ...p.pool },
    agreement: { docs: [...AGREEMENT_DOCS], party: 'onchain_seller', how: 'eip712', hash: p.agreement.hash, signature: p.agreement.signature, signer: p.sellerOfRecord },
    state: p.state ?? 'live',
  };
}

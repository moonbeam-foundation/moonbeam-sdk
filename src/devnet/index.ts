/**
 * Devnet onboarding: take one seller from the worklist to a working edge on a test network, with every step a call here.
 *
 *   find → check → edge (pool + agreement + record) → fund the pool → quote → hire → deliver → grade → settle → read back
 *
 * Every function takes a transport (a fetch and the coordination endpoint, see ./onboard) and a devnet profile (./devnet
 * `devnetProfile`), and returns plain data or unsigned calls. Nothing here signs or holds a key: the caller signs each
 * UnsignedCall with its own devnet signer. The money calls refuse any chain but the profile's own.
 *
 * The package ships no test-network address or URL: every one comes from the profile, which reads them at runtime.
 */
import { RUBRIC_v1 } from '@taifoon/jev';
import { isAddress, isHex32, selector, OnboardError } from '../onboard/index.js';
import type { Address, Hex, OnboardTransport, UnsignedCall } from '../onboard/index.js';
import { depositCalls } from '../pools/index.js';
import { jsonOf } from '../errors/index.js';
import { agreementHash, agreementId, agreementTyped, checkCode, checkTask, edgeBody, edgeIds, endpointKey, onboardCheck, sellerOfRow, textTool, EDGE_CLASS, TENANT } from './edge.js';
import type { AgreementTyped, CheckVerdict, EdgeBody, EdgeIds, EdgePool, EdgeQuote, McpTool, Seller } from './edge.js';
import type { DevnetProfile } from './profile.js';

export * from './profile.js';
export * from './edge.js';

/** One devnet GLMR job's price, in the token's 18 decimals: one test GLMR. */
export const DEVNET_JOB_PRICE = 10n ** 18n;
/** The smallest pool backing an onboarding funds (ten test GLMR), the ./pools minimum deposit. */
export const DEVNET_POOL_BACKING = 10n * 10n ** 18n;

// ── transport helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

const hdr = (t: OnboardTransport): Record<string, string> => ({ accept: 'application/json', ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) });
async function get<T>(t: OnboardTransport, path: string): Promise<T> {
  const r = await t.fetch(`${t.base}${path}`, { method: 'GET', headers: hdr(t) });
  const j = await jsonOf(r);
  if (!r.ok) throw new OnboardError(r.status, `GET ${path} → ${r.status}`, j);
  return j as T;
}
async function post<T>(t: OnboardTransport, path: string, body: unknown): Promise<{ status: number; body: T }> {
  const r = await t.fetch(`${t.base}${path}`, { method: 'POST', headers: { ...hdr(t), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await jsonOf(r);
  if (!r.ok) throw new OnboardError(r.status, `POST ${path} → ${r.status}`, j);
  return { status: r.status, body: j as T };
}
/** An unsigned devnet call; the evaluator signs the ending of a graded job. */
export type DevnetCall = Omit<UnsignedCall, 'signer'> & { signer: UnsignedCall['signer'] | 'evaluator' };
const asCall = (chainId: number, c: { to: string; data: string; step?: string; action?: string; signer?: string; effect?: string }, signer: DevnetCall['signer']): DevnetCall =>
  ({ chainId, to: c.to as Address, data: c.data as Hex, value: '0x0', step: String(c.action ?? c.step ?? 'call'), signer, effect: String(c.effect ?? c.step ?? c.action ?? '') });

/** Chains with value: a devnet profile never names one, and no call here is built for one. */
export const MAINNET_CHAIN_IDS: readonly number[] = Object.freeze([1, 10, 56, 100, 137, 143, 324, 1284, 1285, 4663, 5042, 8453, 42161, 43114, 59144, 534352]);
/** Refuse a call aimed anywhere but the profile's chain, and any profile that names a chain with value. */
export function assertDevnet(p: Pick<DevnetProfile, 'chainId'>, chainId: number = p.chainId): void {
  if (MAINNET_CHAIN_IDS.includes(p.chainId)) throw new RangeError(`refused: chain ${p.chainId} has value; a devnet profile never names it`);
  if (chainId !== p.chainId) throw new RangeError(`refused: a devnet call on chain ${chainId}, but the devnet profile is chain ${p.chainId}`);
}

// ── 1. find ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface WorklistRow { chain_id: number; agent_id: string | number; owner?: string; wallet?: string; endpoint?: string; kind?: string; protocol?: string; name?: string; skills?: string[]; stage?: string }

/**
 * Find sellers ready to onboard: `GET /onboard/worklist` (stages first-job and list by default, paged), folded to sellers.
 * `skip` takes edge ids or endpoint keys already onboarded; their sellers are left out.
 */
export async function findSellers(t: OnboardTransport, p: Pick<DevnetProfile, 'chainId'>, o: { stages?: string[]; limit?: number; skip?: ReadonlySet<string>; pages?: number } = {}): Promise<{ sellers: (Seller & { ids: EdgeIds })[]; skipped: { key: string; why: string }[]; read: number }> {
  const stages = o.stages ?? ['first-job', 'list']; const limit = o.limit ?? 5; const skip = o.skip ?? new Set<string>();
  const rows: WorklistRow[] = [];
  for (const stage of stages) {
    for (let offset: number | null = 0, page = 0; offset !== null && page < (o.pages ?? 10); page++) {
      const j: { rows?: WorklistRow[]; next_offset?: number | null } = await get<{ rows?: WorklistRow[]; next_offset?: number | null }>(t, `/onboard/worklist?stage=${encodeURIComponent(stage)}&limit=200&offset=${offset}`);
      const got: WorklistRow[] = Array.isArray(j.rows) ? j.rows : [];
      rows.push(...got.map((x) => ({ ...x, stage })));
      const next: number | null | undefined = j.next_offset;
      offset = typeof next === 'number' && next > offset && got.length ? next : null;
    }
  }
  const sellers: (Seller & { ids: EdgeIds })[] = []; const skipped: { key: string; why: string }[] = []; const eps = new Set<string>();
  for (const r of rows) {
    const key = `${r.chain_id}:${r.agent_id}`;
    const s = sellerOfRow(r as unknown as Record<string, unknown>);
    if (!s.ok) { skipped.push({ key, why: s.why }); continue; }
    const ids = await edgeIds({ chainId: p.chainId, seller: s.seller });
    const ep = endpointKey(s.seller.endpoint);
    if (skip.has(ids.edge_id) || skip.has(ep)) { skipped.push({ key, why: 'already onboarded' }); continue; }
    if (eps.has(ep)) { skipped.push({ key, why: 'its endpoint is already in this pick' }); continue; }
    if (sellers.length >= limit) { skipped.push({ key, why: `over the limit (${limit})` }); continue; }
    eps.add(ep); sellers.push({ ...s.seller, ids });
  }
  return { sellers, skipped, read: rows.length };
}

/** MCP initialize → tools/list at a seller's own endpoint (a read; nothing is called). Null when the list cannot be read. */
export async function mcpTools(fetchFn: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ text(): Promise<string>; headers: { get(n: string): string | null } }>, url: string): Promise<McpTool[] | null> {
  const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const parse = async (r: { text(): Promise<string> }) => { const s = await r.text(); const m = /^data: (.*)$/m.exec(s); try { return JSON.parse(m ? m[1]! : s) as { result?: { tools?: { name: string; description?: string; inputSchema?: { required?: string[]; properties?: Record<string, { type?: string }> } }[] } }; } catch { return null; } };
  try {
    const r1 = await fetchFn(url, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'moonbeam-onboarding', version: '0.9' } } }) });
    const sid = r1.headers.get('mcp-session-id'); await parse(r1);
    const r2 = await fetchFn(url, { method: 'POST', headers: { ...H, ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
    const d = await parse(r2);
    return (d?.result?.tools ?? []).map((x) => ({ name: x.name, description: x.description ?? null, required: x.inputSchema?.required ?? [], properties: x.inputSchema?.properties ?? {} }));
  } catch { return null; }
}

// ── 2. check ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SellerCheck extends CheckVerdict { passed: boolean; handshake_id: string | null; status: string; reply_digest: Hex | null; task: string; code: string; tool: string | null; args: Record<string, string> | null; protocol: string }

/**
 * Check a seller: hand it a short task in its own protocol (`POST /handshake`, dispatch) and hold its answer to the
 * onboarding rule. An MCP seller needs a tool that takes a request in words: pass its `tools` (see `mcpTools`).
 */
export async function checkSeller(t: OnboardTransport, s: Seller & { ids?: EdgeIds }, o: { chainId: number; run: string | number; tools?: readonly McpTool[] | null }): Promise<SellerCheck> {
  const ids = s.ids ?? await edgeIds({ chainId: o.chainId, seller: s });
  const code = await checkCode(ids.edge16, o.run); const task = checkTask(s, code);
  const no = (why: string): SellerCheck => ({ ok: false, passed: false, rules: [], why, handshake_id: null, status: 'not sent', reply_digest: null, task, code, tool: null, args: null, protocol: s.protocol });
  let tool: { name: string; args: Record<string, string> } | null = null;
  if (s.protocol === 'mcp') {
    if (!o.tools) return no('the MCP tool list could not be read');
    tool = textTool(o.tools, task);
    if (!tool) return no(`no MCP tool takes a request in words (tools: ${o.tools.map((x) => x.name).slice(0, 8).join(', ')})`);
  }
  let r: { body: { handshake_id?: string; delivery?: Parameters<typeof onboardCheck>[0] & { protocol?: string; tool?: string } } };
  try {
    r = await post(t, '/handshake', { candidate: { address: s.owner, kind: s.protocol, agentId: s.agent_id, chainId: s.chain_id, endpoint: s.endpoint },
      task, chain: String(s.chain_id), dispatch: true, ...(tool ? { tool: tool.name, args: tool.args } : {}) });
  } catch (e) { return no(`the task was refused: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)); }
  const d = r.body.delivery ?? null;
  const v = onboardCheck(d, { code, task });
  return { ...v, passed: v.ok, handshake_id: r.body.handshake_id ?? null, status: d?.status ?? 'none', reply_digest: isHex32(d?.reply_digest) ? d!.reply_digest as Hex : null, task, code, tool: d?.tool ?? tool?.name ?? null, args: tool?.args ?? null, protocol: d?.protocol ?? s.protocol };
}

// ── 3. quote (the only source of the terms) ─────────────────────────────────────────────────────────────────────────────

export interface QuoteReply {
  ok?: boolean; line?: { key?: string; name?: string; hook?: string; factory?: string; token?: string; evaluator_adapter?: string } | null; token?: { symbol?: string; address?: string } | null;
  price?: string; deposit?: string; premium?: string | null; premium_ratio?: number | null; pool_id?: string | null; pool_free?: string | null;
  pool?: { vault?: string; free?: string; total?: string; encumbered?: string } | null; why?: string[]; record?: { n?: number; settled?: number; incorrect?: number } | null;
}
export interface EdgeTerms { quote: EdgeQuote; pool: { vault: Address | null; total: bigint; free: bigint } | null; why: string[]; raw: QuoteReply }

/** The edge's terms: `POST /pools/quote` (tenant moonbeam, settled through the layer). Nothing is reserved. */
export async function quoteEdge(t: OnboardTransport, p: Pick<DevnetProfile, 'chainId'>, a: { sellerOfRecord: Address; price?: bigint }): Promise<EdgeTerms> {
  const { body: q } = await post<QuoteReply>(t, '/pools/quote', { seller: a.sellerOfRecord, price: String(a.price ?? DEVNET_JOB_PRICE), chainId: p.chainId, tenant: TENANT, via: 'us' });
  return termsOf(q);
}
/** The fold behind `quoteEdge`, exported for tests. */
export function termsOf(q: QuoteReply): EdgeTerms {
  if (q.ok === false || q.price === undefined || q.deposit === undefined) throw new OnboardError(422, 'the quote gave no terms', q);
  const big = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : 0n);
  return {
    quote: { line: String(q.line?.key ?? q.line?.name ?? ''), token: String(q.token?.symbol ?? ''), price: String(q.price), deposit: String(q.deposit), premium: q.premium == null ? null : String(q.premium), pool_id: q.pool_id ?? null },
    pool: q.pool && isAddress(q.pool.vault) ? { vault: q.pool.vault, total: big(q.pool.total), free: big(q.pool.free) } : null,
    why: Array.isArray(q.why) ? q.why.map(String) : [], raw: q,
  };
}

// ── 4. the edge: pool, agreement, record ────────────────────────────────────────────────────────────────────────────────

export interface PoolOpenPlan { state: 'plan' | 'exists'; factory: Address; pool: Address | null; call: DevnetCall | null }

/** The pool behind the edge's seller of record: `POST /pools/open` on the profile's GLMR line. A plan to sign, or the pool that exists. */
export async function openPoolPlan(t: OnboardTransport, p: Pick<DevnetProfile, 'chainId' | 'line'>, a: { sellerOfRecord: Address; edge16: string }): Promise<PoolOpenPlan> {
  const { body: b } = await post<{ ok?: boolean; state?: string; factory?: string; pool?: { address?: string } | string | null; expected_pool?: { address?: string } | null; tx?: { to: string; data: string } | null; simulation?: { ok?: boolean } | null }>(t, '/pools/open',
    { chain_id: p.chainId, seller: a.sellerOfRecord, line: p.line, from: a.sellerOfRecord, name: `Moonbeam Cover: ${a.edge16}`, symbol: 'mbCOVER' });
  const poolOf = (x: unknown): Address | null => (typeof x === 'string' && isAddress(x) ? x : x && typeof x === 'object' && isAddress((x as { address?: string }).address) ? (x as { address: Address }).address : null);
  if (!isAddress(b.factory)) throw new OnboardError(422, 'the pool plan names no factory', b);
  if (b.state === 'exists') return { state: 'exists', factory: b.factory, pool: poolOf(b.pool), call: null };
  if (!b.tx || b.simulation?.ok !== true) throw new OnboardError(422, 'the pool plan gave no simulated transaction', b);
  return { state: 'plan', factory: b.factory, pool: poolOf(b.expected_pool), call: asCall(p.chainId, { ...b.tx, step: 'createPool', effect: 'open the pool behind the seller of record; gas only' }, 'seller') };
}

/** The pool a sent createPool made, read back through the API (`GET /pools/open/:chain/:tx`). `state` pending means retry. */
export async function poolOpened(t: OnboardTransport, p: Pick<DevnetProfile, 'chainId'>, tx: Hex): Promise<{ state: string; pool: Address | null; retryAfter: number | null }> {
  const j = await get<{ state?: string; pool?: { address?: string } | string | null; retry_after_seconds?: number }>(t, `/pools/open/${p.chainId}/${tx}`);
  const pool = typeof j.pool === 'string' ? j.pool : j.pool?.address;
  return { state: String(j.state ?? 'unknown'), pool: isAddress(pool) ? pool : null, retryAfter: typeof j.retry_after_seconds === 'number' ? j.retry_after_seconds : null };
}

/** The agreement the seller of record signs (typed data) and its hash and id. */
export function edgeAgreement(p: Pick<DevnetProfile, 'chainId'>, a: { edgeId: string; sellerOfRecord: Address; seller: Pick<Seller, 'chain_id' | 'agent_id' | 'owner'> }): { typed: AgreementTyped; hash: Hex; id: string } {
  const typed = agreementTyped({ chainId: p.chainId, edgeId: a.edgeId, sellerOfRecord: a.sellerOfRecord, seller: a.seller });
  const hash = agreementHash(typed);
  return { typed, hash, id: agreementId(hash) };
}

export interface ExchangeRow {
  edge_id: string; id: string; tenant: string; chain_id: number; class: string; state: string; seller_of_record: string;
  pool: { address: string | null; tx: string | null; line: string; state: string };
  lambda: { id: string; vault: string; acts: unknown[] }; meter_row: { id: string; legs: string[] }; agreement: { id: string; hash: string; signer: string; signature: string | null; enforced?: boolean };
}

/** Store the edge: `POST /exchanges/edge` (idempotent on the edge id; a repeat answers created false). */
export async function writeEdge(t: OnboardTransport, body: EdgeBody): Promise<{ created: boolean; exchange: ExchangeRow }> {
  const { body: j } = await post<{ created?: boolean; exchange?: ExchangeRow }>(t, '/exchanges/edge', body);
  if (!j.exchange) throw new OnboardError(502, 'the edge write gave no record', j);
  return { created: j.created === true, exchange: j.exchange };
}
/** Read one edge back: `GET /exchanges?id=`. Null when the API holds none. */
export async function readEdge(t: OnboardTransport, edgeId: string): Promise<ExchangeRow | null> {
  const j = await get<{ rows?: ExchangeRow[] }>(t, `/exchanges?id=${encodeURIComponent(edgeId)}`);
  return (j.rows ?? []).find((r) => r.edge_id === edgeId) ?? null;
}
export { edgeBody };
export type { EdgeBody, EdgePool, EdgeQuote };

// ── 5. fund the pool with the faucet's GLMR ─────────────────────────────────────────────────────────────────────────────

export const MINT_SIGNATURE = 'mint(address,uint256)';
const word = (n: bigint) => n.toString(16).padStart(64, '0');
const addrWord = (a: string) => a.slice(2).toLowerCase().padStart(64, '0');

/**
 * The faucet's test GLMR: the devnet token mints to anyone. One unsigned `mint(to, amount)` on the profile's token. Refused on
 * any chain but the profile's (a mainnet GLMR cannot be minted, and this call is never built for one).
 */
export function faucetMintCalls(p: Pick<DevnetProfile, 'chainId' | 'token'>, a: { to: Address; amount: bigint }): DevnetCall[] {
  assertDevnet(p);
  if (!isAddress(a.to)) throw new Error(`not an address: ${a.to}`);
  if (a.amount <= 0n) throw new RangeError('amount must be positive');
  return [{ chainId: p.chainId, to: p.token.address, data: (selector(MINT_SIGNATURE) + addrWord(a.to) + word(a.amount)) as Hex, value: '0x0', step: 'faucet-mint', signer: 'anyone', effect: `mint ${a.amount} test ${p.token.symbol} to ${a.to} (devnet faucet)` }];
}

/** Gas from the devnet faucet: `POST <faucet>/claim { address }`. The faucet URL comes from the profile (options or env). */
export async function claimGas(p: Pick<DevnetProfile, 'faucet'>, address: Address, f: OnboardTransport['fetch']): Promise<{ ok: boolean; status: number; body: unknown }> {
  if (!p.faucet) return { ok: false, status: 0, body: { error: 'no faucet in the profile (MOONBEAM_DEVNET_FAUCET)' } };
  const r = await f(`${p.faucet.replace(/\/$/, '')}/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
}

/**
 * The calls that back a pool: the API's plan (`POST /pools/vault`, deposit: an exact approve when the allowance is short,
 * then deposit) — it reads the backer's balance and allowance first. When the API does not plan it, ./pools `depositCalls`
 * builds the same two calls.
 */
export async function fundPoolPlan(t: OnboardTransport, p: Pick<DevnetProfile, 'chainId' | 'token'>, a: { pool: Address; from: Address; assets: bigint }): Promise<{ calls: DevnetCall[]; short: { needs: string; has: string } | null; source: 'layer' | 'sdk' }> {
  assertDevnet(p);
  try {
    const { body: j } = await post<{ txs?: { step?: string; to: string; data: string }[]; short?: { needs: string; has: string } | null }>(t, '/pools/vault', { chain_id: p.chainId, pool: a.pool, action: 'deposit', from: a.from, assets: String(a.assets) });
    if (Array.isArray(j.txs) && j.txs.length) return { calls: j.txs.map((x) => asCall(p.chainId, { ...x, effect: x.step === 'approve' ? 'allow the pool to take exactly the backing' : 'deposit the backing; the pool mints shares' }, 'anyone')), short: j.short ?? null, source: 'layer' };
  } catch (e) { if (!(e instanceof OnboardError) || (e.status !== 404 && e.status !== 501)) throw e; }
  return { calls: depositCalls({ chainId: p.chainId, pool: a.pool, asset: p.token.address, amount: a.assets, receiver: a.from, openOn: [p.chainId] }), short: null, source: 'sdk' };
}

// ── 6–9. hire, deliver, grade, settle ───────────────────────────────────────────────────────────────────────────────────

export interface SettlePlanCall { action: string; step?: string; signer: string; to: string; data: string; effect?: string }
export interface SettlePlan { jobId: Hex; ending: 'post-complete' | 'post-reject' | 'held'; hook: Address; adapter: Address; token: Address; deposit: string; price: string; deadline: number; calls: SettlePlanCall[]; held_reason?: unknown }
export interface HireAsk { buyer: Address; sellerOfRecord: Address; price?: bigint; evidence: Hex; refId: string; task: string; specUri?: string; deadline: number }

/** Who signs a plan's call: the buyer, the seller (of record) or the evaluator. */
export const signerOf = (s: string): 'buyer' | 'seller' | 'evaluator' | null =>
  (/^\s*(the\s+)?buyer\b/i.test(s) ? 'buyer' : /seller/i.test(s) ? 'seller' : /^\s*(the\s+)?evaluator\b/i.test(s) ? 'evaluator' : null);

async function settlePlan(t: OnboardTransport, p: Pick<DevnetProfile, 'chainId'>, a: HireAsk, verdict?: { decided: 'complete' | 'reject'; decision_id: string; digest: Hex }): Promise<SettlePlan> {
  assertDevnet(p);
  const { body: j } = await post<SettlePlan & { ok?: boolean; error?: string }>(t, '/settle', {
    via: 'us', tenant: TENANT, kind: 'agent', chainId: p.chainId, buyer: a.buyer, seller: a.sellerOfRecord, price: String(a.price ?? DEVNET_JOB_PRICE),
    evidence: a.evidence, ref: { id: a.refId }, task: a.task, ...(a.specUri ? { spec_uri: a.specUri } : {}), deadline: a.deadline, pool: null,
    ...(verdict ? { verdict: verdict.decided, decision_id: verdict.decision_id, decision_digest: verdict.digest } : {}),
  });
  if (!isHex32(j.jobId) || !Array.isArray(j.calls)) throw new OnboardError(502, 'the settle plan gave no job', j);
  return j;
}

/** The phases of a plan's calls: the buyer's hire, the seller's acceptance, the delivery, and the evaluator's ending. */
export function phasesOf(plan: Pick<SettlePlan, 'calls'>, chainId: number): { hire: DevnetCall[]; accept: DevnetCall[]; deliver: DevnetCall[]; settle: DevnetCall[] } {
  const out = { hire: [] as DevnetCall[], accept: [] as DevnetCall[], deliver: [] as DevnetCall[], settle: [] as DevnetCall[] };
  for (const c of plan.calls) {
    const who = signerOf(c.signer);
    if (!who) throw new Error(`no signer named for "${c.action}" (${c.signer})`);
    const call = asCall(chainId, c, who);
    if (who === 'evaluator') out.settle.push(call);
    else if (who === 'buyer') out.hire.push(call);
    else if (/submit/i.test(c.action)) out.deliver.push(call);
    else out.accept.push(call);
  }
  return out;
}

/**
 * Hire: the plan of one job on the profile's GLMR line, settled through the layer, with no verdict yet. Its calls are
 * the buyer's approve and open (`hire`), the seller's deposit approve and accept (`accept`), and the delivery (`deliver`).
 * The same ask later gives the same job id (the salt is the kind, the reference and the evidence).
 */
export async function hire(t: OnboardTransport, p: Pick<DevnetProfile, 'chainId'>, a: HireAsk): Promise<{ plan: SettlePlan; hire: DevnetCall[]; accept: DevnetCall[]; deliver: DevnetCall[] }> {
  const plan = await settlePlan(t, p, a);
  const ph = phasesOf(plan, p.chainId);
  return { plan, hire: ph.hire, accept: ph.accept, deliver: ph.deliver };
}

/** Deliver: the delivery call of a hire (the seller's submit with the answer's digest). */
export const deliver = (h: { deliver: DevnetCall[] }): DevnetCall[] => h.deliver;

// the binary rule: the grader's own thresholds (RUBRIC_v1 THRESHOLDS_v1), never typed here
const TH = (RUBRIC_v1 as unknown as { thresholds: { rejectSpecMax: number; cheatShapedMin: number } }).thresholds;
export const BINARY_THRESHOLDS = Object.freeze({ specMetAbove: TH.rejectSpecMax, cheatShapedBelow: TH.cheatShapedMin });
export const BINARY_RULE_ID = 'moonbeam.binary-verdict@1';

export interface Grade { decided: 'complete' | 'reject'; by: 'grader' | 'rule'; raw_verdict: string | null; spec_met: number | null; cheat_shaped: number | null; decision_id: string | null; why: string; rule_id: string }

const yesOf = (a: unknown): number | null => {
  if (typeof a === 'number') return Number.isFinite(a) ? a : null;
  if (!a || typeof a !== 'object') return null;
  const o = a as { probabilities?: { yes?: number }; confidence?: number; value?: string };
  if (typeof o.probabilities?.yes === 'number') return o.probabilities.yes;
  if (typeof o.confidence === 'number' && (o.value === 'yes' || o.value === 'no')) return o.value === 'yes' ? o.confidence : 1 - o.confidence;
  return null;
};
/** spec_met and cheat_shaped P(yes) from a grade's scores or answers (an object by id, or a list of { id, … }). */
export function scoresOf(src: unknown): { spec_met: number | null; cheat_shaped: number | null } {
  const out = { spec_met: null as number | null, cheat_shaped: null as number | null };
  if (!src || typeof src !== 'object') return out;
  const o = src as Record<string, unknown>;
  for (const holder of [o, o.decision, o.receipt, o.grade] as (Record<string, unknown> | undefined)[]) {
    if (!holder || typeof holder !== 'object') continue;
    for (const k of ['spec_met', 'cheat_shaped'] as const) {
      const take = (v: unknown) => { if (out[k] === null) out[k] = yesOf(v); };
      take(holder[k]); take((holder.scores as Record<string, unknown> | undefined)?.[k]);
      const ans = holder.answers;
      if (Array.isArray(ans)) take(ans.find((x) => x && (x as { id?: string }).id === k));
      else if (ans && typeof ans === 'object') take((ans as Record<string, unknown>)[k]);
    }
  }
  return out;
}

/**
 * A grade is binary: complete or reject. The grader's own complete or reject stands; any other grade completes when
 * spec_met > THRESHOLDS_v1.rejectSpecMax and cheat_shaped < THRESHOLDS_v1.cheatShapedMin, and rejects otherwise. The raw
 * verdict is kept beside the decision.
 */
export function binaryVerdict(g: { verdict?: string | null; hard_fail?: boolean | null; scores?: unknown; answers?: unknown; decision_id?: string | null } | null): Grade {
  const raw = g?.hard_fail === true ? 'hard_fail' : typeof g?.verdict === 'string' ? g.verdict : null;
  const { spec_met, cheat_shaped } = scoresOf(g);
  const base = { raw_verdict: raw, spec_met, cheat_shaped, decision_id: g?.decision_id ?? null, rule_id: BINARY_RULE_ID };
  if (raw === 'complete') return { ...base, decided: 'complete', by: 'grader', why: 'the grader decided complete' };
  if (raw === 'reject' || raw === 'hard_fail') return { ...base, decided: 'reject', by: 'grader', why: raw === 'hard_fail' ? 'a code check failed: the grader rejected before any score' : 'the grader decided reject' };
  const S = BINARY_THRESHOLDS.specMetAbove; const C = BINARY_THRESHOLDS.cheatShapedBelow;
  const pass = spec_met !== null && cheat_shaped !== null && spec_met > S && cheat_shaped < C;
  return { ...base, decided: pass ? 'complete' : 'reject', by: 'rule', why: `${raw ?? 'no verdict'} from the grader; complete needs spec_met > ${S} and cheat_shaped < ${C} (spec_met ${spec_met ?? 'missing'}, cheat_shaped ${cheat_shaped ?? 'missing'})` };
}

/** Where grades come from: a grading workflow of the Studio (its URL and token are the caller's, never shipped). */
export interface GradeEndpoint { url: string; token: string; fetch?: OnboardTransport['fetch'] }

/**
 * Grade a delivery: the Studio's grade workflow over the dispatched answer (`{ handshake_id }`), recorded on the devnet.
 * Returns the binary decision with the decision id the settle plan names.
 */
export async function grade(e: GradeEndpoint, a: { handshake_id: string }): Promise<Grade> {
  const f = e.fetch ?? ((u: string, i?: Parameters<OnboardTransport['fetch']>[1]) => fetch(u, i));
  const r = await f(e.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-grade-token': e.token }, body: JSON.stringify({ handshake_id: a.handshake_id, record: 'devnet' }) });
  const j = (await r.json().catch(() => null)) as { receipt?: { verdict?: string; forced?: string; scores?: unknown; answers?: unknown; decision?: { id?: string } }; decision?: { id?: string }; hard_fail?: boolean } | null;
  const rc = j?.receipt;
  if (!r.ok || !rc) throw new OnboardError(r.status, `the grade workflow answered ${r.status} with no receipt`, j);
  return binaryVerdict({ verdict: rc.verdict ?? null, hard_fail: j?.hard_fail === true || rc.forced === 'hard_fail', scores: rc.scores, answers: rc.answers, decision_id: j?.decision?.id ?? rc.decision?.id ?? null });
}

/** The recorded decision's digest (`GET /judge/decisions/:id`), which the evaluator posts with the verdict. */
export async function decisionDigest(t: OnboardTransport, decisionId: string): Promise<Hex> {
  const j = await get<{ decision?: { digest?: string }; digest?: string }>(t, `/judge/decisions/${encodeURIComponent(decisionId)}`);
  const d = j.decision?.digest ?? j.digest;
  if (!isHex32(d)) throw new OnboardError(502, 'the decision has no digest', j);
  return d;
}

/**
 * Settle: the evaluator's ending for a graded job, from the same ask (same job id) plus the binary decision. Returns the
 * evaluator's calls only; the hire, acceptance and delivery were sent before the grade.
 */
export async function settle(t: OnboardTransport, p: Pick<DevnetProfile, 'chainId'>, a: HireAsk, g: Grade & { digest: Hex }): Promise<{ plan: SettlePlan; settle: DevnetCall[] }> {
  if (!g.decision_id) throw new Error('settle needs the grade\'s recorded decision id');
  const plan = await settlePlan(t, p, a, { decided: g.decided, decision_id: g.decision_id, digest: g.digest });
  const want = g.decided === 'complete' ? 'post-complete' : 'post-reject';
  if (plan.ending !== want) throw new OnboardError(409, `the plan ends ${plan.ending}, not ${want}: nothing to send`, plan);
  return { plan, settle: phasesOf(plan, p.chainId).settle };
}

// ── 10. the edge at work: calls, meter lines, the agreement ─────────────────────────────────────────────────────────────

export interface MeterLine { id: string; edge_id: string; at: string; class: string; handshake_id: string | null; status: string; legs: Record<string, string>; unit: string }
export interface AgreementState { edge_id: string; enforced: boolean; signed: boolean; signature_valid: boolean; recovered: string | null; signer: string; seller_of_record: string; scope: { tenant: string; class: string; chain_id: number }; state: string; refusals?: number }

/** A layer op that is not routed yet answers 404 with no such operation: such a read is `pending`, not empty. */
const notRouted = (e: unknown) => e instanceof OnboardError && e.status === 404 && /no operation/i.test(e.message + JSON.stringify((e as { body?: unknown }).body ?? ''));

/**
 * One call through the edge: `POST /exchanges/:edge_id/call { class, task }`. The layer enforces the edge's agreement (a call
 * outside it is refused, `refused` names why) and writes one meter line per call it takes.
 */
export async function callEdge(t: OnboardTransport, edgeId: string, a: { task: string; class?: string; tool?: string | null; args?: Record<string, string> | null }): Promise<{ ok: true; line: MeterLine; reply_digest: string | null } | { ok: false; status: number; code: string; why: string; pending?: true }> {
  try {
    const { body } = await post<{ meter_line?: MeterLine; delivery?: { reply_digest?: string } }>(t, `/exchanges/${encodeURIComponent(edgeId)}/call`, { class: a.class ?? EDGE_CLASS, task: a.task, ...(a.tool ? { tool: a.tool, args: a.args ?? {} } : {}) });
    if (!body.meter_line) return { ok: false, status: 502, code: 'no_meter_line', why: 'the call answered with no meter line' };
    return { ok: true, line: body.meter_line, reply_digest: body.delivery?.reply_digest ?? null };
  } catch (e) {
    if (notRouted(e)) return { ok: false, status: 404, code: 'not_routed', why: 'the API does not route edge calls yet', pending: true };
    if (e instanceof OnboardError) return { ok: false, status: e.status, code: String(e.code ?? 'refused'), why: e.message };
    throw e;
  }
}

/** The edge's meter lines: `GET /exchanges/:edge_id/meter`. `pending` when the API does not route it yet. */
export async function meterLines(t: OnboardTransport, edgeId: string): Promise<{ lines: MeterLine[]; pending: boolean }> {
  try { const j = await get<{ lines?: MeterLine[] }>(t, `/exchanges/${encodeURIComponent(edgeId)}/meter`); return { lines: j.lines ?? [], pending: false }; }
  catch (e) { if (notRouted(e)) return { lines: [], pending: true }; throw e; }
}

/** The edge's agreement as the API enforces it: `GET /exchanges/:edge_id/agreement`. `pending` when not routed yet. */
export async function agreementState(t: OnboardTransport, edgeId: string): Promise<{ state: AgreementState | null; pending: boolean }> {
  try { const j = await get<{ agreement?: AgreementState }>(t, `/exchanges/${encodeURIComponent(edgeId)}/agreement`); return { state: j.agreement ?? null, pending: false }; }
  catch (e) { if (notRouted(e)) return { state: null, pending: true }; throw e; }
}

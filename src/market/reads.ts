/**
 * The market reads the coverage matrix found missing (_COORD_IO_COVERAGE_v1_, test/io): one plain function per coord route a
 * stage of a kept market reads or writes, over the same transport and door as the rest of ./market. Each sends only the
 * query parameters the route declares and answers the body as served, with its rows pulled out. Nothing here signs or pays.
 *
 *   LISTED   x402Bazaar · mcpRegistry · mcpServer · a2aRegistry · a2aAgent · virtualsSellers · olasMechs · mechDeployments
 *   BOUGHT   mechRequests · mechRequest · mechPlan (the unsigned approve + request calls of a devnet mech request)
 *   DELIVERED mechResult · chainTx (one transaction's decoded events)
 *   SETTLED  signerStatus (every sign purpose and its mode)
 *   PAID     reportSettled (an outside settler's report of the transaction it sent for a claimable envelope)
 */
import type { OnboardTransport } from '../onboard/index.js';
import { call, needKey, query, seg } from './http.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const rowsOf = (j: Obj, k: string): Obj[] => (Array.isArray(j[k]) ? (j[k] as unknown[]).filter(isObj) : []);
const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const chainOk = (c: number) => { if (!Number.isSafeInteger(c) || c <= 0) throw new RangeError('a chain is a positive chain id'); return c; };
const hex32 = (v: string, what: string) => { if (!HEX32.test(v)) throw new RangeError(`${what} is 0x + 64 hex`); return v; };

// ── listed: each market's own listing read ──────────────────────────────────────────────────────────────────────────────

/** The x402 Bazaar as Moonbeam reads it (`GET /x402/bazaar`): payable resources, their prices and readiness. Public. */
export async function x402Bazaar(t: OnboardTransport, o: { q?: string; limit?: number; offset?: number } = {}): Promise<{ rows: Obj[]; body: Obj }> {
  const j = await call<Obj>(t, 'GET', `/x402/bazaar${query({ q: o.q, limit: o.limit, offset: o.offset })}`);
  return { rows: rowsOf(j, 'rows'), body: j };
}
/** The official MCP Registry (`GET /mcp/registry`): servers, their open endpoint, a live probe and ERC-8004 cross-links. Public. */
export async function mcpRegistry(t: OnboardTransport, o: { q?: string; limit?: number } = {}): Promise<{ rows: Obj[]; body: Obj }> {
  const j = await call<Obj>(t, 'GET', `/mcp/registry${query({ q: o.q, limit: o.limit })}`);
  return { rows: rowsOf(j, 'rows'), body: j };
}
/** One MCP Registry server as a hirer needs it (`GET /mcp/registry/server?name=`). Public. */
export async function mcpServer(t: OnboardTransport, name: string): Promise<Obj> {
  if (!/^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/.test(name ?? '')) throw new RangeError(`not an MCP Registry server name: ${name}`);
  return call<Obj>(t, 'GET', `/mcp/registry/server${query({ name })}`);
}
/** The A2A Registry (`GET /a2a/registry`): agents, their card URL, dialect, health and ERC-8004 cross-links. Public. */
export async function a2aRegistry(t: OnboardTransport, o: { search?: string; limit?: number } = {}): Promise<{ rows: Obj[]; body: Obj }> {
  const j = await call<Obj>(t, 'GET', `/a2a/registry${query({ search: o.search, limit: o.limit })}`);
  return { rows: rowsOf(j, 'rows'), body: j };
}
/** One A2A Registry agent as a hirer needs it (`GET /a2a/registry/agent?id=`, the registry's UUID). Public. */
export async function a2aAgent(t: OnboardTransport, id: string): Promise<Obj> {
  if (!/^[0-9a-f-]{8,64}$/i.test(id ?? '')) throw new RangeError(`not an A2A Registry agent id: ${id}`);
  return call<Obj>(t, 'GET', `/a2a/registry/agent${query({ id })}`);
}
/** Virtuals sellers on chain and in Virtuals' own registries (`GET /virtuals/sellers`). Public. */
export async function virtualsSellers(t: OnboardTransport, o: { addr?: string } = {}): Promise<{ sellers: Obj[]; v3Sellers: Obj[]; body: Obj }> {
  const j = await call<Obj>(t, 'GET', `/virtuals/sellers${query({ addr: o.addr })}`);
  return { sellers: rowsOf(j, 'sellers'), v3Sellers: rowsOf(j, 'v3_sellers'), body: j };
}
/** The Olas Mech marketplace on every chain it runs on (`GET /olas/mechs`, `chain` one id or all). Public. */
export async function olasMechs(t: OnboardTransport, o: { chain?: number | 'all' } = {}): Promise<{ chains: Obj[]; body: Obj }> {
  const j = await call<Obj>(t, 'GET', `/olas/mechs${query({ chain: o.chain })}`);
  return { chains: rowsOf(j, 'chains'), body: j };
}
/** Moonbeam's own mech on the devnet (`GET /mech`): its deployments, prices and products. Public. */
export async function mechDeployments(t: OnboardTransport): Promise<{ deployments: Obj[]; products: Obj[]; body: Obj }> {
  const j = await call<Obj>(t, 'GET', '/mech');
  return { deployments: rowsOf(j, 'deployments'), products: rowsOf(j, 'products'), body: j };
}

// ── bought and delivered: the mech request ──────────────────────────────────────────────────────────────────────────────

/** Every request of the mech on one chain, newest first (`GET /mech/requests`). Public. */
export async function mechRequests(t: OnboardTransport, o: { chain: number; limit?: number; status?: string; requester?: string }): Promise<{ requests: Obj[]; totals: Obj | null; body: Obj }> {
  const j = await call<Obj>(t, 'GET', `/mech/requests${query({ chain: chainOk(o.chain), requester: o.requester, status: o.status, limit: o.limit })}`);
  return { requests: rowsOf(j, 'requests'), totals: isObj(j['totals']) ? j['totals'] : null, body: j };
}
/** One mech request: its state, task, events and result pointer (`GET /mech/requests/:chain/:requestId`). Public. */
export async function mechRequest(t: OnboardTransport, chainId: number, requestId: string): Promise<Obj> {
  return call<Obj>(t, 'GET', `/mech/requests/${seg(chainOk(chainId))}/${seg(hex32(requestId, 'a mech request id'))}`);
}
/** The result document a mech delivery points at (`GET /mech/results/:chain/:requestId`). Public. */
export async function mechResult(t: OnboardTransport, chainId: number, requestId: string): Promise<Obj> {
  return call<Obj>(t, 'GET', `/mech/results/${seg(chainOk(chainId))}/${seg(hex32(requestId, 'a mech request id'))}`);
}
/** The task document and the unsigned approve + request calls of one mech request (`POST /mech/plan`). Nothing signs. */
export async function mechPlan(t: OnboardTransport, o: { chainId?: number; task: { product: string } & Obj; requester?: string; record?: string; timeout?: number }): Promise<{ calls: Obj[]; requestId: string | null; body: Obj }> {
  if (!o?.task || typeof o.task.product !== 'string') throw new RangeError('a mech task names its product');
  const body: Obj = { ...(o.chainId !== undefined ? { chainId: chainOk(o.chainId) } : {}), task: o.task,
    ...(o.record !== undefined ? { record: o.record } : {}), ...(o.timeout !== undefined ? { timeout: o.timeout } : {}), ...(o.requester !== undefined ? { requester: o.requester } : {}) };
  const j = await call<Obj>(t, 'POST', '/mech/plan', body);
  return { calls: rowsOf(j, 'calls'), requestId: typeof j['request_id'] === 'string' ? j['request_id'] : null, body: j };
}

/** One transaction as Moonbeam reads it (`GET /chain/:chain/tx/:hash`): its status, block and every decoded event, args as served. */
export async function chainTx(t: OnboardTransport, chainId: number, tx: string): Promise<{ status: string | null; block: number | null; events: { name: string; args?: Obj }[]; body: Obj }> {
  const j = await call<Obj>(t, 'GET', `/chain/${seg(chainOk(chainId))}/tx/${seg(hex32(tx, 'a transaction hash'))}`);
  const row = isObj(j['tx']) ? j['tx'] : {};
  const events: { name: string; args?: Obj }[] = [];
  for (const e of rowsOf(row, 'events')) if (typeof e['event'] === 'string') events.push({ name: e['event'], ...(isObj(e['args']) ? { args: e['args'] } : {}) });
  return { status: typeof row['status'] === 'string' ? row['status'] : null, block: typeof row['block_number'] === 'number' ? row['block_number'] : null, events, body: j };
}

// ── settled and paid ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Every sign purpose with its mode, key and vault (`GET /sign/status`): whether a stage's signer is armed, in shadow, or absent. Public. */
export async function signerStatus(t: OnboardTransport): Promise<{ purposes: { id: string; mode: string; key: string; vault: string }[]; body: Obj }> {
  const j = await call<Obj>(t, 'GET', '/sign/status');
  const purposes = rowsOf(j, 'purposes').filter((p) => typeof p['id'] === 'string')
    .map((p) => ({ id: String(p['id']), mode: String(p['mode'] ?? ''), key: String(p['key'] ?? ''), vault: String(p['vault'] ?? '') }));
  return { purposes, body: j };
}
/** Report the transaction an outside settler sent for a claimable envelope (`POST /pipe/settled`). Nothing moves on the report. Keyed. */
export async function reportSettled(t: OnboardTransport, r: { id: string; chain: string | number; tx: string; by?: string }): Promise<{ outcome: string | null; body: Obj }> {
  needKey(t, 'POST /pipe/settled');
  const j = await call<Obj>(t, 'POST', '/pipe/settled', { id: hex32(r.id, 'an envelope id'), chain: String(r.chain), tx: hex32(r.tx, 'a transaction hash'), ...(r.by ? { by: r.by } : {}) });
  return { outcome: typeof j['outcome'] === 'string' ? j['outcome'] : null, body: j };
}

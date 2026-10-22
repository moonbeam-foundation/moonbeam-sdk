import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashTypedData, recoverTypedDataAddress } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import {
  devnetProfile, devnetLineOf, readNetworks, readRpc, withQuote, txLinkOf, transportFromEnv, DevnetProfileError, DEVNET_ENV,
  edgeIds, checkCode, checkTask, textTool, answerText, onboardCheck, sellerOfRow, endpointKey, agreementTyped, agreementHash, agreementId, edgeBody,
  findSellers, mcpTools, checkSeller, quoteEdge, termsOf, openPoolPlan, poolOpened, edgeAgreement, writeEdge, readEdge,
  faucetMintCalls, claimGas, fundPoolPlan, hire, deliver, phasesOf, signerOf, binaryVerdict, scoresOf, grade, decisionDigest, settle,
  callEdge, meterLines, agreementState, assertDevnet, BINARY_THRESHOLDS, MINT_SIGNATURE, DEVNET_JOB_PRICE,
} from '../src/devnet/index.js';
import type { DevnetProfile, Seller } from '../src/devnet/index.js';
import { selector, OnboardError } from '../src/onboard/index.js';
import type { OnboardTransport } from '../src/onboard/index.js';

// ── fixtures: synthetic addresses and a synthetic chain; nothing here names a deployed test network ──
const CHAIN = 999_001;
const A = (n: number) => (`0x${n.toString(16).padStart(40, '0')}`) as `0x${string}`;
const H32 = (b: string) => (`0x${b.repeat(64).slice(0, 64)}`) as `0x${string}`;
const HOOK = A(0x11), FACTORY = A(0x12), TOKEN = A(0x13), ADAPTER = A(0x14), POOL = A(0x15), SOR = A(0x16), BUYER = A(0x17), OWNER = A(0x18);
const NETWORKS = { ok: true, supported: [
  { chain_id: 8453, network: 'mainnet', line: 'v4', factory: A(0x21), hook: A(0x22), assets: [{ symbol: 'USDC', address: A(0x23), decimals: 6 }], status: 'phase0_deposits_blocked' },
  { chain_id: CHAIN, network: 'devnet', line: 'v4', factory: A(0x31), hook: A(0x32), assets: [{ symbol: 'dUSDC', address: A(0x33), decimals: 6 }], status: 'open' },
  { chain_id: CHAIN, network: 'devnet', line: 'v4-glmr', factory: FACTORY, hook: HOOK, assets: [{ symbol: 'dGLMR', address: TOKEN, decimals: 18 }], status: 'open' },
] };
const PROFILE: DevnetProfile = { chainId: CHAIN, rpc: 'https://rpc.example', faucet: 'https://faucet.example', txLink: 'https://scan.example/{chain}/{hash}', line: 'v4-glmr',
  token: { address: TOKEN, symbol: 'dGLMR', decimals: 18 }, contracts: { hook: HOOK, factory: FACTORY, token: TOKEN, adapter: ADAPTER },
  sources: { chainId: 'options', rpc: 'options', faucet: 'options', txLink: 'options', line: 'options', hook: 'options', factory: 'options', token: 'options', adapter: 'options' } };
const SELLER: Seller = { chain_id: 8453, agent_id: '58599', owner: OWNER, endpoint: 'https://agent.example/sellers/x/mcp', protocol: 'mcp', name: 'Example Sales Agent', skills: ['sales-help'], host: 'agent.example' };

type Route = unknown | ((body: unknown, url: string) => unknown);
/** a transport over canned answers keyed "METHOD /path" (query stripped unless the key has one); records every request */
function fake(routes: Record<string, Route>, status: Record<string, number> = {}) {
  const calls: { method: string; url: string; path: string; headers: Record<string, string>; body: unknown }[] = [];
  const t: OnboardTransport = {
    base: 'https://api.example/v1', apiKey: 'k_test',
    fetch: async (url, init) => {
      const path = url.replace('https://api.example/v1', '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, path, headers: init?.headers ?? {}, body });
      const key = `${method} ${path}` in routes ? `${method} ${path}` : `${method} ${path.split('?')[0]}`;
      const r = routes[key];
      const st = status[key] ?? (r === undefined ? 404 : 200);
      const j = typeof r === 'function' ? (r as (b: unknown, u: string) => unknown)(body, url) : r ?? { ok: false, code: 'not_found', error: `The coordination layer has no operation at /v1${path}.` };
      return { ok: st >= 200 && st < 300, status: st, json: async () => j };
    },
  };
  return { t, calls };
}

describe('devnet profile: no address or URL shipped; options, then env, then the API', () => {
  it('reads every contract from the registry, the RPC from the rotation, and names each source', async () => {
    const { t, calls } = fake({ 'GET /pools/networks': NETWORKS, [`GET /rpc/${CHAIN}`]: { ok: true, best: 'https://rpc.example' } });
    const p = await devnetProfile({ env: { [DEVNET_ENV.chainId]: String(CHAIN) } }, t);
    expect(p).toMatchObject({ chainId: CHAIN, rpc: 'https://rpc.example', line: 'v4-glmr', contracts: { hook: HOOK, factory: FACTORY, token: TOKEN, adapter: null }, token: { symbol: 'dGLMR', decimals: 18 } });
    expect(p.sources).toMatchObject({ chainId: 'env', rpc: 'layer', hook: 'layer', factory: 'layer', token: 'layer', line: 'layer', faucet: null });
    expect(calls.map((c) => c.path)).toEqual(['/pools/networks', `/rpc/${CHAIN}`]);
  });
  it('options win over env, env over the API; a complete profile reads nothing', async () => {
    const { t, calls } = fake({});
    const p = await devnetProfile({ chainId: CHAIN, rpc: 'https://a.example', line: 'v4-glmr', contracts: { hook: HOOK, factory: FACTORY, token: TOKEN },
      env: { [DEVNET_ENV.rpc]: 'https://b.example', [DEVNET_ENV.faucet]: 'https://f.example', [DEVNET_ENV.adapter]: ADAPTER } }, t);
    expect(p.rpc).toBe('https://a.example'); expect(p.faucet).toBe('https://f.example'); expect(p.contracts.adapter).toBe(ADAPTER);
    expect(p.sources).toMatchObject({ rpc: 'options', faucet: 'env', adapter: 'env', hook: 'options' });
    expect(calls).toHaveLength(0);
  });
  it('throws naming every missing field when no source supplies it', async () => {
    await expect(devnetProfile({ env: {} })).rejects.toThrow(DevnetProfileError);
    const e = (await devnetProfile({ env: {} }).catch((x: unknown) => x)) as DevnetProfileError;
    expect(e.missing.join(' ')).toMatch(/chainId.*rpc.*hook.*factory.*token.*line/);
  });
  it('picks the devnet GLMR line only (never a mainnet or a dUSDC row)', () => {
    expect(devnetLineOf(NETWORKS.supported)?.line).toBe('v4-glmr');
    expect(devnetLineOf(NETWORKS.supported, { chainId: 8453 })).toBeNull();
    expect(devnetLineOf([NETWORKS.supported[1]!])).toBeNull();
  });
  it('readNetworks throws the refusal; readRpc gives null on a bad answer', async () => {
    const { t } = fake({ 'GET /pools/networks': { ok: false, code: 'down', error: 'down' } }, { 'GET /pools/networks': 503 });
    await expect(readNetworks(t)).rejects.toBeInstanceOf(OnboardError);
    const f2 = fake({ [`GET /rpc/${CHAIN}`]: { best: 'not a url' } });
    expect(await readRpc(f2.t, CHAIN)).toBeNull();
  });
  it('withQuote takes the evaluator adapter a quote names; txLinkOf and transportFromEnv', () => {
    const p0 = { ...PROFILE, contracts: { ...PROFILE.contracts, adapter: null }, sources: { ...PROFILE.sources, adapter: null } };
    expect(withQuote(p0, { line: { evaluator_adapter: ADAPTER } }).contracts.adapter).toBe(ADAPTER);
    expect(withQuote(PROFILE, { line: { evaluator_adapter: A(0x99) } }).contracts.adapter).toBe(ADAPTER);
    expect(txLinkOf(PROFILE, '0xabc')).toBe(`https://scan.example/${CHAIN}/0xabc`);
    expect(txLinkOf({ ...PROFILE, txLink: null }, '0xabc')).toBeNull();
    expect(transportFromEnv({ MOONBEAM_API: 'https://api.example/v1/', MOONBEAM_API_KEY: 'k' })).toMatchObject({ base: 'https://api.example/v1', apiKey: 'k' });
    expect(() => transportFromEnv({})).toThrow(/MOONBEAM_API/);
  });
});

describe('edge ids, check and agreement (pure)', () => {
  it('derives the same ids as the API: sha256(tenant|chain|seller chain:agent)[:16]', async () => {
    const ids = await edgeIds({ chainId: CHAIN, seller: SELLER });
    const e16 = createHash('sha256').update(`moonbeam|${CHAIN}|8453:58599`).digest('hex').slice(0, 16);
    expect(ids).toEqual({ edge16: e16, edge_id: `edge_${e16}`, exchange_id: `exchange:wire.reply.${e16}`, lambda: `lambda:exchange-moonbeam-${e16}`, meter_row: `meter:exchange-moonbeam-${e16}` });
    // a vector the API stored on 2026-10-22: seller 8453:58599 on the devnet
    expect((await edgeIds({ chainId: 36927, seller: SELLER })).edge_id).toBe('edge_3ee45c35c88f1081');
  });
  it('check code and task', async () => {
    const code = await checkCode('ab12', 'run_1');
    expect(code).toMatch(/^MB-[0-9A-F]{8}$/);
    expect(code).toBe(`MB-${createHash('sha256').update('ab12|run_1').digest('hex').slice(0, 8).toUpperCase()}`);
    expect(checkTask(SELLER, code)).toContain(`exact code ${code}`);
    expect(checkTask({ skills: [] }, code)).toContain('your main skill');
  });
  it('textTool picks a tool that takes words, never echo or a multi-input tool', () => {
    expect(textTool([{ name: 'echo', properties: { text: { type: 'string' } } }, { name: 'ask_sales_agent', required: ['question'], properties: { question: { type: 'string' } } }], 'T')).toEqual({ name: 'ask_sales_agent', args: { question: 'T' } });
    expect(textTool([{ name: 'chat', required: ['a', 'b'] }, { name: 'get_quote', properties: { x: { type: 'string' } } }], 'T')).toBeNull();
    expect(textTool([{ name: 'query', properties: { n: { type: 'number' } } }], 'T')).toBeNull();
  });
  it('answerText reads A2A parts and MCP content; onboardCheck holds the rule', () => {
    expect(answerText(JSON.stringify({ result: { content: [{ type: 'text', text: 'hello' }] } }))).toBe('hello');
    expect(answerText('plain')).toBe('plain');
    const task = checkTask(SELLER, 'MB-ABCDEF12');
    const d = (head: string, o: object = {}) => ({ status: 'ready', reply_head: head, reply_digest: H32('a'), content_check: { ok: true, rule: 'generic@1' }, ...o });
    expect(onboardCheck(d('MB-ABCDEF12 We sell help: for example a sales plan of three steps with prices and a timeline.'), { code: 'MB-ABCDEF12', task })).toMatchObject({ ok: true, rules: ['generic@1', 'onboard.task-answer@1'] });
    expect(onboardCheck(d('pong'), { code: 'MB-ABCDEF12', task }).why).toMatch(/liveness/);
    expect(onboardCheck(d(task), { code: 'MB-ABCDEF12', task }).why).toMatch(/sends the task back/);
    expect(onboardCheck(d('MB-ABCDEF12'), { code: 'MB-ABCDEF12', task }).why).toMatch(/code alone/);
    expect(onboardCheck(d('x', { status: 'timeout' }), { code: 'MB-ABCDEF12', task }).ok).toBe(false);
    expect(onboardCheck(d('x', { x402: {} }), { code: 'MB-ABCDEF12', task }).why).toMatch(/payment/);
    expect(onboardCheck(d('x', { content_check: { ok: false, why: 'empty' } }), { code: 'MB-ABCDEF12', task }).why).toMatch(/floor: empty/);
    expect(onboardCheck(null, { code: 'MB-ABCDEF12', task }).ok).toBe(false);
  });
  it('sellerOfRow and endpointKey', () => {
    expect(sellerOfRow({ chain_id: 8453, agent_id: 7, owner: OWNER, endpoint: 'https://x.example/a2a', kind: 'a2a' })).toMatchObject({ ok: true, seller: { protocol: 'a2a', host: 'x.example', agent_id: '7' } });
    expect(sellerOfRow({ chain_id: 8453, agent_id: 7, owner: OWNER, endpoint: 'http://x.example', kind: 'a2a' }).ok).toBe(false);
    expect(sellerOfRow({ chain_id: 8453, agent_id: 7, owner: OWNER, endpoint: 'https://x.example', kind: 'x402' }).ok).toBe(false);
    expect(endpointKey('https://X.example/A/')).toBe('x.example/a');
  });
  it('the agreement hash is the EIP-712 hash, byte for byte, and a signature recovers the seller of record', async () => {
    const acct = mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex: 7 });
    const typed = agreementTyped({ chainId: CHAIN, edgeId: 'edge_0123456789abcdef', sellerOfRecord: acct.address, seller: SELLER });
    const h = agreementHash(typed);
    expect(h).toBe(hashTypedData(typed as never));
    expect(agreementId(h)).toBe(`agr_${h.slice(2, 18)}`);
    const sig = await acct.signTypedData(typed as never);
    expect(await recoverTypedDataAddress({ ...(typed as unknown as Parameters<typeof hashTypedData>[0]), signature: sig })).toBe(acct.address);
    expect(edgeAgreement(PROFILE, { edgeId: 'edge_0123456789abcdef', sellerOfRecord: acct.address, seller: SELLER }).hash).toBe(agreementHash({ ...typed, domain: { ...typed.domain, chainId: CHAIN } }));
    expect(() => agreementTyped({ chainId: CHAIN, edgeId: 'e', sellerOfRecord: '0x1' as never, seller: SELLER })).toThrow();
  });
  it('edgeBody is the body the API stores (live by default; signer is the seller of record)', () => {
    const b = edgeBody({ chainId: CHAIN, seller: SELLER, sellerOfRecord: SOR, check: { handshake_id: 'hs_1', status: 'ready', reply_digest: H32('a'), passed: true, rules: ['generic@1'] },
      quote: { line: 'l', token: 'dGLMR', price: '1', deposit: '2', premium: null, pool_id: null }, pool: { line: 'v4-glmr', factory: FACTORY, address: POOL, tx: H32('b'), state: 'open' }, agreement: { hash: H32('c'), signature: null } });
    expect(b).toMatchObject({ tenant: 'moonbeam', class: 'wire.reply', state: 'live', agreement: { docs: ['TSUL-1.1', 'TAT'], signer: SOR, how: 'eip712' } });
    expect(Object.keys(b.seller)).toEqual(['chain_id', 'agent_id', 'owner', 'endpoint', 'protocol']);
  });
});

describe('find and check', () => {
  it('findSellers pages the worklist, folds rows, skips onboarded edges and repeats of an endpoint', async () => {
    const ids = await edgeIds({ chainId: CHAIN, seller: { chain_id: 1, agent_id: '1' } });
    const { t, calls } = fake({
      'GET /onboard/worklist?stage=first-job&limit=200&offset=0': { rows: [{ chain_id: 1, agent_id: 1, owner: OWNER, endpoint: 'https://a.example/x', kind: 'a2a' }], next_offset: 1 },
      'GET /onboard/worklist?stage=first-job&limit=200&offset=1': { rows: [{ chain_id: 1, agent_id: 2, owner: OWNER, endpoint: 'https://b.example/x', kind: 'mcp' }, { chain_id: 1, agent_id: 3, owner: OWNER, endpoint: 'https://b.example/x', kind: 'mcp' }], next_offset: null },
      'GET /onboard/worklist?stage=list&limit=200&offset=0': { rows: [{ chain_id: 1, agent_id: 4, owner: 'nope', endpoint: 'https://c.example', kind: 'a2a' }] },
    });
    const r = await findSellers(t, PROFILE, { skip: new Set([ids.edge_id]) });
    expect(r.read).toBe(4);
    expect(r.sellers.map((s) => s.agent_id)).toEqual(['2']);
    expect(r.skipped.map((s) => s.why)).toEqual(['already onboarded', 'its endpoint is already in this pick', 'no owner address on record']);
    expect(calls).toHaveLength(3);
  });
  it('mcpTools reads tools/list after initialize (SSE or JSON), null on failure', async () => {
    const seen: string[] = [];
    const f = async (_u: string, i: { body: string; headers: Record<string, string> }) => {
      const m = JSON.parse(i.body).method; seen.push(`${m}:${i.headers['mcp-session-id'] ?? '-'}`);
      const text = m === 'initialize' ? 'data: {"result":{}}' : JSON.stringify({ result: { tools: [{ name: 'ask', inputSchema: { required: ['q'], properties: { q: { type: 'string' } } } }] } });
      return { text: async () => text, headers: { get: (n: string) => (n === 'mcp-session-id' ? 's1' : null) } };
    };
    expect(await mcpTools(f, 'https://x.example/mcp')).toEqual([{ name: 'ask', description: null, required: ['q'], properties: { q: { type: 'string' } } }]);
    expect(seen).toEqual(['initialize:-', 'tools/list:s1']);
    expect(await mcpTools(async () => { throw new Error('down'); }, 'https://x.example/mcp')).toBeNull();
  });
  it('checkSeller dispatches the task (with the MCP tool) and holds the answer to the rule', async () => {
    let sent: { task?: string; tool?: string; args?: Record<string, string> } = {};
    const { t } = fake({ 'POST /handshake': (b: unknown) => {
      sent = b as typeof sent; const code = /exact code (MB-[0-9A-F]{8})/.exec(sent.task!)![1];
      return { handshake_id: 'hs_9', delivery: { status: 'ready', reply_head: `${code} We do sales help, for example a three step plan with a price list and dates.`, reply_digest: H32('d'), content_check: { ok: true, rule: 'generic@1' }, tool: 'ask' } };
    } });
    const c = await checkSeller(t, SELLER, { chainId: CHAIN, run: 'r1', tools: [{ name: 'ask', required: ['q'], properties: { q: { type: 'string' } } }] });
    expect(c).toMatchObject({ passed: true, handshake_id: 'hs_9', reply_digest: H32('d'), tool: 'ask', args: { q: sent.task } });
    expect(sent.tool).toBe('ask');
    expect((await checkSeller(t, SELLER, { chainId: CHAIN, run: 'r1', tools: [{ name: 'get_quote' }] })).why).toMatch(/no MCP tool/);
    expect((await checkSeller(t, SELLER, { chainId: CHAIN, run: 'r1', tools: null })).why).toMatch(/could not be read/);
    const refused = fake({ 'POST /handshake': { ok: false, code: 'rate', error: 'slow down' } }, { 'POST /handshake': 429 });
    expect((await checkSeller(refused.t, { ...SELLER, protocol: 'a2a' }, { chainId: CHAIN, run: 'r1' })).why).toMatch(/refused/);
  });
});

const QUOTE = { ok: true, line: { key: `${CHAIN}:moonbeam`, hook: HOOK, factory: FACTORY, token: TOKEN, evaluator_adapter: ADAPTER }, token: { symbol: 'dGLMR', address: TOKEN }, price: '1000000000000000000', deposit: '2000000000000000000', premium: null, pool_id: null,
  pool: { vault: POOL, free: '10000000000000000000', total: '10000000000000000000', encumbered: '0' }, why: ['thin record'] };

describe('quote, pool and edge', () => {
  it('quoteEdge asks POST /pools/quote for the tenant line and folds the terms', async () => {
    const { t, calls } = fake({ 'POST /pools/quote': QUOTE });
    const q = await quoteEdge(t, PROFILE, { sellerOfRecord: SOR });
    expect(calls[0]!.body).toEqual({ seller: SOR, price: DEVNET_JOB_PRICE.toString(), chainId: CHAIN, tenant: 'moonbeam', via: 'us' });
    expect(q.quote).toEqual({ line: `${CHAIN}:moonbeam`, token: 'dGLMR', price: '1000000000000000000', deposit: '2000000000000000000', premium: null, pool_id: null });
    expect(q.pool).toEqual({ vault: POOL, total: 10n ** 19n, free: 10n ** 19n });
    expect(() => termsOf({ ok: false })).toThrow(OnboardError);
  });
  it('openPoolPlan returns the simulated createPool for the seller of record, or the pool that exists', async () => {
    const plan = fake({ 'POST /pools/open': { ok: true, state: 'plan', factory: FACTORY, expected_pool: { address: POOL }, tx: { to: FACTORY, data: '0xabcdef' }, simulation: { ok: true } } });
    const p = await openPoolPlan(plan.t, PROFILE, { sellerOfRecord: SOR, edge16: 'ab' });
    expect(plan.calls[0]!.body).toMatchObject({ chain_id: CHAIN, seller: SOR, line: 'v4-glmr', from: SOR, symbol: 'mbCOVER' });
    expect(p).toMatchObject({ state: 'plan', pool: POOL, call: { chainId: CHAIN, to: FACTORY, data: '0xabcdef', signer: 'seller', step: 'createPool' } });
    const ex = fake({ 'POST /pools/open': { ok: true, state: 'exists', factory: FACTORY, pool: { address: POOL } } });
    expect(await openPoolPlan(ex.t, PROFILE, { sellerOfRecord: SOR, edge16: 'ab' })).toEqual({ state: 'exists', factory: FACTORY, pool: POOL, call: null });
    const bad = fake({ 'POST /pools/open': { ok: true, state: 'plan', factory: FACTORY, tx: { to: FACTORY, data: '0x' }, simulation: { ok: false } } });
    await expect(openPoolPlan(bad.t, PROFILE, { sellerOfRecord: SOR, edge16: 'ab' })).rejects.toThrow(/no simulated/);
  });
  it('poolOpened reads the pool back from the API', async () => {
    const { t, calls } = fake({ [`GET /pools/open/${CHAIN}/${H32('e')}`]: { state: 'created', pool: { address: POOL } } });
    expect(await poolOpened(t, PROFILE, H32('e'))).toEqual({ state: 'created', pool: POOL, retryAfter: null });
    expect(calls[0]!.path).toBe(`/pools/open/${CHAIN}/${H32('e')}`);
  });
  it('writeEdge and readEdge go through /exchanges', async () => {
    const row = { edge_id: 'edge_1', lambda: { acts: [] } };
    const { t, calls } = fake({ 'POST /exchanges/edge': { ok: true, created: true, exchange: row }, 'GET /exchanges?id=edge_1': { rows: [row] } });
    expect(await writeEdge(t, { tenant: 'moonbeam' } as never)).toEqual({ created: true, exchange: row });
    expect(await readEdge(t, 'edge_1')).toEqual(row);
    expect(calls[0]!.headers['x-api-key']).toBe('k_test');
    const none = fake({ 'POST /exchanges/edge': { ok: true } });
    await expect(writeEdge(none.t, {} as never)).rejects.toThrow(/no record/);
  });
});

describe('funding the pool', () => {
  it('faucetMintCalls builds mint(to, amount) on the profile token', () => {
    const [c] = faucetMintCalls(PROFILE, { to: SOR, amount: 5n });
    expect(c).toMatchObject({ chainId: CHAIN, to: TOKEN, step: 'faucet-mint', signer: 'anyone' });
    expect(c!.data).toBe(selector(MINT_SIGNATURE) + SOR.slice(2).padStart(64, '0') + (5n).toString(16).padStart(64, '0'));
    expect(selector(MINT_SIGNATURE)).toBe('0x40c10f19');
    expect(() => faucetMintCalls(PROFILE, { to: SOR, amount: 0n })).toThrow();
  });
  it('claimGas posts to the profile faucet, and says so when there is none', async () => {
    let hit = '';
    const f: OnboardTransport['fetch'] = async (u, i) => { hit = `${u} ${i?.body}`; return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
    expect((await claimGas(PROFILE, SOR, f)).ok).toBe(true);
    expect(hit).toBe(`https://faucet.example/claim {"address":"${SOR}"}`);
    expect((await claimGas({ faucet: null }, SOR, f)).ok).toBe(false);
  });
  it('fundPoolPlan takes the API plan (POST /pools/vault), else builds the deposit itself', async () => {
    const { t, calls } = fake({ 'POST /pools/vault': { txs: [{ step: 'approve', to: TOKEN, data: '0x01' }, { step: 'deposit', to: POOL, data: '0x02' }], short: null } });
    const r = await fundPoolPlan(t, PROFILE, { pool: POOL, from: BUYER, assets: 10n });
    expect(calls[0]!.body).toEqual({ chain_id: CHAIN, pool: POOL, action: 'deposit', from: BUYER, assets: '10' });
    expect(r.source).toBe('layer'); expect(r.calls.map((c) => [c.step, c.to])).toEqual([['approve', TOKEN], ['deposit', POOL]]);
    const off = fake({});
    const s = await fundPoolPlan(off.t, PROFILE, { pool: POOL, from: BUYER, assets: 10n });
    expect(s.source).toBe('sdk'); expect(s.calls.map((c) => c.step)).toEqual(['approve', 'deposit']); expect(s.calls[1]!.to).toBe(POOL);
    const refused = fake({ 'POST /pools/vault': { ok: false, code: 'line_closed', error: 'closed' } }, { 'POST /pools/vault': 409 });
    await expect(fundPoolPlan(refused.t, PROFILE, { pool: POOL, from: BUYER, assets: 10n })).rejects.toThrow(OnboardError);
  });
  it('assertDevnet refuses any other chain', () => {
    expect(() => assertDevnet(PROFILE, 8453)).toThrow(/refused/);
    expect(() => assertDevnet({ chainId: 8453 })).toThrow(/has value/);
    expect(() => faucetMintCalls({ ...PROFILE, chainId: 8453 }, { to: SOR, amount: 1n })).toThrow(/has value/);
    expect(() => assertDevnet(PROFILE, CHAIN)).not.toThrow();
  });
});

const JOB = H32('f');
const PLAN_CALLS = [
  { action: 'approve', signer: 'the buyer', to: TOKEN, data: '0x01' }, { action: 'openJobWithSpec', signer: 'the buyer', to: HOOK, data: '0x02' },
  { action: 'approve-deposit', signer: 'the seller', to: TOKEN, data: '0x03' }, { action: 'accept', signer: 'the seller', to: HOOK, data: '0x04' },
  { action: 'submitWithDelivery', signer: 'the seller', to: HOOK, data: '0x05' },
];
const ASK = { buyer: BUYER, sellerOfRecord: SOR, evidence: H32('a'), refId: 'hs_9', task: 'T', deadline: 2_000_000_000 };

describe('hire, deliver, grade, settle', () => {
  it('hire plans the job with no verdict and splits its calls by who signs', async () => {
    const { t, calls } = fake({ 'POST /settle': { ok: true, jobId: JOB, ending: 'held', hook: HOOK, adapter: ADAPTER, token: TOKEN, deposit: '2', price: '1', deadline: 2_000_000_000, calls: PLAN_CALLS } });
    const h = await hire(t, PROFILE, ASK);
    expect(calls[0]!.body).toMatchObject({ via: 'us', tenant: 'moonbeam', chainId: CHAIN, buyer: BUYER, seller: SOR, evidence: H32('a'), ref: { id: 'hs_9' }, deadline: 2_000_000_000, pool: null });
    expect(calls[0]!.body).not.toHaveProperty('verdict');
    expect(h.hire.map((c) => c.step)).toEqual(['approve', 'openJobWithSpec']);
    expect(h.accept.map((c) => [c.step, c.signer])).toEqual([['approve-deposit', 'seller'], ['accept', 'seller']]);
    expect(deliver(h).map((c) => c.step)).toEqual(['submitWithDelivery']);
    expect(() => phasesOf({ calls: [{ action: 'x', signer: 'someone', to: HOOK, data: '0x' }] }, CHAIN)).toThrow(/no signer/);
    expect([signerOf('the buyer'), signerOf('seller'), signerOf('The evaluator (our adapter)'), signerOf('anyone')]).toEqual(['buyer', 'seller', 'evaluator', null]);
    await expect(hire(t, { chainId: 8453 } as never, ASK)).rejects.toThrow(/has value/);
  });
  it('binaryVerdict: the grader decides, else its own thresholds; never a third state', () => {
    expect(BINARY_THRESHOLDS).toEqual({ specMetAbove: 0.4, cheatShapedBelow: 0.5 });
    expect(binaryVerdict({ verdict: 'complete' })).toMatchObject({ decided: 'complete', by: 'grader' });
    expect(binaryVerdict({ verdict: 'reject' })).toMatchObject({ decided: 'reject', by: 'grader' });
    expect(binaryVerdict({ verdict: 'complete', hard_fail: true })).toMatchObject({ decided: 'reject', raw_verdict: 'hard_fail' });
    expect(binaryVerdict({ verdict: 'needs_review', scores: { spec_met: 0.91, cheat_shaped: 0.05 } })).toMatchObject({ decided: 'complete', by: 'rule', raw_verdict: 'needs_review' });
    expect(binaryVerdict({ verdict: 'needs_review', scores: { spec_met: 0.4, cheat_shaped: 0.05 } }).decided).toBe('reject');
    expect(binaryVerdict({ verdict: 'needs_review', answers: [{ id: 'spec_met', probabilities: { yes: 0.9 } }, { id: 'cheat_shaped', value: 'no', confidence: 0.8 }] })).toMatchObject({ decided: 'complete', spec_met: 0.9 });
    expect(binaryVerdict({ verdict: 'needs_review' }).decided).toBe('reject');
    expect(binaryVerdict(null).decided).toBe('reject');
    expect(scoresOf({ receipt: { scores: { spec_met: 0.5 } } })).toEqual({ spec_met: 0.5, cheat_shaped: null });
  });
  it('grade posts the handshake to the grade workflow and returns the binary decision', async () => {
    let req: { url: string; headers: Record<string, string>; body: string } | null = null;
    const f: OnboardTransport['fetch'] = async (url, i) => { req = { url, headers: i!.headers!, body: i!.body! }; return { ok: true, status: 200, json: async () => ({ receipt: { verdict: 'needs_review', scores: { spec_met: 0.91, cheat_shaped: 0.05 } }, decision: { id: 'decision-1' } }) }; };
    const g = await grade({ url: 'https://grade.example/hook', token: 'tok', fetch: f }, { handshake_id: 'hs_9' });
    expect(g).toMatchObject({ decided: 'complete', decision_id: 'decision-1', raw_verdict: 'needs_review' });
    expect(req!.headers['x-studio-grade-token']).toBe('tok');
    expect(JSON.parse(req!.body)).toEqual({ handshake_id: 'hs_9', record: 'devnet' });
    const bad: OnboardTransport['fetch'] = async () => ({ ok: false, status: 403, json: async () => ({ error: 'no' }) });
    await expect(grade({ url: 'https://grade.example/hook', token: 'x', fetch: bad }, { handshake_id: 'hs_9' })).rejects.toBeInstanceOf(OnboardError);
  });
  it('decisionDigest reads the recorded decision', async () => {
    const { t } = fake({ 'GET /judge/decisions/decision-1': { decision: { digest: H32('9') } } });
    expect(await decisionDigest(t, 'decision-1')).toBe(H32('9'));
    const none = fake({ 'GET /judge/decisions/decision-1': { decision: {} } });
    await expect(decisionDigest(none.t, 'decision-1')).rejects.toThrow(/no digest/);
  });
  it('settle asks the same job with the decision and returns the evaluator calls only', async () => {
    const ending = (b: { verdict?: string }) => ({ ok: true, jobId: JOB, ending: b.verdict === 'complete' ? 'post-complete' : 'post-reject', hook: HOOK, adapter: ADAPTER, token: TOKEN, deposit: '2', price: '1', deadline: 2_000_000_000,
      calls: [...PLAN_CALLS, { action: 'post-verdict', signer: 'the evaluator', to: ADAPTER, data: '0x06' }] });
    const { t, calls } = fake({ 'POST /settle': ending });
    const g = { ...binaryVerdict({ verdict: 'complete', decision_id: 'decision-1' }), digest: H32('9') };
    const s = await settle(t, PROFILE, ASK, g);
    expect(calls[0]!.body).toMatchObject({ verdict: 'complete', decision_id: 'decision-1', decision_digest: H32('9'), ref: { id: 'hs_9' } });
    expect(s.settle).toEqual([{ chainId: CHAIN, to: ADAPTER, data: '0x06', value: '0x0', step: 'post-verdict', signer: 'evaluator', effect: 'post-verdict' }]);
    const held = fake({ 'POST /settle': { ...ending({ verdict: 'complete' }), ending: 'held' } });
    await expect(settle(held.t, PROFILE, ASK, g)).rejects.toThrow(/held, not post-complete/);
    await expect(settle(t, PROFILE, ASK, { ...g, decision_id: null })).rejects.toThrow(/decision id/);
  });
});

describe('the edge at work: calls, meter lines, agreement', () => {
  const LINE = { id: 'meter:exchange-moonbeam-ab:1', edge_id: 'edge_ab', at: '2026-10-22T00:00:00Z', class: 'wire.reply', handshake_id: 'hs_1', status: 'ready', unit: 'dGLMR', legs: { seller_share: '1', our_fee: '0', reseller_markup: '0' } };
  it('callEdge sends class and task (and an MCP tool) and returns the meter line', async () => {
    const { t, calls } = fake({ 'POST /exchanges/edge_ab/call': { ok: true, meter_line: LINE, delivery: { reply_digest: H32('a') } } });
    expect(await callEdge(t, 'edge_ab', { task: 'T', tool: 'ask', args: { q: 'T' } })).toEqual({ ok: true, line: LINE, reply_digest: H32('a') });
    expect(calls[0]!.body).toEqual({ class: 'wire.reply', task: 'T', tool: 'ask', args: { q: 'T' } });
  });
  it('a call outside the agreement comes back refused, with the code; an unrouted op is pending', async () => {
    const out = fake({ 'POST /exchanges/edge_ab/call': { ok: false, code: 'outside_agreement', error: 'class market.price is outside this edge’s agreement' } }, { 'POST /exchanges/edge_ab/call': 403 });
    expect(await callEdge(out.t, 'edge_ab', { task: 'T', class: 'market.price' })).toMatchObject({ ok: false, status: 403, code: 'outside_agreement' });
    const pend = fake({});
    expect(await callEdge(pend.t, 'edge_ab', { task: 'T' })).toMatchObject({ ok: false, status: 404, code: 'not_routed', pending: true });
    const empty = fake({ 'POST /exchanges/edge_ab/call': { ok: true } });
    expect(await callEdge(empty.t, 'edge_ab', { task: 'T' })).toMatchObject({ ok: false, code: 'no_meter_line' });
  });
  it('meterLines and agreementState read the edge, or say pending', async () => {
    const AG = { edge_id: 'edge_ab', enforced: true, signed: true, signature_valid: true, recovered: SOR, signer: SOR, seller_of_record: SOR, scope: { tenant: 'moonbeam', class: 'wire.reply', chain_id: CHAIN }, state: 'live', refusals: 1 };
    const { t } = fake({ 'GET /exchanges/edge_ab/meter': { ok: true, lines: [LINE] }, 'GET /exchanges/edge_ab/agreement': { ok: true, agreement: AG } });
    expect(await meterLines(t, 'edge_ab')).toEqual({ lines: [LINE], pending: false });
    expect(await agreementState(t, 'edge_ab')).toEqual({ state: AG, pending: false });
    const pend = fake({});
    expect(await meterLines(pend.t, 'edge_ab')).toEqual({ lines: [], pending: true });
    expect(await agreementState(pend.t, 'edge_ab')).toEqual({ state: null, pending: true });
    const missing = fake({ 'GET /exchanges/edge_zz/meter': { ok: false, code: 'edge_not_found', error: 'no such edge' } }, { 'GET /exchanges/edge_zz/meter': 404 });
    await expect(meterLines(missing.t, 'edge_zz')).rejects.toBeInstanceOf(OnboardError);
  });
});

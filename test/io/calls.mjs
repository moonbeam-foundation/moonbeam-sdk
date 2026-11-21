// _COORD_IO_COVERAGE_v1_: the SDK call behind every fixture, shared by the recorder (scripts/io-record.mjs, over dist/) and the
// replay test (test/io/replay.test.ts, over src/). A call names the SDK function that makes or consumes the coord request, the
// inputs it is called with, the coord answer a contract fixture carries (only fields coord's CUE declares: io-coverage.mjs checks
// them), and what the SDK must make of the answer. `s` is the SDK's modules merged; `x` is { market, stage, op, fx, fixtures }.

export const AGENT = '8453:1170141';
export const DEVNET = 36927;
export const REQUESTER = 'moonbeam-playground';
/** the devnet ledger's job 1 (delivered and completed through the judge adapter): test/fixtures/economy */
export const DEVNET_JOB = '0xa6d6f649a7b8d06168f30af1078115e86b2bf9dd8b495a448ba11ceef3d1168a';
export const LEDGER_TX = {
  bought: '0xd2ee48b70a006828063144be635327d24df14231d70df1ca54e264d70af01bfd',
  settled: '0x79d3221cbd512ab749867800e339415f12991642a895212d0e3989d852d7517e',
  /** the job's submit (delivery) transaction, as its settle record names it (each market's delivered/read-settle-id.json) */
  delivered: '0xb13879351ac7c61d293a780de5bcab0993bd7385e6f2b42cc4705ed7f83748e7',
};
/** a devnet JudgeAdapter the devnet.evaluate purpose may call (coord lang/gen/sign.json purposes.devnet.evaluate.devnet.calls) */
export const DEVNET_ADAPTER = '0x8474c7b165243e49a44a86b6f303c58924778928';
const H = (b) => `0x${b.repeat(64 / b.length)}`;
const A = (b) => `0x${b.repeat(40 / b.length)}`;
export const SELLER = '0x00000000000000000000000000000000000000b2';

/** the market ids GET /venues/:id names */
const VENUE_MARKET = { 'x402-base': 'x402', 'erc8183-base': 'erc8183' };
/** the list step's market for each discovery market */
const LIST_MARKET = { mcp: 'mcp_registry', a2a: 'a2a_registry', erc8004: 'erc8004' };
/** the protocol a hire hands the task over in, per market (NEAR hires over A2A) */
const HIRE_KIND = { 'x402-base': 'x402', mcp: 'mcp', a2a: 'a2a', 'near-agent-market': 'a2a' };

/** the playground plan of the devnet job, its id the ledger's job, and its steps as the settle record names their transactions */
export function devnetRun(s, market, txs) {
  const quote = { price: 1_000_000n, premium: 111_750n, toBackers: 94_803n, protocolFee: 16_947n, deposit: 1_111_750n, compensation: 111_750n, evaluatorFee: 10_000n, coverCap: 1_000_000n };
  const pg = s.playground({ net: 'devnet', placement: { chainId: DEVNET, hook: s.toChecksum(A('a1')), token: s.toChecksum(A('a4')), judgeAdapter: s.toChecksum(DEVNET_ADAPTER), pool: s.toChecksum(A('a3')), vault: s.toChecksum(A('a5')) } });
  const plan0 = pg.plan('delivered-accepted', { market, quote, salt: H('33'), parties: { buyer: s.toChecksum(A('b1')), seller: s.toChecksum(SELLER), backer: s.toChecksum(A('b3')) }, deadline: 1_800_000_660 });
  const plan = { ...plan0, jobId: DEVNET_JOB };
  const txOf = (re) => (txs ?? []).find((x) => re.test(String(x.role ?? '')))?.hash ?? null;
  const byFn = { openJobWithEconomy: /^open/, accept: /^accept/, submit: /^submit/, postVerdict: /^ending/ };
  const steps = plan.steps.map((st) => { const tx = byFn[st.fn] ? txOf(byFn[st.fn]) : null; return { ...st, tx, ack: null, events: [], ok: tx !== null }; });
  return { plan, steps, signStep: plan.steps.find((st) => st.ends) };
}

const rowsLen = (b, k) => (Array.isArray(b?.[k]) ? b[k].length : 0);

/** the machine state a coord read belongs to: the first state of the table whose read is the op (nothing typed: the table is derived from coord's machine) */
const stateOfOp = (s, op) => s.STATES.find((st) => `${st.read.method} ${st.read.path.replace(/^\/v1\//, '')}` === op);

export const CALLS = {
  // ── listed ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  // the machine's state reads (src/market/states.ts): the SDK reads the state's route and answers its status and body as served
  state: { fn: 'market.readState',
    run: (s, t, x) => s.readState(t, stateOfOp(s, x.op).id, x.params ?? {}),
    check: ({ result, x, expect }) => { expect(result.status).toBe(x.fx.response.status); expect(result.body).toEqual(x.fx.response.body); } },
  journey: { fn: 'market.journey', run: (s, t) => s.journey(t, AGENT),
    check: ({ result, x, expect, s }) => {
      const v = result.venues[x.market];
      expect(v, `the journey has a row for ${x.market}`).toBeTruthy();
      expect(Object.keys(v.leds).sort()).toEqual([...s.JOURNEY_LEDS].sort());
      expect(result.read_at).toBe(x.fx.response.body.read_at);
    } },
  market: { fn: 'market.market', run: (s, t, x) => s.market(t, VENUE_MARKET[x.market]),
    check: ({ result, x, expect }) => expect(result).toEqual(x.fx.response.body) },
  x402Bazaar: { fn: 'market.x402Bazaar', run: (s, t) => s.x402Bazaar(t, { limit: 3 }),
    check: ({ result, x, expect }) => expect(result.rows.length).toBe(rowsLen(x.fx.response.body, 'rows')) },
  mcpRegistry: { fn: 'market.mcpRegistry', run: (s, t) => s.mcpRegistry(t, { limit: 3 }),
    check: ({ result, x, expect }) => expect(result.rows.length).toBe(rowsLen(x.fx.response.body, 'rows')) },
  // the name is coord's own example (api-operations.cue query[].example)
  mcpServer: { fn: 'market.mcpServer', args: () => ({ name: 'io.github.zvmzaretsky/utility-belt' }),
    run: (s, t, x) => s.mcpServer(t, x.args.name),
    check: ({ result, x, expect }) => expect(result.name).toBe(x.args.name) },
  a2aRegistry: { fn: 'market.a2aRegistry', run: (s, t) => s.a2aRegistry(t, { limit: 3 }),
    check: ({ result, x, expect }) => expect(result.rows.length).toBe(rowsLen(x.fx.response.body, 'rows')) },
  // the id is the first agent of the recorded registry read: coord's own example id is no longer in the registry (404 on 2026-11-21)
  a2aAgent: { fn: 'market.a2aAgent', needs: 'a2aRegistry', args: (dep) => ({ id: dep.response.body.rows?.[0]?.id }),
    run: (s, t, x) => s.a2aAgent(t, x.args.id),
    check: ({ result, x, expect }) => expect(result.id).toBe(x.args.id) },
  listStatus: { fn: 'market.listStatus', run: (s, t) => s.listStatus(t, AGENT),
    check: ({ result, x, expect }) => {
      if (x.fx.response.status === 404) return expect(result).toBeNull();
      expect(result.id).toMatch(/^lst_[0-9a-f]{16}$/);
      expect(Object.keys(result.markets)).toContain(LIST_MARKET[x.market]);
    } },
  identity: { fn: 'market.identity', run: (s, t) => s.identity(t, 8453, [1170141]),
    check: ({ result, x, expect }) => expect(result.length).toBe(rowsLen(x.fx.response.body, 'agents')) },
  // a mainnet run's read carries its own chain and id (x.args, from the recorded path); the matrix's own fixture reads the house agent
  registryAgent: { fn: 'market.registryAgent', run: (s, t, x) => s.registryAgent(t, Number(x?.args?.chain ?? 8453), Number(x?.args?.id ?? 1170141)),
    check: ({ result, x, expect }) => expect(result).toEqual(x.fx.response.body) },
  virtualsSellers: { fn: 'market.virtualsSellers', run: (s, t) => s.virtualsSellers(t),
    check: ({ result, x, expect }) => { expect(result.sellers.length).toBe(rowsLen(x.fx.response.body, 'sellers')); expect(result.v3Sellers.length).toBe(rowsLen(x.fx.response.body, 'v3_sellers')); } },
  olasMechs: { fn: 'market.olasMechs', run: (s, t) => s.olasMechs(t, { chain: 8453 }),
    check: ({ result, x, expect }) => expect(result.chains.length).toBe(rowsLen(x.fx.response.body, 'chains')) },
  mechDeployments: { fn: 'market.mechDeployments', run: (s, t) => s.mechDeployments(t),
    check: ({ result, x, expect }) => { expect(result.deployments.length).toBe(rowsLen(x.fx.response.body, 'deployments')); expect(result.deployments.some((d) => d.chainId === DEVNET)).toBe(true); } },

  listOn: { fn: 'market.listOn', key: true, run: (s, t, x) => s.listOn(t, AGENT, [LIST_MARKET[x.market]]),
    contract: (x) => ({ status: 202, body: { list: { id: 'lst_0123456789abcdef', status: 'live', markets: { [LIST_MARKET[x.market]]: { state: 'queued', op: 'publish', why: null, url: null } } } } }),
    check: ({ result, x, expect }) => expect(result.markets[LIST_MARKET[x.market]].state).toBe('queued') },
  createListing: { fn: 'market.createListing', key: true,
    run: (s, t, x) => s.createListing(t, { identity: { name: 'text digest', handle: 'text-digest', tagline: 'digests a text', category: 'agents' },
      hosting: { mode: 'self_hosted', door: { kind: 'a2a', endpoint: 'https://agent.example.org/a2a' } },
      pricing: { seller_price_usd: '0.05', classes: ['mcp.digest'], payout: SELLER } }),
    contract: () => ({ status: 201, body: { listing: { id: 'al_0123456789abcdef', status: 'draft' }, token: { prefix: 'alt_', shown_once: true }, signing_secret: { prefix: 'als_', shown_once: true }, claim: null, next: 'publish' } }),
    check: ({ result, expect }) => { expect(result.listing.id).toBe('al_0123456789abcdef'); expect(result.listing.status).toBe('draft'); } },
  publishListing: { fn: 'market.publishListing', key: true, run: (s, t) => s.publishListing(t, 'al_0123456789abcdef'),
    contract: () => ({ status: 200, body: { ok: true, listing: { id: 'al_0123456789abcdef', status: 'live', why: null, listing_id: null, card_url: null }, probe: [{ class: 'mcp.digest', ok: true, why: null }] } }),
    check: ({ result, expect }) => { expect(result.listing.status).toBe('live'); expect(result.probes).toEqual([{ class: 'mcp.digest', ok: true, why: null }]); } },

  // ── bought · delivered · settled · paid ─────────────────────────────────────────────────────────────────────────────
  streamSettle: { fn: 'playground.coordStream.settle',
    run: async (s, t, x) => {
      const txs = x.fx?.response?.body?.txs ?? x.live?.txs ?? null;
      const { plan, steps } = devnetRun(s, x.market, txs);
      return s.coordStream(t, { requester: REQUESTER }).settle(plan, steps);
    },
    preflight: true,
    check: ({ result, x, expect }) => {
      const txs = x.fx.response.body.txs;
      const tx = (re) => txs.find((r) => re.test(r.role)).hash.toLowerCase();
      const stage = x.stage;
      const want = { bought: tx(/^open/), delivered: tx(/^submit/), settled: tx(/^ending/) };
      const acks = Object.fromEntries(result.acks.map((a) => [a.stage, a.tx]));
      if (stage === 'paid') expect(acks.paid, 'the devnet job records no payout transaction: paid stays off').toBeUndefined();
      else expect(acks[stage]).toBe(want[stage]);
    } },
  // the proof of the job's ending transaction on the devnet: what coordStream reads before it trusts any event
  readProof: { fn: 'proof.readProof', run: (s, t, x) => s.readProof(t, LEDGER_TX[x.stage], { chain: DEVNET }),
    check: ({ result, x, expect }) => { expect(result.tx.toLowerCase()).toBe(LEDGER_TX[x.stage]); expect(result.proven).toBe(Object.values(x.fx.response.body.checks ?? {}).length > 0 && Object.values(x.fx.response.body.checks).every(Boolean) && x.fx.response.body.blob !== null); } },
  chainTx: { fn: 'market.chainTx', run: (s, t, x) => s.chainTx(t, DEVNET, LEDGER_TX[x.stage]),
    check: ({ result, x, expect }) => {
      expect(result.events.map((e) => e.name)).toEqual(x.fx.response.body.tx.events.map((e) => e.event));
      expect(result.block).toBe(x.fx.response.body.tx.block_number);
    } },
  readJobs: { fn: 'jobs.readJobs', run: (s, t) => s.readJobs(t, [DEVNET_JOB], { chain: DEVNET }),
    check: ({ result, x, expect }) => {
      expect(result.length).toBe(rowsLen(x.fx.response.body, 'jobs'));
      for (const r of result) expect(r.ref?.kind ?? 'hook').toBe('hook');
    } },
  mechRequests: { fn: 'market.mechRequests', run: (s, t) => s.mechRequests(t, { chain: DEVNET, limit: 3 }),
    check: ({ result, x, expect }) => { expect(result.requests.length).toBe(rowsLen(x.fx.response.body, 'requests')); expect(result.totals).toEqual(x.fx.response.body.totals ?? null); } },
  mechRequest: { fn: 'market.mechRequest', needs: 'mechRequests', args: (dep) => ({ id: dep.response.body.requests.find((r) => r.status === 'delivered')?.request_id }),
    run: (s, t, x) => s.mechRequest(t, DEVNET, x.args.id),
    check: ({ result, x, expect }) => expect(result).toEqual(x.fx.response.body) },
  mechResult: { fn: 'market.mechResult', needs: 'mechRequests', args: (dep) => ({ id: dep.response.body.requests.find((r) => r.status === 'delivered')?.request_id }),
    run: (s, t, x) => s.mechResult(t, DEVNET, x.args.id),
    check: ({ result, x, expect }) => expect(result).toEqual(x.fx.response.body) },
  olasRequest: { fn: 'market.olasRequest', needs: 'olasMechs', args: (dep) => ({ id: findHex32(dep.response.body, /request/i) }),
    run: (s, t, x) => s.olasRequest(t, x.args.id),
    check: ({ result, x, expect }) => expect(result).toEqual(x.fx.response.body) },
  mechPlan: { fn: 'market.mechPlan', run: (s, t) => s.mechPlan(t, { chainId: DEVNET, task: { product: 'agent', chainId: 8453, agentId: 1170141 }, requester: A('b1') }),
    contract: () => ({ status: 200, body: { task: { text: '{"product":"agent","chainId":8453,"agentId":1170141}', taskHash: H('5a'), taskURI: 'data:application/json,%7B%7D' }, price: '10000', flags: 0, request_id: H('6b'),
      calls: [{ step: 'approve', to: A('a4'), data: '0x095ea7b3' }, { step: 'request', to: A('a6'), data: '0x12345678' }] } }),
    check: ({ result, expect }) => { expect(result.calls.map((c) => c.step)).toEqual(['approve', 'request']); expect(result.requestId).toBe(H('6b')); } },
  handOver: { fn: 'market.handOver', key: true,
    run: (s, t, x) => s.handOver(t, { candidate: { kind: HIRE_KIND[x.market], address: SELLER, agentId: '1170141', chainId: 8453 }, task: 'Digest this text: the quick brown fox.' }),
    // coord's contract for POST /v1/handshake declares its request (Send { … }) and no answer field: the answer is empty
    contract: () => ({ status: 200, body: {} }),
    check: ({ error, expect }) => { expect(error?.name, 'the contract declares no handshake_id, so handOver refuses the answer').toBe('MarketError'); expect(error.status).toBe(502); } },

  signRegister: { fn: 'playground.coordStream.sign', preflight: true,
    run: (s, t, x) => { const { signStep } = devnetRun(s, x.market, []); return s.coordStream(t, { requester: REQUESTER, seal: async () => 'c2VhbA==', now: () => 1_794_940_000_000, nonce: () => 'io-1' }).sign(signStep); },
    check: ({ result, x, expect }) => {
      const has = (x.fx.response.body.purposes ?? []).some((p) => p.id === 'devnet.evaluate');
      if (has) expect(['shadow', 'refused', 'signed', 'no_answer']).toContain(result.status);
      else { expect(result.status, 'devnet.evaluate is not in the served register').toBe('not_routable'); expect(result.reason).toMatch(/devnet\.evaluate is not in the signer's register/); }
    } },
  signFlow: { fn: 'playground.coordStream.sign', key: true, flow: true,
    run: (s, t, x) => { const { signStep } = devnetRun(s, x.market, []); return s.coordStream(t, { requester: REQUESTER, seal: async () => 'c2VhbA==', now: () => 1_794_940_000_000, nonce: () => 'io-1' }).sign(signStep); },
    // the four answers of one sign request, field for field what coord declares: sign/status (returns), pipe/send (returns),
    // the inbox (returns; each envelope's fields from api-bodies PipeEnvelope; its payload the result fields of sign.json), pipe/ack
    contract: (x, req) => {
      if (req.path === '/v1/sign/status') return { status: 200, body: { schema: 'taifoon.sign.status.v1', purposes: [{ id: 'devnet.evaluate', mode: 'shadow', key: 'devnet-tryout', vault: 'none', counts: null }] } };
      if (req.path === '/v1/pipe/send') return { status: 200, body: { id: H('e1'), state: 'queued', carrier: 'inbox', batch: null } };
      if (req.path.startsWith('/v1/pipe/inbox/')) return { status: 200, body: { who: REQUESTER, envelopes: [{ id: H('e2'), kind: 'sign', reply_to: H('e1'),
        payload: JSON.stringify({ schema: 'taifoon.sign.result.v1', request: H('e1'), state: 'shadowed' }) }] } };
      if (req.path === '/v1/pipe/ack') return { status: 200, body: { id: H('e2'), state: 'acked' } };
      return null;
    },
    check: ({ result, expect }) => { expect(result.status).toBe('shadow'); expect(result.tx).toBeNull(); expect(result.would, 'sign.json declares no would_sign result field').toBeNull(); } },
  signerStatus: { fn: 'market.signerStatus', run: (s, t) => s.signerStatus(t),
    check: ({ result, x, expect }) => {
      expect(result.purposes.length).toBe(rowsLen(x.fx.response.body, 'purposes'));
      expect(result.purposes.find((p) => p.id === 'devnet.payout'), 'devnet.payout is not in the served register').toBeUndefined();
    } },
  agentPayTo: { fn: 'market.agentPayTo', run: (s, t) => s.agentPayTo(t),
    check: ({ result, x, expect }) => { const b = x.fx.response.body; expect(result.matching).toBe(b.matching); expect(result.agents.length).toBe(b.agents.length);
      expect(result.agents[0]?.payTo.length).toBe(b.agents[0]?.payments.length); } },
  claimablePayouts: { fn: 'market.claimablePayouts', run: (s, t) => s.claimablePayouts(t, { chain: String(DEVNET), limit: 3 }),
    check: ({ result, x, expect }) => { expect(result.payouts.length).toBe(rowsLen(x.fx.response.body, 'envelopes')); expect(result.count).toBe(x.fx.response.body.count); } },
  // the hire's unsigned plan (POST /v1/settle, coord api_bodies.SettlePlan): the devnet job's terms; the answer carries only the fields
  // coord's answer types (ok, jobId, chainId, token, hook, deadline, calls[] action, signer, to, data)
  hirePlan: { fn: 'market.hirePlan', key: true,
    run: (s, t) => s.hirePlan(t, { chainId: DEVNET, buyer: A('b1'), seller: SELLER, price: '1000000', deadline: 1_800_000_660, evidence: H('33'), ref: { id: 'io-hire' } }),
    contract: () => ({ status: 200, body: { ok: true, jobId: DEVNET_JOB, chainId: DEVNET, token: A('a4'), hook: A('a1'), deadline: 1_800_000_660, calls: [
      { action: 'approve', signer: 'the buyer', to: A('a4'), data: '0x095ea7b3' },
      { action: 'fundJob', signer: 'the buyer', to: A('a1'), data: '0x5d0a7e9b' },
      { action: 'accept', signer: 'the seller of record', to: A('a1'), data: '0x19b05f49' } ] } }),
    check: ({ result, x, expect }) => {
      expect(result.calls.map((c) => c.signer)).toEqual(x.fx.response.body.calls.map((c) => c.signer));
      expect(result.body.jobId).toBe(x.fx.response.body.jobId);
    } },
  // fund-job on the devnet job (POST /v1/assurance/call, coord api_bodies.AssuranceCall); the answer carries only coord's typed fields
  jobCalls: { fn: 'market.jobCalls',
    run: (s, t) => s.jobCalls(t, { chainId: DEVNET, action: { kind: 'fund-job', jobId: DEVNET_JOB, seller: SELLER, token: A('a4'), price: '1000000', deposit: '1111750' } }),
    contract: () => ({ status: 200, body: { ok: true, note: 'Send these in order from the named signer.', calls: [
      { chainId: DEVNET, action: 'approve', to: A('a4'), data: '0x095ea7b3', value: '0', effect: 'lets the hook take the price', signer: 'the buyer' },
      { chainId: DEVNET, action: 'fund-job', to: A('a1'), data: '0x5d0a7e9b', value: '0', effect: 'funds the job', signer: 'the buyer' } ] } }),
    check: ({ result, x, expect }) => expect(result.calls.map((c) => c.action)).toEqual(x.fx.response.body.calls.map((c) => c.action)) },
  reportSettled: { fn: 'market.reportSettled', key: true, run: (s, t) => s.reportSettled(t, { id: H('e3'), chain: DEVNET, tx: H('f4') }),
    contract: () => ({ status: 202, body: { outcome: 'recorded', id: H('e3'), tx: H('f4'), chain: String(DEVNET), state: 'claimable', reports: 1 } }),
    check: ({ result, expect }) => expect(result.outcome).toBe('recorded') },
};

/** the first 32-byte hex value under a key matching re, anywhere in a body */
export function findHex32(v, re, depth = 0) {
  if (depth > 8 || v === null || typeof v !== 'object') return undefined;
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === 'string' && /^0x[0-9a-fA-F]{64}$/.test(x) && re.test(k)) return x;
    const got = findHex32(x, re, depth + 1);
    if (got) return got;
  }
  return undefined;
}

/** the SDK's modules as one namespace, from src (tests) or dist (the recorder) */
export function sdkOf(mods) {
  const out = {};
  for (const m of mods) for (const [k, v] of Object.entries(m)) if (!(k in out)) out[k] = v;
  return out;
}

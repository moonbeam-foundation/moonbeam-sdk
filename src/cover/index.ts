/**
 * @moonbeam-foundation/sdk/cover: a quote for cover on a job bought elsewhere (GET /v1/cover/quote). The layer requires the
 * venue the job is on; these helpers always send it (default `erc8183`, the Virtuals ACP v3 contract) and refuse an input
 * the venue cannot be quoted from before any call.
 *
 *   coverQuotePlan(i)    the GET this quote is: path and query, venue included. Pure
 *   quoteCover(t, i)     the read: a quote (insurable) or the layer's reasons it is not insurable now (insurable: false)
 *
 * A job id may name its venue itself: `bitagent:8453:8566` quotes venue bitagent on chain 8453, job 8566; a bare number is
 * an ACP v3 job (venue erc8183). Nothing here buys cover: buyCover is the buyer's own signed call.
 */
import type { OnboardTransport } from '../onboard/index.js';
import { CoordError, jsonOf, refusalOf } from '../errors/index.js';
import { parseJobRef } from '../jobs/index.js';

export const COVER_VENUES = Object.freeze(['erc8183', 'bitagent', 'memo-acp', 'x402', 'olas-mech'] as const);
export type CoverVenue = (typeof COVER_VENUES)[number];
/** The venue a quote names when the input names none: the ERC-8183 (Virtuals ACP v3) job contract. */
export const DEFAULT_COVER_VENUE: CoverVenue = 'erc8183';

export type CoverQuoteInput = {
  /** the market the job is on (default erc8183; a keyed job id names its own) */
  venue?: CoverVenue;
  /** the cover line: devnet today; base once the owner approves the mainnet plan. Omitted: the layer's default line */
  network?: string;
  /** the chain the job is on (default: the line's chain; a keyed job id names its own) */
  chain?: number;
  /** the venue's job id (erc8183, bitagent, memo-acp), or a keyed id such as bitagent:8453:8566 */
  job?: string | number | bigint;
  /** your wallet: it must be the job's client */
  buyer: string;
  /** less cover than the price, in the pool asset's units */
  cap?: bigint | string;
  /** x402: the payee, the price in token units, the EIP-3009 nonce the payment will carry */
  pay_to?: string; amount?: bigint | string; nonce?: string;
  /** Olas: the priority mech, the request fee, keccak256 of the request data */
  mech?: string; fee?: bigint | string; data_hash?: string;
  /** x402 / Olas: seconds until delivery is due */
  sla?: number;
};

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const KEYED_VENUE: Readonly<Record<string, CoverVenue>> = Object.freeze({ bitagent: 'bitagent', 'memo-acp': 'memo-acp', memoacp: 'memo-acp', erc8183: 'erc8183', 'acp-v3': 'erc8183' });

/** The GET of one cover quote, venue always named. Throws a RangeError on an input the venue cannot be quoted from. Pure. */
export function coverQuotePlan(i: CoverQuoteInput): { method: 'GET'; path: string; query: Record<string, string> } {
  if (!ADDR.test(i.buyer ?? '')) throw new RangeError('buyer is your wallet address (the job’s client)');
  let venue: CoverVenue = i.venue ?? DEFAULT_COVER_VENUE;
  let chain = i.chain;
  let job: string | undefined;
  if (i.job !== undefined) {
    const ref = parseJobRef(i.job);
    if (ref.kind === 'hook') throw new RangeError('a 32-byte hook job is covered by its hook, not by external cover');
    if (ref.kind === 'contract') {
      const v = KEYED_VENUE[ref.label];
      if (!v) throw new RangeError(`no cover venue for jobs keyed ${ref.label}: (${COVER_VENUES.join(' · ')})`);
      if (i.venue && i.venue !== v) throw new RangeError(`the job id names venue ${v}, not ${i.venue}`);
      venue = v; chain = chain ?? ref.chainId ?? undefined;
    }
    job = ref.jobId;
  }
  if (!(COVER_VENUES as readonly string[]).includes(venue)) throw new RangeError(`venue is one of ${COVER_VENUES.join(' · ')}`);
  if ((venue === 'erc8183' || venue === 'bitagent' || venue === 'memo-acp') && job === undefined) throw new RangeError(`a ${venue} quote names the job (job)`);
  if (venue === 'x402' && !(i.pay_to && i.amount !== undefined && i.nonce)) throw new RangeError('an x402 quote names pay_to, amount and nonce');
  if (venue === 'olas-mech' && !(i.mech && i.fee !== undefined && i.data_hash)) throw new RangeError('an Olas quote names mech, fee and data_hash');
  const q: Record<string, string> = { venue, buyer: i.buyer };
  if (i.network) q['network'] = i.network;
  if (chain !== undefined) q['chain'] = String(chain);
  if (job !== undefined) q['job'] = job;
  for (const k of ['cap', 'pay_to', 'amount', 'nonce', 'mech', 'fee', 'data_hash', 'sla'] as const) if (i[k] !== undefined) q[k] = String(i[k]);
  return { method: 'GET', path: `/cover/quote?${new URLSearchParams(q)}`, query: q };
}

export type CoverQuote = { ok: true; insurable: true; policy_id?: string; quote: Record<string, unknown>; signatures?: unknown[]; price?: unknown; job?: unknown; next?: unknown };
export type NotInsurable = { ok: false; insurable: false; why: string[]; job?: unknown };

/** Read one cover quote. A job that cannot be covered now is an answer (insurable: false, why[]); any other refusal throws a CoordError. */
export async function quoteCover(t: OnboardTransport, i: CoverQuoteInput): Promise<CoverQuote | NotInsurable> {
  const p = coverQuotePlan(i);
  const r = await t.fetch(`${t.base}${p.path}`, { method: 'GET', headers: { accept: 'application/json', ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) } });
  const j = (await jsonOf(r)) as Record<string, unknown> | null;
  if (j && j['insurable'] === false && Array.isArray(j['why'])) return { ok: false, insurable: false, why: (j['why'] as unknown[]).map(String), ...(j['job'] !== undefined ? { job: j['job'] } : {}) };
  if (!r.ok || !j || j['ok'] === false) throw new CoordError(refusalOf(j, r.status, `GET /cover/quote → ${r.status}`));
  return j as unknown as CoverQuote;
}

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASE_VENUES, OWN_LABELS, isBaseVenue, quoteBase, legsByName, childKeyTerms, childKeyPlan, subscribePlan, readSale, readResellerView, SALE_ID_RE,
  FORMULA, RULE, LEGS, sumOf, legsOfPayment, grossUp, venueFeeOf,
} from '../src/resale/index.js';

const DIR = join(__dirname, '..', 'src', 'resale');

describe('resale: the vendored one payment scheme', () => {
  it('is the pinned, byte-identical copy of Moonbeam’s payment-scheme.mjs', () => {
    const pin = JSON.parse(readFileSync(join(DIR, 'payment-scheme.pin.json'), 'utf8')) as { sha256: string; source: string };
    expect(pin.source).toMatch(/payment-scheme\.mjs$/);
    expect(createHash('sha256').update(readFileSync(join(DIR, 'payment-scheme.mjs'))).digest('hex')).toBe(pin.sha256);
  });
  it('states the one formula and the named legs in Moonbeam’s words: undercut only, nothing on top', () => {
    expect(RULE).toBe('ONE_PAYMENT_SCHEME_v1');
    expect(FORMULA).toBe('price_to_buyer = seller_price + our_fee + venue_fee(in) + venue_fee(out)');
    expect(LEGS.map((l) => l.id)).toEqual(expect.arrayContaining(['our_fee', 'venue_fee', 'seller_share']));
    expect(LEGS.map((l) => l.id)).not.toContain('reseller_markup');
    expect(LEGS.map((l) => l.what).join(' ')).not.toMatch(/markup|coord/i);
  });
});

describe('resale: quoteBase, the Moonbeam profile', () => {
  it('names the five Base venues and Moonbeam’s own labels', () => {
    expect([...BASE_VENUES]).toEqual(['x402-base', 'erc8183-base', 'memoacp-base', 'bitagent-base', 'olas-base']);
    expect(isBaseVenue('x402-base')).toBe(true); expect(isBaseVenue('x402-solana')).toBe(false);
    expect(OWN_LABELS).toContain('reseller');
  });
  it('refuses a venue outside Base before the scheme is asked', () => {
    const r = quoteBase({ venue_in: 'x402-solana' as never, venue_out: 'mcp', seller_price: 8000n });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.why).toMatch(/not a Base venue/);
    const g = quoteBase({ venue_in: 'x402-base', venue_out: 'olas-gnosis' as never, seller_price: 8000n });
    expect(g.ok).toBe(false);
  });
  it('quotes the same numbers Moonbeam charges: the doer keeps its price, our fee does not move with the venue, Σ = the price', () => {
    const plain = quoteBase({ venue_in: 'x402-base', venue_out: 'mcp', seller_price: 8000n });
    const v3 = quoteBase({ venue_in: 'x402-base', venue_out: 'erc8183-base', seller_price: 8000n });
    const memo = quoteBase({ venue_in: 'memoacp-base', venue_out: 'memoacp-base', seller_price: 8000n });
    if (!plain.ok || !v3.ok || !memo.ok) throw new Error('a quote was refused');
    expect(plain.price_to_buyer).toBe('10000');
    expect(v3.price_to_buyer).toBe('10888');            // the 10 % ERC-8183 cut grossed up: the doer still receives 8000
    for (const q of [plain, v3, memo]) { const l = legsByName(q); expect(l.our_fee).toBe(2000n); expect(l.seller_share).toBe(8000n); expect(sumOf(q.legs)).toBe(BigInt(q.price_to_buyer)); }
    expect(grossUp('erc8183-base', 8000n).gross).toBe(8888n); expect(venueFeeOf('erc8183-base', 8888n).net).toBe(8000n);
  });
  it('takes no reseller leg on top of the list price: undercut only', () => {
    const r = quoteBase({ venue_in: 'reseller', venue_out: 'mcp', seller_price: 8000n, reseller: { tenant: 'acct_moonbeam', markup_bps: 1000 } } as never);
    expect(r.ok).toBe(false); if (!r.ok) expect((r as { why: string }).why).toMatch(/undercut only/);
    const plain = quoteBase({ venue_in: 'reseller', venue_out: 'mcp', seller_price: 8000n });
    if (!plain.ok) throw new Error('refused');
    expect(plain.price_to_buyer).toBe('10000'); expect(plain.legs.some((l) => l.leg === 'reseller_markup')).toBe(false);
  });
  it('legsOfPayment books a paid sale to the unit, and refuses a reseller leg', () => {
    const r = legsOfPayment({ venue_in: 'reseller', venue_out: 'mcp', paid_units: 10000n, out_units: 8000n });
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect((r as { sum_ok: boolean }).sum_ok).toBe(true);
    expect((r as { legs: { leg: string; units: string }[] }).legs.find((l) => l.leg === 'our_fee')?.units).toBe('2000');
    const m = legsOfPayment({ venue_in: 'reseller', venue_out: 'mcp', paid_units: 11000n, out_units: 8000n, reseller: { tenant: 'x', markup_units: 1000n } } as never);
    expect(m.ok).toBe(false);
  });
});

describe('resale: the child key, the subscribe door, the reads', () => {
  it('states the child key’s terms in Moonbeam’s words and builds the unsigned mint plan, at the list price', () => {
    const t = childKeyTerms();
    expect(t.rail).toBe('balance'); expect(t.payment_method).toBe('reseller-child');
    expect(t.says.join(' ')).toMatch(/undercut only/); expect(t.says.join(' ')).not.toMatch(/markup/i);
    const p = childKeyPlan('mb:wallet');
    expect(p).toEqual({ method: 'POST', path: '/tenant/keys', body: { action: 'child', label: 'mb:wallet' }, signer: 'the reseller tenant (its own key, X-API-Key)' });
    expect(childKeyPlan().body).toEqual({ action: 'child' });
    // a 0.12 call with an all-zero policy still reads; anything on top is refused
    expect((childKeyPlan as (...a: unknown[]) => { body: object })({ '*': 0 }, 'mb:wallet').body).toEqual({ action: 'child', label: 'mb:wallet' });
    expect(() => (childKeyPlan as (...a: unknown[]) => unknown)({ '*': 1000 })).toThrow(/undercut only/);
    expect(() => childKeyPlan('')).toThrow(/label/);
  });
  it('the subscribe plan names the one door and refuses a bad amount', () => {
    expect(subscribePlan({ usdc: 2 })).toMatchObject({ method: 'POST', path: '/access/subscribe', body: { chainId: 8453, usdc: 2, create_key: false } });
    expect(() => subscribePlan({ usdc: 0 })).toThrow(/positive/);
  });
  it('reads a sale by id through the transport, and refuses a bad id before any call', async () => {
    const calls: string[] = [];
    const t = { base: '/api/onboard', fetch: async (url: string) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ ok: true, rule: 'RESALE_SALE_READ_v1', sale: { id: 'rs_1x_0123456789' } }) }; } };
    const s = await readSale(t, 'rs_1x_0123456789');
    expect(s.ok).toBe(true); expect(calls).toEqual(['/api/onboard/resale/sales/rs_1x_0123456789']);
    await expect(readSale(t, 'nope')).rejects.toThrow(/sale id/);
    expect(SALE_ID_RE.test('rs_m1abc_0123456789')).toBe(true);
  });
  it('the reseller view surfaces the layer’s refusal code', async () => {
    const t = { base: '/api/onboard', fetch: async () => ({ ok: false, status: 403, json: async () => ({ ok: false, code: 'not_reseller', error: 'this tenant is not a reseller; the owner names resellers' }) }) };
    await expect(readResellerView(t)).rejects.toThrow(/not a reseller/);
  });
});

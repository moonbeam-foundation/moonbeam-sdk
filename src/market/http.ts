// The one HTTP door of ./market: every call goes through the transport given, the key only in the x-api-key header.
import type { OnboardTransport } from '../onboard/index.js';
import { CoordError, jsonOf, refusalOf } from '../errors/index.js';

/** A refusal of a market call (a CoordError: status, code, message, nextStep, body). */
export class MarketError extends CoordError {
  constructor(status: number, what: string, body: unknown) { super(refusalOf(body, status, `${what} → ${status}`)); this.name = 'MarketError'; }
}

export type Q = Record<string, string | number | boolean | undefined | null>;
export const query = (q: Q) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
export const headers = (t: OnboardTransport, json = false): Record<string, string> => ({ accept: 'application/json', ...(json ? { 'content-type': 'application/json' } : {}), ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) });
export const seg = (v: string | number) => encodeURIComponent(String(v));

export async function call<T>(t: OnboardTransport, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const what = `${method} ${path.split('?')[0]}`;
  const r = await t.fetch(`${t.base}${path}`, { method, headers: headers(t, body !== undefined), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const j = await jsonOf(r);
  const refused = j && typeof j === 'object' && (j as { ok?: unknown }).ok === false;
  if (!r.ok || refused || j === null) throw new MarketError(r.status, what, j);
  return j as T;
}
export const needKey = (t: OnboardTransport, what: string) => {
  if (!t.apiKey) throw new MarketError(401, what, { ok: false, code: 'key_required', error: `${what} reads with your Moonbeam key: set MOONBEAM_API_KEY` });
};


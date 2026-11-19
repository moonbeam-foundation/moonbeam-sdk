// _KEYED_FETCH_v1_: the one door every SDK call goes through (security audit 2026-11-19). A call that carries your key
// (X-API-Key or Authorization) goes only to your transport's own base, over https (or to localhost while you develop), and never
// follows a redirect: fetch keeps a custom header such as X-API-Key across a redirect to another host, so a redirect is refused
// rather than followed. A base given as a path ("/api/onboard", a same-origin proxy) keeps its calls on that page's origin.
// Calls without a key go as before.

export type KeyedInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal; redirect?: 'error' | 'follow' | 'manual' };
type Fetcher<R> = { fetch: (url: string, init?: KeyedInit) => Promise<R>; base: string };

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)$/i;
const carriesKey = (h: Record<string, string> | undefined) => Object.keys(h ?? {}).some((k) => /^(x-api-key|authorization)$/i.test(k));
const isAbsolute = (u: string) => /^[a-z][a-z0-9+.-]*:/i.test(u);

/** where a keyed call may go, or why not (null: it may go) */
export function keyedRefusal(base: string, url: string): string | null {
  if (!isAbsolute(base)) return isAbsolute(url) ? `a key for the same-origin base ${base} is not sent to ${new URL(url).origin}` : null;
  let b: URL, u: URL;
  try { b = new URL(base); u = new URL(url); } catch { return `not a URL: ${url}`; }
  if (u.origin !== b.origin) return `your key goes only to ${b.origin}, not to ${u.origin}`;
  if (u.protocol !== 'https:' && !LOCAL.test(u.hostname)) return `your key travels over https only (or to localhost), not ${u.protocol}//${u.host}`;
  return null;
}

/** t.fetch(url, init), with a keyed call held to the rules above */
export function keyedFetch<R>(t: Fetcher<R>, url: string, init: KeyedInit = {}): Promise<R> {
  if (!carriesKey(init.headers)) return t.fetch(url, init);
  const why = keyedRefusal(t.base, url);
  if (why) return Promise.reject(new RangeError(why));
  return t.fetch(url, { ...init, redirect: 'error' });
}

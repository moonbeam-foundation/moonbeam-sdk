// The one door for LIVE fixture reads (_COORD_IO_COVERAGE_v1_). Plain HTTPS GETs to coord's /v1 only, no POST, at most 150
// requests in all (counted in test/io/live-log.json, across runs), at least 1.1 s apart. A 401, 402 or 429 closes that route for
// good (logged as refused); nothing is retried and nothing is paid. No key, unless the recorder holds the owner-approved one
// (_IO_RECORDER_KEY_v1_, scripts/io-key.mjs): then it goes as X-API-Key to coord only, redirects are refused, a route closed
// without the key may be read once with it, and an answer that echoes the key is refused before anything is kept.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertNoSecret, recorderKey } from './io-key.mjs';

export const LIVE_BASE = 'https://coord.taifoon.dev/v1';
export const LIVE_MAX = 150;
const GAP_MS = 1100;
const STOPS = new Set([401, 402, 429]);

export function liveLog(root) {
  const file = join(root, 'test/io/live-log.json');
  const log = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { rule: 'GET only, no key, <= 150 calls, >= 1 s apart; 401/402/429 closes the route', calls: [] };
  return { file, log, save: () => writeFileSync(file, JSON.stringify(log, null, 2) + '\n') };
}

const routeOf = (path) => path.split('?')[0].replace(/\/0x[0-9a-fA-F]{64}/g, '/:tx').replace(/\/[0-9]+(?=\/|$)/g, '/:n');

/** GET one public path ('/listed?…'); o.fetchImpl and o.gapMs are for tests only; answers { status, body, refused? }. Throws when the budget is spent or the route is closed. */
export async function liveGet(root, path, o = {}) {
  const doFetch = o.fetchImpl ?? fetch, gapMs = o.gapMs ?? GAP_MS;
  if (!path.startsWith('/') || /[\s#]/.test(path)) throw new Error(`not a path: ${path}`);
  const L = liveLog(root);
  if (L.log.calls.length >= LIVE_MAX) throw new Error(`live budget spent: ${L.log.calls.length} of ${LIVE_MAX}`);
  const key = recorderKey();
  const closed = L.log.calls.find((c) => STOPS.has(c.status) && routeOf(c.path) === routeOf(path) && !!c.keyed === !!key);
  if (closed) return { status: closed.status, body: null, refused: true, closedBy: closed.path };
  const last = L.log.calls.at(-1);
  const wait = last ? gapMs - (Date.now() - Date.parse(last.at)) : 0;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const at = new Date().toISOString();
  let status = 0, body = null;
  try {
    const url = new URL(`${LIVE_BASE}${path}`);
    if (url.origin !== new URL(LIVE_BASE).origin || !url.pathname.startsWith('/v1/')) throw new Error(`not coord /v1: ${url.origin}${url.pathname}`);
    const r = await doFetch(url, { method: 'GET', redirect: 'error', headers: { accept: 'application/json', 'user-agent': 'moonbeam-sdk-io-coverage', ...(key ? { 'x-api-key': key } : {}) } });
    status = r.status;
    const text = await r.text();
    assertNoSecret(text, `the answer to GET ${path}`);
    try { body = JSON.parse(text); } catch { body = { non_json: text.slice(0, 200) }; }
  } catch (e) { if (/^refused to write/.test(e?.message)) throw e; status = -1; body = { error: String(e?.message ?? e) }; }
  L.log.calls.push({ n: L.log.calls.length + 1, at, path, status, ...(key ? { keyed: true } : {}), ...(STOPS.has(status) ? { refused: true } : {}) });
  assertNoSecret(JSON.stringify(L.log), 'test/io/live-log.json');
  L.save();
  return { status, body, read_at: at, ...(STOPS.has(status) ? { refused: true } : {}) };
}

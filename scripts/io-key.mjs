// _IO_RECORDER_KEY_v1_: the one door for the I/O recorder's coord key (owner yes 2026-11-19: a free coord key, sealed in SSM as
// moonbeam/sdk-io-recorder/COORD_API_KEY, used only to read coord for test/io fixtures, never in a published package).
//   kms-access secret get moonbeam sdk-io-recorder/COORD_API_KEY | node scripts/io-record.mjs --coord <path> --key-stdin
// The key arrives on stdin only (never argv, never env, never a file), is held in this module, goes only to coord's /v1 as
// X-API-Key on a plain GET, and is never written: every fixture and log line is checked for it and for any key-shaped string
// before it is kept (SECRET_PATTERNS, which test/no-secrets.test.ts also runs over the repo and the packed files).

/** key-shaped strings that must never sit in this repo or its package: coord free/live keys, AWS keys, Anthropic keys, PEM blocks */
export const SECRET_PATTERNS = [
  { name: 'coord key (tfr_)', re: /tfr_[A-Za-z0-9_-]{12,}/ },
  { name: 'coord live key (tfn_live_)', re: /tfn_live_[A-Za-z0-9_-]{8,}/ },
  { name: 'AWS access key id', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'Anthropic key', re: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

let KEY = null;

/** the names of the secret patterns `text` holds (and the held key itself, when it is there) */
export function secretsIn(text, key = KEY) {
  const hits = SECRET_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
  if (key && text.includes(key)) hits.unshift('the recorder key');
  return hits;
}

/** throw when `text` (a fixture or log about to be written) holds a key; names what, never the value */
export function assertNoSecret(text, where) {
  const hits = secretsIn(text);
  if (hits.length) throw new Error(`refused to write ${where}: it holds ${hits.join(', ')}`);
}

/** read the key from stdin (a pipe from kms-access, never a terminal); hold it for liveGet */
export async function readRecorderKey(stdin = process.stdin) {
  if (stdin.isTTY) throw new Error('--key-stdin reads a pipe (kms-access secret get … |), not a terminal');
  let raw = '';
  for await (const chunk of stdin) raw += chunk;
  const k = raw.trim();
  if (!/^tfr_[A-Za-z0-9_-]{12,}$/.test(k)) throw new Error('--key-stdin: stdin is not one coord free key (tfr_…)');
  KEY = k;
  return true;
}

/** the held key, for liveGet only */
export const recorderKey = () => KEY;
/** for tests: hold a key without stdin */
export const holdKeyForTest = (k) => { KEY = k; };

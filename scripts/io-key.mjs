// _IO_RECORDER_KEY_v1_: the recorder's coord key arrives on stdin (a pipe), goes only to coord /v1, and is never written.

/** key-shaped strings that never belong in a fixture, a log or the package */
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

/** read the key from stdin (a pipe, never a terminal); hold it for liveGet */
export async function readRecorderKey(stdin = process.stdin) {
  if (stdin.isTTY) throw new Error('--key-stdin reads a pipe, not a terminal');
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

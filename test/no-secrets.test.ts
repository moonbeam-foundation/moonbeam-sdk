// _IO_RECORDER_KEY_v1_ + _NO_SECRETS_IN_PACKAGE_v1_: no key-shaped string sits in this repo or in what `npm pack` would publish,
// the published files never include the recorder (scripts/, test/), and the recorder's key door refuses what it must.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain ES module shared with the recorder
import { SECRET_PATTERNS, assertNoSecret, holdKeyForTest, readRecorderKey, secretsIn } from '../scripts/io-key.mjs';

const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// a key-shaped string built at run time, so this file itself holds none
const fake = ['tfr', 'free', 'abcdefghijklmnop0123'].join('_');
// _NO_OWN_ADDRESSES_v1_: our own key, Safe, payee and treasury addresses, read at test time from the operator's local key registry
// (KMS_REGISTRY, default ~/projects/conclave-v2/access/projects.json) and never written here; with no registry (CI) the check is skipped
function ownAddresses(): Set<string> {
  const file = process.env.KMS_REGISTRY || join(process.env.HOME || '', 'projects/conclave-v2/access/projects.json');
  const out = new Set<string>();
  if (!existsSync(file)) return out;
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    else if (typeof v === 'string' && /(keys\.[^.]+\.address|safe|owner|treasury|pay_?to|payout|reserve|solana|deployer|signer)/i.test(path)
      && (/^0x[0-9a-fA-F]{40}$/.test(v) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v))) out.add(v.toLowerCase());
  };
  walk(JSON.parse(readFileSync(file, 'utf8')), '');
  return out;
}
const OWN = ownAddresses();
const ownIn = (text: string) => { const t = text.toLowerCase(); return [...OWN].filter((a) => t.includes(a)).map((a) => `${a.slice(0, 6)}…`); };
const textOf = (p: string) => { const f = join(root, p); if (!existsSync(f) || statSync(f).size > 4_000_000) return ''; const b = readFileSync(f); return b.includes(0) ? '' : b.toString('utf8'); };

describe('_NO_SECRETS_IN_PACKAGE_v1_', () => {
  it('the patterns catch each kind of key, and assertNoSecret names it without the value', () => {
    expect(secretsIn(`{"k":"${fake}"}`, null)).toEqual(['coord key (tfr_)']);
    expect(secretsIn(['AKIA', 'ABCDEFGHIJKLMNOP'].join(''), null)).toEqual(['AWS access key id']);
    expect(secretsIn(['-----BEGIN EC ', 'PRIVATE KEY-----'].join(''), null)).toEqual(['private key block']);
    expect(secretsIn('io-replay-key and tfr_ alone', null)).toEqual([]);
    expect(() => assertNoSecret(`x ${fake}`, 'f.json')).toThrow(/refused to write f\.json: it holds coord key/);
    try { assertNoSecret(`x ${fake}`, 'f.json'); } catch (e) { expect(String(e)).not.toContain(fake); }
  });

  it('the held recorder key is caught in any text, whatever its shape', async () => {
    holdKeyForTest('tfr_x');
    expect(secretsIn('answer echoes tfr_x here')).toContain('the recorder key');
    holdKeyForTest(null);
  });

  it('the key door reads a pipe only, and one tfr_ key only', async () => {
    const tty = Object.assign(Readable.from([]), { isTTY: true });
    await expect(readRecorderKey(tty)).rejects.toThrow(/not a terminal/);
    await expect(readRecorderKey(Readable.from(['not a key\n']))).rejects.toThrow(/not one coord free key/);
    await expect(readRecorderKey(Readable.from([`${fake}\n`]))).resolves.toBe(true);
    holdKeyForTest(null);
  });

  it('the package publishes no recorder, no tests and no env file', () => {
    const files: string[] = pkg.files;
    for (const f of files) expect(f, `package.json files: ${f}`).not.toMatch(/^(test|scripts|src\/?$|\.env|.*\.env$)/);
    expect(files).not.toContain('test');
    expect(files).not.toContain('scripts');
  });

  it('no tracked file holds a key', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    const hits = tracked.flatMap((p) => { const h = secretsIn(textOf(p), null); return h.length ? [`${p}: ${h.join(', ')}`] : []; });
    expect(hits).toEqual([]);
  });

  it.skipIf(OWN.size === 0)('no tracked or published file holds one of our own key, Safe, payee or treasury addresses', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    const hits = tracked.flatMap((p) => { const h = ownIn(textOf(p)); return h.length ? [`${p}: ${h.join(', ')}`] : []; });
    expect(hits).toEqual([]);
  });

  it('no file npm would publish holds a key', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const files: string[] = JSON.parse(out)[0].files.map((f: { path: string }) => f.path);
    expect(files.some((f) => /^(test|scripts)\//.test(f)), 'the recorder is not published').toBe(false);
    const hits = files.flatMap((p) => { const h = secretsIn(textOf(p), null); return h.length ? [`${p}: ${h.join(', ')}`] : []; });
    expect(hits).toEqual([]);
    expect(SECRET_PATTERNS.length).toBeGreaterThanOrEqual(5);
  }, 60_000);
});

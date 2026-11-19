// _KEYED_FETCH_v1_: a call carrying your key goes only to your base, over https or to localhost, and never follows a redirect.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { keyedFetch, keyedRefusal } from '../src/core/keyed.js';
import { readJobs } from '../src/jobs/index.js';

type Init = { headers?: Record<string, string>; redirect?: string };
const spy = (base: string, apiKey?: string) => {
  const seen: Array<{ url: string; init: Init | undefined }> = [];
  return { seen, t: { base, ...(apiKey ? { apiKey } : {}), fetch: async (url: string, init?: Init) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => ({ jobs: [] }) }; } } };
};

describe('_KEYED_FETCH_v1_', () => {
  it('a keyed call to its own https base goes, with redirects refused', async () => {
    const { t, seen } = spy('https://coord.example/v1');
    await keyedFetch(t, 'https://coord.example/v1/jobs', { headers: { 'x-api-key': 'k' } });
    expect(seen[0]!.init!.redirect).toBe('error');
  });

  it('a call without a key goes as given', async () => {
    const { t, seen } = spy('https://coord.example/v1');
    await keyedFetch(t, 'https://elsewhere.example/x', { headers: { accept: 'application/json' } });
    expect(seen[0]!.init!.redirect).toBeUndefined();
  });

  it('a keyed call to another origin, or over plain http, is refused before it is sent', async () => {
    const { t, seen } = spy('https://coord.example/v1');
    await expect(keyedFetch(t, 'https://evil.example/v1/jobs', { headers: { 'X-API-Key': 'k' } })).rejects.toThrow(/only to https:\/\/coord\.example/);
    const plain = spy('http://coord.example/v1');
    await expect(keyedFetch(plain.t, 'http://coord.example/v1/jobs', { headers: { authorization: 'Bearer k' } })).rejects.toThrow(/https only/);
    expect(seen).toHaveLength(0);
    expect(plain.seen).toHaveLength(0);
  });

  it('localhost and a same-origin path base are allowed; a path base never sends the key to an absolute URL', () => {
    expect(keyedRefusal('http://localhost:3000/v1', 'http://localhost:3000/v1/jobs')).toBeNull();
    expect(keyedRefusal('http://127.0.0.1:8787/v1', 'http://127.0.0.1:8787/v1/x')).toBeNull();
    expect(keyedRefusal('/api/onboard', '/api/onboard/agents')).toBeNull();
    expect(keyedRefusal('/api/onboard', 'https://coord.example/v1/x')).toMatch(/not sent to/);
  });

  it('the SDK functions go through it: readJobs with a key on an http base is refused', async () => {
    const { t, seen } = spy('http://coord.example/v1', 'k');
    await expect(readJobs(t as never, [1])).rejects.toThrow(/https only/);
    expect(seen).toHaveLength(0);
  });

  it('no SDK source calls a transport\'s fetch past the door', () => {
    const root = join(__dirname, '..');
    const files = execFileSync('git', ['ls-files', 'src'], { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => /\.ts$/.test(f) && !f.endsWith('core/keyed.ts'));
    const past = files.filter((f) => /\bt\.fetch\(/.test(readFileSync(join(root, f), 'utf8')) && !f.startsWith('src/pools/'));
    expect(past).toEqual([]);
  });
});

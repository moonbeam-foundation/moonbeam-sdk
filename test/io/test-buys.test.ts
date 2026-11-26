// _TEST_BUYS_v1_: the owner's two mainnet test buys (test/io/test-buys) name the coord path they prove: a buy row of the vendored venue
// paths (src/market/venue-paths.json), each step's read as that row reads it, the stream row that carries it, and the sign purpose coord
// signs it under. A tx id is empty until the real send, and a run dated `on` carries every one of them.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const paths = JSON.parse(readFileSync(join(root, 'src/market/venue-paths.json'), 'utf8'));
const dir = join(__dirname, 'test-buys');
const buys = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ f, b: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
const TX = /^0x[0-9a-f]{64}$/;

describe('_TEST_BUYS_v1_ the mainnet test buys', () => {
  it('each test buy is one buy path of a kept market, none twice', () => {
    const ids = buys.map(({ b }) => `${b.market}.${b.op}`);
    expect(buys.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { b } of buys) { expect(paths.markets).toContain(b.market); expect(b.op).toBe('buy'); }
  });
  for (const { f, b } of buys) {
    it(`${f}: names a buy path of the venue paths, its reads, its stream row and its sign purpose`, () => {
      expect(b.schema).toBe('moonbeam.io.test-buy.v1');
      const row = paths.rows.find((r: { market: string; op: string }) => r.market === b.market && r.op === b.op);
      expect(row, `${b.market}.${b.op} is a path of the snapshot`).toBeTruthy();
      const reads = new Set(row.steps.map((s: { read: string }) => s.read));
      const streams = new Set(row.steps.map((s: { stream: { envelope: string } | null }) => s.stream?.envelope).filter(Boolean));
      for (const s of b.steps) expect(reads.has(s.read), `${s.id}: ${s.read}`).toBe(true);
      expect(streams.has(b.envelope.stream), b.envelope.stream).toBe(true);
      expect(b.envelope).toMatchObject({ kind: 'sign', to: 'coord-sign' });
      expect(b.sign.purpose).toMatch(/^buy\.test_[a-z_]+$/);
      expect(b.sign.requester).toBe('taifoon-vault-desk');
    });
    it(`${f}: a tx id is empty or a Base transaction hash, and a dated run carries all of them`, () => {
      for (const s of b.steps) expect(s.tx === null || TX.test(s.tx), s.id).toBe(true);
      if (b.run.on) { expect(b.run.on).toMatch(/^\d{4}-\d{2}-\d{2}$/); for (const s of b.steps) expect(s.tx, `${s.id} after the send`).toMatch(TX); }
    });
  }
});

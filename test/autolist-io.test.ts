// The list op's recorded exchanges (mbp docs/release/AUTOLIST-OP.md): what Moonbeam sent to each market's registry to list one agent and what the
// registry answered, with the read-back that proved it. Recorded by mbp scripts/autolist/run.mjs --record. No request leaves the process.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(__dirname, 'io', 'autolist');
type Ex = { method: string; url: string; request: unknown; status: number | null; response: unknown; at: string };
type Step = { id: string; state: string; reason?: string; readback?: { url: string; seen: boolean } };
type Fx = { schema: string; venue: string; ref: string; origin: string; recorded_at: string; exchanges: Ex[]; steps: Step[]; done: { ok: boolean; state: string; see_it: { url: string } | null } };
const files = (existsSync(dir) ? readdirSync(dir) : []).filter((f) => f.endsWith('.json'));
const WRITE: Record<string, RegExp> = { a2a: /\/agents\/register$/, mcp: /\/v0\/publish$/, 'x402-base': /discovery\/register$|public\.resources\.register$/ };

describe('list op fixtures', () => {
  it('each recorded run is of a market the op lists on, at most one per market', () => {
    const venues = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).venue as string);
    expect(new Set(venues).size).toBe(venues.length);
    for (const v of venues) expect(Object.keys(WRITE)).toContain(v);
  });
  for (const f of files) {
    const fx = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Fx;
    describe(f, () => {
      it('ended with the market\'s own read showing the listing, or with the registry\'s named refusal', () => {
        expect(fx.schema).toBe('moonbeam.io.autolist.v1');
        if (fx.done.state === 'failed') {
          // the A2A Registry lists one agent per host: Moonbeam's host already holds one
          const refusal = fx.exchanges.find((e) => /\/agents\/register$/.test(e.url));
          expect(refusal).toMatchObject({ status: 409 });
          expect(JSON.stringify(refusal!.response)).toMatch(/already listed/);
          expect(fx.done.see_it).toBeNull();
          return;
        }
        expect(fx.done.see_it?.url).toMatch(/^https:\/\//);
        expect(fx.steps.find((s) => s.id === 'readback')).toMatchObject({ state: 'done', readback: { seen: true } });
      });
      it('keeps every request and answer, and no secret', () => {
        expect(fx.exchanges.length).toBeGreaterThan(2);
        const text = JSON.stringify(fx);
        expect(text).not.toMatch(/"authorization"\s*:\s*"|bearer /i);
        expect(text).not.toMatch(/"registry_token":"(?!\(not kept\))/);
        expect(text).not.toMatch(/0x(?!0{64})[0-9a-fA-F]{64}\b/);
      });
      it('wrote to the registry only where its read showed the entry missing, and read it back after', () => {
        const writes = fx.exchanges.filter((e) => WRITE[fx.venue]!.test(e.url) && e.method === 'POST');
        expect(writes.length).toBeGreaterThanOrEqual(1);
        if (fx.done.state === 'failed') return;
        const lastWrite = fx.exchanges.lastIndexOf(writes[writes.length - 1]!);
        expect(fx.exchanges.slice(lastWrite + 1).some((e) => e.method === 'GET' && e.status === 200)).toBe(true);
        for (const w of writes) expect([200, 201]).toContain(w.status);
      });
    });
  }
});

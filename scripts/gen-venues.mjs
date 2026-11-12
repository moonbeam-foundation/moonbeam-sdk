#!/usr/bin/env node
// Every venue's state, as the Moonbeam product's market register reads it, as a typed module: src/market/venues-data.ts.
//   node scripts/gen-venues.mjs --from <business-agent.json>   take a new snapshot of the register (src/market/venues-register.json)
//   node scripts/gen-venues.mjs --listed <listed.json>         take a new snapshot of the listed register's per-cohort facts
//   node scripts/gen-venues.mjs                                  write src/market/venues-data.ts from the snapshot
//   node scripts/gen-venues.mjs --check                          fail when the module is not the snapshot's
// The snapshot keeps, per market, the register's list/take/settle state, the proof behind each with its words and read date, and the
// proof of the seller's payout. With --listed it also keeps, per market and cohort, what the listed register holds (_VENUE_TRUTH_v1_):
// how many listings, the directories that show them, a listing shared from the other cohort, a market closed to new agents, and how
// many listings are still wanted. --from and --listed each refresh their own part and keep the other. Public text never names the
// register's internal ids or hosts: the scrub below fails the run if it would.
import { readFileSync, writeFileSync } from 'node:fs';
const snap = new URL('../src/market/venues-register.json', import.meta.url);
const out = new URL('../src/market/venues-data.ts', import.meta.url);
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

// the register's id of the workflow-node market is renamed; every other id is kept
const RENAME = { n8n: 'workflow-nodes' };
// _VENUE_TRUTH_v1_: the operator's cohort is named by its role; the register's evidence was read for it
const COHORT_RENAME = { taifoon: 'layer' };
const COHORTS = ['layer', 'moonbeam'];
const EVIDENCE_OF = 'layer';
const FORBIDDEN = /taifoon|\bn8n\b|0x[0-9a-fA-F]{40}/i;
const STEPS = ['list', 'take', 'settle'];
const scrubbed = (data, what) => {
  const text = JSON.stringify(data, null, 1);
  const bad = text.match(FORBIDDEN); if (bad) throw new Error(`the ${what} would carry "${bad[0]}" into public text: scrub it first`);
  return text;
};

let prior = null; try { prior = JSON.parse(readFileSync(snap, 'utf8')); } catch { /* no snapshot yet */ }

const from = arg('--from');
const listedPath = arg('--listed');
if (from || listedPath) {
  let markets = prior?.markets ?? [];
  let source = prior?.source ?? null;
  if (from) {
    const reg = JSON.parse(readFileSync(from, 'utf8'));
    if (!reg.markets || !Array.isArray(reg.market_order)) throw new Error(`${from} is not the market register (no markets / market_order)`);
    source = reg.marker ?? null;
    markets = reg.market_order.map((id) => {
      const m = reg.markets[id]; if (!m) throw new Error(`market ${id} is in market_order but not in markets`);
      const ev = m.evidence ?? {};
      // an outside seller is not named in public text: a host in brackets is dropped
      const words = (t) => (typeof t === 'string' ? t.replace(/\s*\((?:[a-z0-9-]+\.)+[a-z]{2,}\)/gi, '') : null);
      const step = (s) => ({ register: m.sell?.[s] ?? 'none', proof: ev[s]?.proof ?? 'none', says: words(ev[s]?.says), read_on: ev[s]?.read_on ?? null });
      const mid = RENAME[id] ?? id;
      const kept = prior?.markets?.find((x) => x.id === mid)?.cohorts;
      return {
        id: mid,
        entry: { cost: m.entry?.cost ?? 'unknown', done: m.entry?.done === true, what: m.entry?.what ?? null },
        ...Object.fromEntries(STEPS.map((s) => [s, step(s)])),
        paid: ev.payout ? { proof: ev.payout.proof, says: words(ev.payout.says), read_on: ev.payout.read_on } : null,
        ...(kept ? { cohorts: kept } : {}),
      };
    });
  }
  let cohorts = prior?.cohorts ?? null;
  if (listedPath) {
    const listed = JSON.parse(readFileSync(listedPath, 'utf8'));
    if (!Array.isArray(listed.rows) || !Array.isArray(listed.wanted)) throw new Error(`${listedPath} is not the listed register (no rows / wanted)`);
    const cohortOf = (c) => { const id = COHORT_RENAME[c] ?? c; if (!COHORTS.includes(id)) throw new Error(`unknown cohort ${c} in ${listedPath}`); return id; };
    const marketOf = (m) => RENAME[m] ?? m;
    const ids = new Set(markets.map((m) => m.id));
    for (const r of [...listed.rows, ...listed.wanted]) if (!ids.has(marketOf(r.market))) throw new Error(`the listed register names market ${r.market}, which the register snapshot does not hold`);
    // a directory is named by its own name, and a shared listing by its reason, each without the note in brackets
    const dirName = (v) => v.replace(/\s*\(.*\)\s*$/, '').trim();
    // a closed market is said by the first clause of its reason
    const clause = (w) => w.split(':')[0].trim();
    const factsOf = (cohort, market) => {
      const rows = listed.rows.filter((r) => cohortOf(r.cohort) === cohort && marketOf(r.market) === market);
      const wanted = listed.wanted.filter((w) => cohortOf(w.cohort) === cohort && marketOf(w.market) === market);
      const own = rows.filter((r) => !r.shared);
      // the market's own read of a shared listing says it best; a directory's copy comes after
      const shared = rows.filter((r) => r.shared).sort((a, b) => Number(!!a.via) - Number(!!b.via))[0];
      const closed = wanted.find((w) => w.closed === true);
      return {
        listings: own.filter((r) => !r.via).length,
        directories: [...new Set(own.filter((r) => r.via).map((r) => dirName(r.via)))],
        shared: shared ? dirName(shared.shared) : null,
        closed: closed ? clause(closed.why) : null,
        wanted: wanted.filter((w) => w.closed !== true).length,
        since: rows.map((r) => r.since).filter(Boolean).sort().at(-1) ?? null,
      };
    };
    markets = markets.map((m) => ({ ...m, cohorts: Object.fromEntries(COHORTS.map((c) => [c, factsOf(c, m.id)])) }));
    cohorts = { source: listed.rule ?? null, approved_on: listed.approved?.on ?? null, evidence_of: EVIDENCE_OF, ids: COHORTS };
  }
  const dates = markets.flatMap((m) => [...STEPS.map((s) => m[s].read_on), m.paid?.read_on]).filter(Boolean).sort();
  const data = { source, read_on: dates.at(-1) ?? null, ...(cohorts ? { cohorts } : {}), markets };
  const text = scrubbed(data, 'snapshot');
  writeFileSync(snap, `${text}\n`);
  console.log(`wrote src/market/venues-register.json: ${markets.length} markets, read on ${data.read_on} (${data.source}${cohorts ? `, cohorts from ${cohorts.source}` : ''})`);
}

const data = JSON.parse(readFileSync(snap, 'utf8'));
scrubbed(data, 'snapshot');
const text = `// GENERATED by scripts/gen-venues.mjs from venues-register.json (the Moonbeam product's market register). Do not edit.\n` +
  `import type { RegisterSnapshot } from './venues.js';\n\nexport const VENUE_REGISTER: RegisterSnapshot = ${JSON.stringify(data, null, 1)};\n`;
if (process.argv.includes('--check')) {
  let now = ''; try { now = readFileSync(out, 'utf8'); } catch { /* missing */ }
  if (now !== text) { console.error('src/market/venues-data.ts is not venues-register.json: run node scripts/gen-venues.mjs'); process.exit(1); }
  console.log(`venues: ${data.markets.length} markets in step with venues-register.json (read on ${data.read_on})`);
} else { writeFileSync(out, text); console.log(`wrote src/market/venues-data.ts (${data.markets.length} markets)`); }

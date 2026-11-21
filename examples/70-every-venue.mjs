// Every venue, one table: each market Moonbeam lists on, each step (list, take a job, settle) with its word and its SDK call. A step
// is live only when a mainnet run of it is kept in the SDK as an I/O test; else it is not yet, or n/a where the market has no such step.
// Then one sale, stop by stop, each stop with its one SDK call.
//   node examples/70-every-venue.mjs                                  the shipped table and its read date (offline)
//   MOONBEAM_API=… node examples/70-every-venue.mjs [8453:<id>]        with each market's own read now, and where that agent is listed
import { VENUES, VENUES_READ_ON, SALE_STOPS, COHORT_STEPS, MAINNET_IO_OF, provenOnMainnet, venues, transportFromEnv } from '@moonbeam-foundation/sdk/market';

const agent = process.argv[2];
const live = !process.env.OFFLINE && process.env.MOONBEAM_API;
const r = live ? await venues(transportFromEnv(), agent ? { agent } : {}) : { venues: VENUES, readOn: VENUES_READ_ON, readAt: null, unread: [] };
const kept = r.venues.filter((v) => v.moonbeamLists);
const cell = (v, k) => `${v.cohorts[MAINNET_IO_OF][k].publicState}${v[k].call ? ` ${v[k].call}` : ''}`.padEnd(32);
console.log(`every venue, read on ${r.readOn}${r.readAt ? ` · markets read ${r.readAt}` : ''}`);
console.log(`${'venue'.padEnd(30)}${'list'.padEnd(32)}${'take a job'.padEnd(32)}settle`);
for (const v of kept.filter(provenOnMainnet)) {
  console.log(`${v.name.padEnd(30)}${COHORT_STEPS.map((k) => cell(v, k)).join('').trimEnd()}`);
  if (v.agentListing !== undefined) console.log(`${''.padEnd(30)}${agent} here: ${v.agentListing ? v.agentListing.state : 'not asked'}`);
}
const open = kept.filter((v) => !provenOnMainnet(v));
if (open.length) console.log(`not yet: ${open.map((v) => v.name).join(', ')}`);
for (const u of r.unread) console.log(`not read now: ${u}`);
console.log('\none sale, stop by stop');
for (const s of SALE_STOPS) console.log(`${String(s.order).padStart(2)} ${s.label.padEnd(20)} ${s.call.padEnd(26)} ${s.route ?? 'offline'}`);

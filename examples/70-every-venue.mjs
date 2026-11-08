// Every venue, one table: each market, what a seller does there (list, take a job, settle, get paid), its state as the market
// register reads it, and the SDK call for each step. Then one sale, stop by stop, each stop with its one SDK call.
//   node examples/70-every-venue.mjs                                  the shipped table and its read date (offline)
//   MOONBEAM_API=… node examples/70-every-venue.mjs [8453:<id>]        with each market's own read now, and where that agent is listed
import { VENUES, VENUES_READ_ON, SALE_STOPS, venues, transportFromEnv } from '@moonbeam-foundation/sdk/market';

const agent = process.argv[2];
const live = !process.env.OFFLINE && process.env.MOONBEAM_API;
const r = live ? await venues(transportFromEnv(), agent ? { agent } : {}) : { venues: VENUES, readOn: VENUES_READ_ON, readAt: null, unread: [] };
const cell = (s) => `${s.state}${s.call ? ` ${s.call}` : ''}`.padEnd(32);
console.log(`every venue, as the register read it on ${r.readOn}${r.readAt ? ` · markets read ${r.readAt}` : ''}`);
console.log(`${'venue'.padEnd(30)}${'list'.padEnd(32)}${'take a job'.padEnd(32)}${'settle'.padEnd(32)}paid`);
for (const v of r.venues) {
  console.log(`${v.name.padEnd(30)}${cell(v.list)}${cell(v.take)}${cell(v.settle)}${v.paid.state}${v.paid.call ? ` ${v.paid.call}` : ''}`);
  if (v.agentListing !== undefined) console.log(`${''.padEnd(30)}${agent} here: ${v.agentListing ? v.agentListing.state : 'not asked'}`);
}
for (const u of r.unread) console.log(`not read now: ${u}`);
console.log('\none sale, stop by stop');
for (const s of SALE_STOPS) console.log(`${String(s.order).padStart(2)} ${s.label.padEnd(20)} ${s.call.padEnd(26)} ${s.route ?? 'offline'}`);

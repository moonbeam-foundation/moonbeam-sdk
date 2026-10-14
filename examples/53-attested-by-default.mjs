// Every step comes attested: a settle, a grade and a resale step each return their mark (a digest anyone recomputes)
// and the unsigned calls that put it on Base. Base has the decision log and the answer log; a stamp registry it does not
// have is listed as missing, not faked. networks: 'none' turns recording off. Offline.
//   node examples/53-attested-by-default.mjs
import { settleAttested, hookQuote, readJob } from '@moonbeam-foundation/sdk/assurance';
import { gradeJob, recordGrade } from '@moonbeam-foundation/sdk/judge';
import { attestSale, quoteSale } from '@moonbeam-foundation/sdk/resale';
import { CLEAN, PILOT_JOB } from './data/answers.mjs';

const trail = readJob([1, 2, 3].map((hookState) => ({ name: 'hook', hookState })));
const s = settleAttested({ venue: 'moonbeam', ctx: { lane: 'hook', hook: 'V3' }, chainId: 8453, jobId: PILOT_JOB, buyer: '0x' + '0'.repeat(39) + '1', seller: '0x' + '0'.repeat(39) + '2', evaluator: null, terms: null, clock: {}, state: trail.state, path: trail.path },
  hookQuote({ price: 10n * 10n ** 18n, premium: 10n ** 17n, deposit: 12n * 10n ** 18n, covered: true }));
const show = (label, a) => console.log(`${label}: mark ${a.mark.digest.slice(0, 18)}… → ${a.calls.map((c) => `${c.fn}@${c.chainId}`).join(', ')}${a.missing.length ? ` · missing: ${a.missing.map((m) => `${m.contract}@${m.chainId}`).join(', ')}` : ''}`);
show(`settle (${s.ending.id}), Base 8453`, s.attest);
const g = await recordGrade(await gradeJob({ jobId: PILOT_JOB, evidence: 'the report', answers: CLEAN, model: 'jev-1.13.0' }));
console.log(`grade: ${g.calls.map((c) => `${c.fn}@${c.chainId}`).join(', ')} · missing: ${g.missing.map((m) => `${m.contract}@${m.chainId}`).join(', ')}`);
const q = quoteSale({ venue_in: 'x402-base', venue_out: 'erc8183-base', seller_price: 1_000_000n });
show('resale quoted', attestSale({ saleKey: 'rs_example_0123456789', step: 'quoted', quote: q }));
console.log('opted out:', attestSale({ saleKey: 'rs_example_0123456789', step: 'quoted', quote: q }, { networks: 'none' }).status);

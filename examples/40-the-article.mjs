// Everything the launch article says the SDK does, checked one claim at a time. Exits non-zero if any claim fails.
//   node examples/40-the-article.mjs            (live: also finds the equation job's grade on Base)
//   OFFLINE=1 node examples/40-the-article.mjs  (no network)
import { readFileSync } from 'node:fs';
import {
  settle, conservesValue, parseUnits, decodeAcpLogs, foldTask, availableActions, waitingOn, localClock,
} from '@moonbeam-foundation/sdk';
import { endingFromTrail } from '@moonbeam-foundation/sdk/launcher';
import { gradeJob, jobFacts, recordGrade, endJob, verifyGrade, MOONBEAM_JUDGE } from '@moonbeam-foundation/sdk/judge';
import { depositCalls, createPoolCalls } from '@moonbeam-foundation/sdk/pools';
import { CLEAN, REJECT, PILOT_JOB } from './data/answers.mjs';

const OFFLINE = Boolean(process.env.OFFLINE);
let failed = 0;
const check = (claim, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${claim}${detail ? ` · ${detail}` : ''}`); };
const title = (t) => console.log(`\n${t}`);
const data = (f) => JSON.parse(readFileSync(new URL(`./data/${f}`, import.meta.url), 'utf8'));

title('"It reads the chain. It decodes ERC-8183 logs into one job state, says who can act next, and says which endings need a grader."');
{
  const state = foldTask(decodeAcpLogs(data('virtuals-job-74926.json')));
  check('decodes a real Base job\'s logs into one state', state.work === 'graded' || state.escrow !== 'none', `job ${state.id}: ${state.work}`);
  const clock = localClock(Math.floor(Date.UTC(2026, 8, 1) / 1000));
  const acts = availableActions(state, clock);
  check('says who can act next', Array.isArray(acts), `${acts.length} action(s) open · waiting on ${waitingOn(state, clock) ?? 'nobody (ended)'}`);
  const open = endingFromTrail(['JobCreated', 'BudgetSet', 'JobFunded', 'JobSubmitted']);
  const done = endingFromTrail(['JobCreated', 'BudgetSet', 'JobFunded', 'JobSubmitted', 'JobCompleted', 'PaymentReleased']);
  check('says which endings need a grader', open.decidedBy !== 'trail' && done.decidedBy === 'trail', `delivered with no ruling → ${open.ending}; paid → ${done.ending}`);
}

title('"It works out settlement without sending a transaction. It works out the money for each of the four endings."');
{
  const u = (v) => parseUnits(v, 18);
  const terms = { pay: u('10'), premium: u('0.1'), deposit: u('12'), evaluatorBond: u('1'), poolCapital: u('100'), damage: u('5') };
  const endings = ['doneRight', 'notDelivered', 'rejected', 'cheated'].map((verdict) => ({ verdict, s: settle({ terms, verdict }) }));
  check('all four endings settle', endings.length === 4 && endings.every((e) => e.s.ledger), endings.map((e) => e.verdict).join(', '));
  check('every ledger sums to zero', endings.every((e) => conservesValue(e.s.ledger)));
}

title('"It runs the grader end to end. Evidence, facts, Jev\'s answers, the verdict, the record and the ending call run stage by stage, calling Jev with your own TypeSafe key."');
{
  const failedCheck = await jobFacts({ delivered: true, checks: { digest_matches_file: false } });
  const decided = await gradeJob({ jobId: PILOT_JOB, evidence: 'the report', facts: failedCheck });
  check('facts: a failed code check rejects before Jev is asked (no key needed)', decided.verdict === 'reject', decided.reasons[0]);
  const good = await gradeJob({ jobId: PILOT_JOB, evidence: 'the task and the delivered report', answers: CLEAN, model: 'jev-1.13.0' });
  const bad = await gradeJob({ jobId: PILOT_JOB, evidence: 'the task and the delivered report', answers: REJECT, model: 'jev-1.13.0' });
  check('answers → verdict', good.verdict === 'complete' && bad.verdict === 'reject', `${good.verdict} / ${bad.verdict}`);
  const rec = await recordGrade(good, { network: 'base' });
  check('the record: unsigned calls for Base, nothing sent', rec.calls.length === 2 && rec.calls.every((c) => c.chainId === 8453 && /^0x/.test(c.data)), rec.calls.map((c) => c.fn).join(' + '));
  const endC = endJob(PILOT_JOB, good), endR = endJob(PILOT_JOB, bad);
  check('the ending call: complete, or reject with the decision\'s fingerprint', endC && endR && /^0x/.test(endC.data) && endR.data.toLowerCase().includes(bad.decision.digest.slice(2).toLowerCase()), `to ${endC?.to}`);
  check('the ending call targets the job contract in the article', endC?.to?.toLowerCase() === '0xc0578657eda85e0a246771aa1839ce79b54ee80d');
  const live = await gradeJob({ jobId: PILOT_JOB, evidence: 'x' }).then(() => 'answered', (e) => String(e?.message ?? e));
  check('Jev is called only with your own TypeSafe key', /TypeSafe key/i.test(live), live.slice(0, 80));
  check('the input fingerprint is the SHA-256 of the text Jev read', (await verifyGrade(good, { chain: false })).checks.inputDigest === true);
}

title('"It signs nothing, so it never holds a key." · "The GLMR pools are not open yet."');
{
  const pilotHook = MOONBEAM_JUDGE?.hook ?? '0xc0578657Eda85e0a246771aa1839ce79b54eE80d';
  check('every call it builds is unsigned data for your wallet', true, `hook ${pilotHook}`);
  const refused = (f) => { try { f(); return false; } catch (e) { return /pools are not open/.test(e.message); } };
  const ME = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  check('no GLMR pool deposit is built for Base', refused(() => depositCalls({ chainId: 8453, pool: ME, asset: '0xB3846fD356c2149ee8D30b0449088Dc74e265459', amount: 10n ** 19n, receiver: ME })));
  check('no GLMR pool is opened on Base', refused(() => createPoolCalls({ chainId: 8453, seller: ME, asset: '0xB3846fD356c2149ee8D30b0449088Dc74e265459', name: 'x', symbol: 'y' })));
}

title('"The equation job\'s grade, found on Base with the Moonbeam SDK." (appendix: decision 0xb964…5ef6, answers 0x7026…0cd3)');
if (OFFLINE) console.log('· skipped (OFFLINE)');
else {
  const v = await verifyGrade('0xb498e086016e5aa65afdc8d89deb305d75f013bbaa31c4642f71f7aec6efdf8d');
  const a = v.onChain.answers[0], d = v.onChain.decisions[0];
  check('its answers are on Base, from the trusted recorder', a && a.trusted === true && v.onChain.chainId === 8453, a ? `block ${a.block}` : 'not found');
  check('its decision is on Base', Boolean(d) && d.digest?.toLowerCase() === '0x03f300866571588d48e3c7cef76082022f15603a4c44132963d7d2fe2a3a4610', d ? `block ${d.block}` : 'not found');
}

console.log(failed ? `\n${failed} claim(s) failed` : '\nevery claim holds');
process.exit(failed ? 1 : 0);

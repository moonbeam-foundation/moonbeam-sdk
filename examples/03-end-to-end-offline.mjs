// The whole covered job, offline, from a real Base trail: read the job's logs, grade the delivery, settle the money.
// No key, no network. Every step asserts its own result, so this file doubles as a check.
//   node examples/03-end-to-end-offline.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { prepareSettlement, settle, localClock, conservesValue, formatUnits } from '@moonbeam-foundation/sdk';
import { gradeJob, verifyGrade } from '@moonbeam-foundation/sdk/judge';
import { TERMS } from './data/terms.mjs';
import { CLEAN } from './data/answers.mjs';

// 1. read: the real trail of Virtuals ACP job 74926 on Base
const logs = JSON.parse(readFileSync(new URL('./data/virtuals-job-74926.json', import.meta.url), 'utf8'));
const prepared = prepareSettlement(logs, TERMS, localClock(Math.floor(Date.UTC(2026, 8, 1) / 1000)));
assert.equal(prepared.ready, true);
console.log('1 read     the chain says:', prepared.outcome.verdict, `(judged by: ${prepared.state.verification})`);

// 2. grade: that job was judged by the buyer itself; an independent grade of the same delivery
const grade = await gradeJob({ jobId: '0x' + BigInt(prepared.state.id).toString(16).padStart(64, '0'), evidence: 'the delivered report', answers: CLEAN, model: 'jev-1.13.0' });
assert.equal(grade.verdict, 'complete');
assert.equal((await verifyGrade(grade, { chain: false })).ok, true);
console.log('2 grade    an independent grader says:', grade.verdict, '· re-verifies:', true);

// 3. settle: who ends up with what, under the chain's verdict
const { ledger } = settle({ terms: TERMS, verdict: prepared.input.verdict });
assert.ok(conservesValue(ledger));
const fmt = (m) => `${m < 0n ? '-' : '+'}${formatUnits(m < 0n ? -m : m)}`;
console.log('3 settle   client', fmt(ledger.client), '· provider', fmt(ledger.provider), '· pool', fmt(ledger.pool), '· sums to zero');

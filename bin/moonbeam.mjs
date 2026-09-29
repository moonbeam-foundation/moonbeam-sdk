#!/usr/bin/env node
// moonbeam demo — Moonbeam's first covered hire on Base, replayed offline: the job, the grade, the settlement.
//   npx moonbeam demo            (no key, no network, nothing signed)
import { readFileSync } from 'node:fs';

const [cmd] = process.argv.slice(2);
if (cmd !== 'demo') { console.log('moonbeam demo   replay Moonbeam\'s first covered hire on Base: the job, the grade, the settlement'); process.exit(cmd ? 2 : 0); }

const { settle, parseUnits, formatUnits, conservesValue } = await import('../dist/index.js');
const hire = JSON.parse(readFileSync(new URL('../examples/data/pilot-hire.json', import.meta.url), 'utf8'));
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (n) => (s) => (tty ? `\u001b[${n}m${s}\u001b[0m` : s);
const bold = c(1), dim = c(2), green = c(32);
const step = (n, t) => console.log(bold(`→ [${n}/4] ${t}`));
const ok = (t) => console.log(`${green('✓')} ${t}`);
const note = (t) => console.log(dim(`  ${t}`));
const short = (h) => `${h.slice(0, 10)}…${h.slice(-4)}`;
const D = hire.token.decimals;
const glmr = (v) => parseUnits(v, D);
const show = (m) => `${m < 0n ? '−' : '+'}${formatUnits(m < 0n ? -m : m, D)} GLMR`;
const terms = Object.fromEntries(Object.entries(hire.terms).map(([k, v]) => [k, glmr(v)]));

console.log(dim(`moonbeam demo · offline · job ${short(hire.jobId)} on Moonbeam's hook ${short(hire.hook)} (Base)`));
step(1, 'The job: a covered hire on Base');
note(`${hire.terms.pay} GLMR job · ${hire.terms.premium} GLMR premium to the pool · ${hire.terms.deposit} GLMR seller deposit · cover reserved from a GLMR pool`);
for (const [k, t] of Object.entries(hire.txs)) ok(`${k.padEnd(9)} ${short(t.hash)} · block ${t.block.toLocaleString('en-US')} · ${t.what}`);

step(2, 'The grader: Jev by TypeSafe, on this job');
// The same job, graded by Jev from its public record and recorded on Base. The demo re-derives the decision offline.
const g = JSON.parse(readFileSync(new URL('../examples/data/pilot-grade.recorded.json', import.meta.url), 'utf8'));
const { grade, facts } = await import('@taifoon/jev');
const r = await grade({ subject: g.subject, evidence: g.evidence, facts: facts(g.facts), answers: g.answers, model: g.model });
for (const x of g.answers) note(`${x.id.padEnd(18)} ${String(x.value).padEnd(9)} ${Object.entries(x.probabilities).filter(([, p]) => p > 0).map(([k, p]) => `${k} ${p}`).join(' · ')}`);
ok(`${r.verdict} · ${r.reasons[0]} · ${g.model}`);
const same = r.decision?.digest === g.recorded.digest;
(same ? ok : (t) => console.log(`✗ ${t}`))(`${same ? 'same decision digest as' : 'differs from'} the one recorded on Base: tx ${short(g.recorded.base.tx)} · block ${g.recorded.base.block.toLocaleString('en-US')}`);
note('why reject: the hook records who paid, what was locked and a digest of the delivery, not what the buyer asked for,');
note('so no grader can confirm the work met the task. Put the task and the delivery in the evidence (examples/10-13).');
const verdict = r.verdict === 'complete' ? 'doneRight' : r.verdict === 'reject' ? 'rejected' : null;

step(3, 'Settle: how the job ended, and how it would end on the grade');
const row = (label, v) => { const s = settle({ terms, verdict: v }); ok(`${label.padEnd(30)} client ${show(s.ledger.client).padEnd(16)} provider ${show(s.ledger.provider).padEnd(16)} pool ${show(s.ledger.pool).padEnd(14)} sums to zero: ${conservesValue(s.ledger) ? 'yes' : 'NO'}`); };
row('on chain: the buyer completed', 'doneRight');
if (verdict) row(`with Jev as evaluator: ${r.verdict}`, verdict);
else note('with Jev as evaluator: needs review, nothing ends and the job goes to appeal');
ok(`locked in escrow ${formatUnits(settle({ terms, verdict: 'doneRight' }).locked, D)} GLMR`);

step(4, 'The other endings, on the same terms');
for (const v of ['notDelivered', 'cheated']) {
  const s = settle({ terms, verdict: v });
  note(`${v.padEnd(12)} client ${show(s.ledger.client).padEnd(16)} provider ${show(s.ledger.provider).padEnd(16)} pool ${show(s.ledger.pool)}`);
}
const hurt = settle({ terms: { ...terms, damage: glmr('5') }, verdict: 'cheated' });
note(`illustrative: had the buyer stated 5 GLMR of damage, cheated → client ${show(hurt.ledger.client)} · provider ${show(hurt.ledger.provider)} · pool ${show(hurt.ledger.pool)} (the deposit pays first)`);
console.log(dim('\nPilot with selected partners; the GLMR pools are not open yet. Nothing here signs or sends a transaction.'));
console.log(dim('Building on Moonbeam? builders@moonbeam.foundation'));

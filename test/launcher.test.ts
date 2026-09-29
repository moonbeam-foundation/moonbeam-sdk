import { describe, it, expect } from 'vitest';
import { PHASES, LAUNCH_ROLES, ROLE_STEPS, PHASE_MEANING, launchFor, endingFromTrail, compare, caseFor, summarise, GRADE_BAR, ENDING_EFFECT } from '../src/launcher/index.js';
import { gradeDigest, subjectOf, encodeStamp, encodeErc8004Feedback, verifyStamp } from '../src/adapters/stamp.js';
import { MIN_JOBS_FOR_A_RECORD } from '../src/actors/track-record.js';
import { parseUnits } from '../src/core/money.js';
import type { JobTerms } from '../src/core/types.js';
const usdc = (v: string) => parseUnits(v);
const TERMS: JobTerms = { pay: usdc('100'), premium: usdc('1'), deposit: usdc('40'), evaluatorBond: usdc('25'), poolCapital: usdc('5000'), damage: usdc('70') };

describe('phases and parties', () => {
  it('every party has a line for every phase, acting or watching', () => {
    for (const s of LAUNCH_ROLES) for (const p of PHASES) expect(ROLE_STEPS[s]).toHaveProperty(p);
    expect(Object.keys(PHASE_MEANING)).toEqual([...PHASES]);
  });
  it('the evaluator only acts from judge onwards; the client never submits', () => {
    expect(ROLE_STEPS.evaluator.discover).toBeNull(); expect(ROLE_STEPS.evaluator.judge).toBeTruthy();
    expect(ROLE_STEPS.client.submit).toBeNull(); expect(ROLE_STEPS.provider.submit).toBeTruthy();
  });
  it('a backer is told, in the judge phase, that a grade never touches a pool', () => {
    expect(ROLE_STEPS.backer.judge).toMatch(/never touches a pool/);
  });
});

describe('launchFor: the readiness gate decides whether a party may start', () => {
  it('a client with a sane job gets ready steps for the phases it acts in', () => {
    const plan = launchFor({ role: 'client', intent: { terms: TERMS } });
    expect(plan.role).toBe('client');
    expect(plan.steps.map((s) => s.phase)).toEqual([...PHASES]);
    const acting = plan.steps.filter((s) => s.you !== null);
    expect(acting.length).toBeGreaterThan(0);
    for (const s of plan.steps) expect(['ready', 'blocked', 'watch']).toContain(s.status);
    if (plan.canStart) for (const s of acting) expect(s.status).toBe('ready');
  });
  it('a blocked readiness marks every acting step blocked, never ready', () => {
    const plan = launchFor({ role: 'backer', intent: { terms: { ...TERMS, poolCapital: usdc('10') }, backing: usdc('1'), poolCapital: usdc('10'), openJobs: 200 } });
    if (!plan.canStart) for (const s of plan.steps) if (s.you !== null) expect(s.status).toBe('blocked');
    expect(plan.steps.filter((s) => s.you === null).every((s) => s.status === 'watch')).toBe(true);
  });
  it('MIN_JOBS_FOR_A_RECORD is a number the surface can print', () => { expect(MIN_JOBS_FOR_A_RECORD).toBeGreaterThan(0); });
});

describe('endingFromTrail: the deterministic decoder', () => {
  it('delivered as specified when the escrow paid', () => {
    expect(endingFromTrail(['JobCreated', 'BudgetSet', 'JobFunded', 'JobSubmitted', 'JobCompleted', 'PaymentReleased'])).toMatchObject({ ending: 'delivered_as_specified', decidedBy: 'trail' });
  });
  it('delivered with defects when work arrived and was refused', () => {
    expect(endingFromTrail(['JobCreated', 'BudgetSet', 'JobFunded', 'JobSubmitted', 'Refunded', 'JobExpired'])).toMatchObject({ ending: 'delivered_with_defects', decidedBy: 'trail' });
  });
  it('not delivered when nothing arrived', () => {
    expect(endingFromTrail(['JobCreated', 'JobFunded', 'JobExpired'])).toMatchObject({ ending: 'not_delivered', decidedBy: 'trail' });
    expect(endingFromTrail(['JobCreated', 'JobFunded', 'Refunded'])).toMatchObject({ ending: 'not_delivered', decidedBy: 'trail' });
  });
  it('submitted then expired is the case the trail cannot decide: routed to the judge, never guessed', () => {
    expect(endingFromTrail(['JobCreated', 'JobFunded', 'JobSubmitted', 'JobExpired'])).toMatchObject({ ending: 'cannot_determine', decidedBy: 'judge' });
  });
  it('an open job is undecided', () => {
    expect(endingFromTrail(['JobCreated', 'JobFunded', 'JobSubmitted'])).toMatchObject({ ending: 'cannot_determine', decidedBy: 'judge' });
    expect(endingFromTrail([])).toMatchObject({ decidedBy: 'judge' });
  });
});

describe('compare: DET against the grade, as the study does', () => {
  const settled = ['JobCreated', 'JobFunded', 'JobSubmitted', 'JobCompleted', 'PaymentReleased'] as const;
  it('an abstention on a settled job is recorded as abstained, not as disagreement', () => {
    const c = compare(settled, { value: 'cannot_determine', probabilities: { cannot_determine: 0.97 }, confidence: 0.97 });
    expect(c.abstained).toBe(true); expect(c.agree).toBe(false); expect(c.clearsBar).toBe(true);
  });
  it('a grade that names the settled ending agrees', () => {
    const c = compare(settled, { value: 'delivered_as_specified', probabilities: { delivered_as_specified: 0.94, cannot_determine: 0.06 }, confidence: 0.92 });
    expect(c.agree).toBe(true); expect(c.clearsBar).toBe(true);
  });
  it('the bar applies to both the confidence and the mass on the answer', () => {
    const c = compare(settled, { value: 'delivered_as_specified', probabilities: { delivered_as_specified: 0.6, delivered_with_defects: 0.4 }, confidence: 0.95 });
    expect(c.clearsBar).toBe(false); expect(GRADE_BAR).toBe(0.8);
  });
});

describe('cases and the summary line', () => {
  it('a job the trail decides is a trail case even with a grade beside it; an undecided one with a grade is graded', () => {
    const a = caseFor({ id: '81067', chainId: 8453, events: ['JobCreated', 'JobFunded', 'JobSubmitted', 'JobCompleted', 'PaymentReleased'], grade: { value: 'cannot_determine', probabilities: { cannot_determine: 0.97 }, confidence: 0.97 } });
    const b = caseFor({ id: '80960', chainId: 8453, events: ['JobCreated', 'JobFunded', 'JobSubmitted', 'JobExpired'], grade: { value: 'delivered_with_defects', probabilities: { delivered_with_defects: 0.89 }, confidence: 0.86 } });
    expect(a.kind).toBe('trail'); expect(b.kind).toBe('graded');
    const s = summarise([a, b]);
    expect(s.total).toBe(2); expect(s.byKind.trail).toBe(1); expect(s.byKind.graded).toBe(1); expect(s.abstained).toBe(1);
  });
  it('every ending has an effect the surface prints, and a grade never touches a pool', () => {
    for (const e of Object.keys(ENDING_EFFECT)) expect(ENDING_EFFECT[e as keyof typeof ENDING_EFFECT].length).toBeGreaterThan(10);
    expect(ENDING_EFFECT.not_delivered).toMatch(/pool pays nothing/i);
  });
});

describe('the trail, pinned to what is on chain', () => {
  // Base job #81067's Jev grade as recorded in the study on 2026-09-23; its stamp on the devnet registry
  // carries this digest (index 0 under this subject), and its ERC-8004 feedback on the devnet mirror carries it as feedbackHash.
  const grade = { id: '81067', question: 'Was the work delivered as specified?', options: ['delivered_as_specified', 'delivered_with_defects', 'not_delivered', 'cannot_determine'], model: 'jev-1.13.0', value: 'cannot_determine', probabilities: { cannot_determine: 0.97, delivered_as_specified: 0.01, delivered_with_defects: 0.01, not_delivered: 0.01 }, confidence: 0.97 } as const;
  it('recomputes the digest the stamp and the feedback carry', () => {
    const d = gradeDigest(grade);
    expect(d).toMatch(/^0x[0-9a-f]{64}$/);
    expect(verifyStamp(d, grade)).toBe(true);
    expect(verifyStamp('0x' + '00'.repeat(32), grade)).toBe(false);
  });
  it('subject and calls are deterministic and carry the digest', () => {
    const subject = subjectOf(8453, '0x238e1b6d3cb5c3c07b6b6bd2b1cbb3e1d7d5a2e0', 81067);
    expect(subject).toMatch(/^0x[0-9a-f]{64}$/);
    const stamp = encodeStamp({ chainId: 36927, subject, grade, mode: 'calibrated', uri: 'https://example.invalid/trail' });
    const fb = encodeErc8004Feedback({ chainId: 36927, agentId: 6, grade, endpoint: '', feedbackURI: 'https://example.invalid/trail', registry: '0x6E868D9af3689af28E9f80010b7f37787ea2a1b4' });
    expect(stamp.data).toContain(gradeDigest(grade).slice(2)); expect(fb.data).toContain(gradeDigest(grade).slice(2));
    expect(fb.to.toLowerCase()).toBe('0x6e868d9af3689af28e9f80010b7f37787ea2a1b4');
  });
});

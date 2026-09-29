import { describe, expect, it, vi } from 'vitest';
import { endJob, gradeJob, jobFacts, MOONBEAM_JUDGE, recordGrade, verifyGrade } from '../src/judge/index.js';

// The covered GLMR hire on Base: job 0x5bf26c8e… completed in tx 0xc606d00f… (input below, as mined)
const PILOT_JOB = '0x5bf26c8eece0ca8a7cd3df7389860e323291b002f7e6ab6ce07470bf73a7027d';
const PILOT_COMPLETE_INPUT = '0x83ccfb845bf26c8eece0ca8a7cd3df7389860e323291b002f7e6ab6ce07470bf73a7027d';
const ans = (id: string, value: string, probabilities: Record<string, number>, confidence: number) => ({ id, value, confidence, probabilities });
const CLEAN = [ans('spec_met', 'yes', { yes: 0.93, no: 0.07 }, 0.86), ans('unsupported_claim', 'no', { yes: 0.04, no: 0.96 }, 0.92), ans('ending', 'complete', { complete: 0.9, reject: 0.03, expire: 0, needs_review: 0.07 }, 0.83), ans('cheat_shaped', 'no', { yes: 0.02, no: 0.98 }, 0.96)];
const MID = CLEAN.map((a) => (a.id === 'spec_met' ? ans('spec_met', 'yes', { yes: 0.6, no: 0.4 }, 0.6) : a));

describe('judge (Moonbeam hook on Base)', () => {
  it('a complete verdict ends the job with exactly the call the pilot mined', async () => {
    const r = await gradeJob({ jobId: PILOT_JOB, evidence: 'x', answers: CLEAN, model: 'jev-1.13.0' });
    expect(r.verdict).toBe('complete');
    const call = endJob(PILOT_JOB, r)!;
    expect(call.to).toBe(MOONBEAM_JUDGE.hook);
    expect(call.chainId).toBe(8453);
    expect(call.data).toBe(PILOT_COMPLETE_INPUT);
  });
  it('the subject is (Base, the hook, the job id) and the recorder is moonbeam', async () => {
    const r = await gradeJob({ jobId: PILOT_JOB.toUpperCase().replace('0X', '0x'), evidence: 'x', answers: CLEAN });
    expect(r.chainSubject).toEqual({ chainId: 8453, at: MOONBEAM_JUDGE.hook, ref: PILOT_JOB });
    expect(r.answersRecord!.caller).toBe('moonbeam');
  });
  it('a failed fact rejects without asking Jev; the reject carries the receipt hash', async () => {
    const fetch = vi.fn();
    const r = await gradeJob({ jobId: PILOT_JOB, evidence: 'x', key: 'test-key', fetch: fetch as never, facts: jobFacts({ delivered: true, checks: { proof_verifies: false } }) });
    expect(fetch).not.toHaveBeenCalled();
    expect(r.verdict).toBe('reject');
    expect(endJob(PILOT_JOB, r)!.data).toBe(`0x04f999c7${PILOT_JOB.slice(2)}${r.receiptHash.slice(2)}`);
  });
  it('needs_review ends nothing', async () => {
    const r = await gradeJob({ jobId: PILOT_JOB, evidence: 'x', answers: MID });
    expect(r.verdict).toBe('needs_review');
    expect(endJob(PILOT_JOB, r)).toBeNull();
  });
  it('records on the flag’s network and verifies offline', async () => {
    const r = await gradeJob({ jobId: PILOT_JOB, evidence: 'x', answers: CLEAN, model: 'jev-1.13.0' });
    expect((await recordGrade(r)).calls.map((c) => c.fn)).toEqual(['JevAnswerLog.record', 'JevDecisionLog.record']);
    expect((await recordGrade(r, { network: 'none' })).calls).toEqual([]);
    expect((await verifyGrade(r, { chain: false })).ok).toBe(true);
  });
  it('asks Jev with your own TypeSafe key (api.typesafe.ai, model pinned); without a key it says where to get one', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ model: 'jev-1.13.0', answers: Object.fromEntries(CLEAN.map((a) => [a.id, { choice: a.value, confidence: a.confidence, probabilities: a.probabilities }])) })));
    const r = await gradeJob({ jobId: PILOT_JOB, evidence: { task: 't', delivered: 'd' }, key: 'test-key', fetch: fetch as never });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('https://api.typesafe.ai/v1/systemone');
    expect(r.model).toBe('jev-1.13.0');
    expect(r.via.connection).toBe('key');
    await expect(gradeJob({ jobId: PILOT_JOB, evidence: 'x' })).rejects.toThrow(/TypeSafe key/);
  });
  it('refuses a job id that is not the hook’s 32-byte id', async () => {
    await expect(gradeJob({ jobId: '42', evidence: 'x', answers: CLEAN })).rejects.toThrow(/32-byte/);
  });
});

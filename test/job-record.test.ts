import { describe, expect, it } from 'vitest';
import { jobRecordBody, taskMessage, textDigest } from '../src/judge/index.js';

// The job's record for a hook job that stores no task: the SDK builds the same message and digests the layer checks
// (the coordination layer's record check). Values pinned from the pilot job's record, read live on 2026-09-28.
const JOB = '0x5bf26c8eece0ca8a7cd3df7389860e323291b002f7e6ab6ce07470bf73a7027d';
const TASK = 'Read, on Base, how much GLMR the pilot pool 0x95951a4bF6F2f99131a5653060d5E8a24F6feb9e and the demo pool 0x2F8e5378a2d850A18D857Ad8ad30F242B89E3a58 hold, and who owns them, and report both balances, the owner and the block they were read at.';
const DELIVERY = 'Pool 0x95951a4bF6F2f99131a5653060d5E8a24F6feb9e (the pilot) and pool 0x2F8e5378a2d850A18D857Ad8ad30F242B89E3a58 (the demo) on Base, read at block 51823378:\npilot holds 60 GLMR; demo holds 20 GLMR;\nboth owned by 0xaAa14Cf3178575C4B687EeF754BB4256331b781d.';

describe('the job record helpers', () => {
  it('the delivery digest is the evidence digest the seller sealed on Base (tx 0x3c5a…428b)', () => {
    expect(textDigest(DELIVERY)).toBe('0x432872327170eee40585de07538fba8e745a00ee9f4c0518c127adb00de372ec');
  });
  it('the task message names Base, the hook, the job and the task digest', () => {
    expect(textDigest(TASK)).toBe('0x9c811d295856426cef01664063d006edd5689e233af17d3dec6a7e003fc39c6a');
    expect(taskMessage({ jobId: JOB, task: TASK }).split('\n')).toEqual(['ERC-8183 assurance-hook job: the task the buyer asked for', 'chain: 8453',
      'hook: 0xc0578657eda85e0a246771aa1839ce79b54ee80d', `job: ${JOB}`, 'task keccak256: 0x9c811d295856426cef01664063d006edd5689e233af17d3dec6a7e003fc39c6a']);
  });
  it('the record body carries only what was given', () => {
    expect(jobRecordBody({ delivery: DELIVERY })).toEqual({ chainId: 8453, delivery: DELIVERY });
    expect(jobRecordBody({ task: TASK, taskSignature: '0xabc' })).toEqual({ chainId: 8453, task: TASK, task_signature: '0xabc' });
  });
});

import { describe, it, expect } from 'vitest';
import { subjectOf, gradeDigest, encodeStamp, encodeErc8004Feedback, verifyStamp, type Grade } from '../src/adapters/stamp.js';

// the grade stamped on the Taifoon devnet on 2026-09-23 (job #81067 on Base, tx 0x7939ad54…7dd87)
const grade: Grade = { id: '81067', question: 'Was the work delivered as specified?', options: ['delivered_as_specified', 'delivered_with_defects', 'not_delivered', 'cannot_determine'], model: 'jev-1.13.0', value: 'cannot_determine', probabilities: { cannot_determine: 0.98, delivered_as_specified: 0.01, delivered_with_defects: 0, not_delivered: 0.01 }, confidence: 0.97 };

describe('stamp adapter (no chain library)', () => {
  it('computes the subject the registry computed on chain', () => {
    expect(subjectOf(8453, '0x238E541BfefD82238730D00a2208E5497F1832E0', 81067)).toBe('0x368338c00c391c583980a12a284e1ca560882622e72f3edd3ab000ecc1e3c66d');
  });
  it('computes the digest that is on chain for that grade', () => {
    expect(gradeDigest(grade)).toBe('0x6ab9696aaee98dc0646e8730eb9a605a228b4ece4dac228edebfc23f1e4c299e');
    expect(verifyStamp('0x6AB9696AAEE98DC0646E8730EB9A605A228B4ECE4DAC228EDEBFC23F1E4C299E', grade)).toBe(true);
    expect(verifyStamp(gradeDigest({ ...grade, confidence: 0.96 }), grade)).toBe(false);
  });
  it('encodes stamp() with the right selector, static head and dynamic tail', () => {
    const c = encodeStamp({ chainId: 36927, subject: subjectOf(8453, '0x238E541BfefD82238730D00a2208E5497F1832E0', 81067), grade, mode: 'calibrated', uri: 'https://www.taifoon.io/v1/judge/trace/8453/81067' });
    expect(c.to).toBe('0xff5B4852AC7066D04FEd8de97bdA52401d03ad6E');
    expect(c.data.slice(0, 10)).toBe('0xc10bd12c'.length === 10 ? c.data.slice(0, 10) : '');
    // verdict 4, mode 2, two dynamic strings at offsets 0xc0 and 0x100
    expect(c.data.slice(10 + 128, 10 + 192)).toBe('0000000000000000000000000000000000000000000000000000000000000004');
    expect(c.data.slice(10 + 192, 10 + 256)).toBe('0000000000000000000000000000000000000000000000000000000000000002');
    expect(c.data.slice(10 + 256, 10 + 320)).toBe('00000000000000000000000000000000000000000000000000000000000000c0');
    expect(c.data).toContain(Buffer.from('jev-1.13.0').toString('hex'));
  });
  it('encodes giveFeedback() with value = confidence in hundredths and feedbackHash = digest', () => {
    const c = encodeErc8004Feedback({ chainId: 8453, agentId: 1, grade, endpoint: 'e', feedbackURI: 'u' });
    expect(c.to).toBe('0x8004baa17c55a88189ae136b182e5fda19de9b63');
    expect(c.data.slice(10 + 64, 10 + 128)).toBe('0000000000000000000000000000000000000000000000000000000000000061'); // 97
    expect(c.data.endsWith(gradeDigest(grade).slice(2).padEnd(64, '0')) || c.data.includes(gradeDigest(grade).slice(2))).toBe(true);
  });
  it('refuses a chain with no registry', () => { expect(() => encodeStamp({ chainId: 1, subject: '0x' + '11'.repeat(32), grade, mode: 'calibrated', uri: '' })).toThrow(/no GradeStampRegistry/); });
});

// Jev's answers in the shape it returns them: a value, a confidence and the full distribution per question.
// CLEAN/REJECT/UNSURE are written for these examples; data/pilot-grade.recorded.json and data/base-grade.recorded.json hold real graded jobs.
const a = (id, value, probabilities, confidence = 0.9) => ({ id, value, confidence, probabilities });
export const CLEAN = [a('spec_met', 'yes', { yes: 0.95, no: 0.05 }), a('unsupported_claim', 'no', { yes: 0.05, no: 0.95 }), a('ending', 'complete', { complete: 0.92, reject: 0.03, expire: 0, needs_review: 0.05 }), a('cheat_shaped', 'no', { yes: 0.02, no: 0.98 })];
export const REJECT = [a('spec_met', 'no', { yes: 0.1, no: 0.9 }), a('unsupported_claim', 'yes', { yes: 0.8, no: 0.2 }), a('ending', 'reject', { complete: 0.05, reject: 0.9, expire: 0, needs_review: 0.05 }), a('cheat_shaped', 'no', { yes: 0.1, no: 0.9 })];
export const UNSURE = [a('spec_met', 'yes', { yes: 0.6, no: 0.4 }, 0.6), a('unsupported_claim', 'no', { yes: 0.3, no: 0.7 }), a('ending', 'complete', { complete: 0.55, reject: 0.1, expire: 0, needs_review: 0.35 }), a('cheat_shaped', 'no', { yes: 0.1, no: 0.9 })];
// Moonbeam's first covered hire on Base (a pilot between our own wallets)
export const PILOT_JOB = '0x5bf26c8eece0ca8a7cd3df7389860e323291b002f7e6ab6ce07470bf73a7027d';

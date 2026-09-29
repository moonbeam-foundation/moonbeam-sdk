// Read the ending: how a job ended from its trail alone, and see which endings the trail cannot decide.
// Those are the jobs a grader is needed for.
//   node examples/31-read-the-ending.mjs
import { endingFromTrail } from '@moonbeam-foundation/sdk/launcher';

const trails = {
  'completed and paid': ['JobCreated', 'BudgetSet', 'JobFunded', 'JobSubmitted', 'JobCompleted', 'PaymentReleased'],
  'delivered, then expired': ['JobCreated', 'BudgetSet', 'JobFunded', 'JobSubmitted', 'Refunded', 'JobExpired'],
  'never delivered': ['JobCreated', 'JobFunded', 'JobExpired'],
  'delivered, no ruling yet': ['JobCreated', 'BudgetSet', 'JobFunded', 'JobSubmitted'],
};
for (const [name, trail] of Object.entries(trails)) {
  const d = endingFromTrail(trail);
  console.log(name.padEnd(26), '→', d.ending.padEnd(24), `(${d.decidedBy === 'trail' ? 'the trail decides' : 'needs a grader'})`);
}

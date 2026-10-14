import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Every offline example runs as a reader would run it, against the built package, and prints what its README line
// promises (OFFLINE=1: 50 and 51 use their recorded answers). The two that need the network (17 live grade, 32 live read)
// are only checked to explain themselves.
const root = join(__dirname, '..');
const dir = join(root, 'examples');
function run(file: string): string {
  const r = spawnSync(process.execPath, [join(dir, file)], { cwd: root, encoding: 'utf8', env: { ...process.env, TYPESAFE_KEY: '', OFFLINE: '1' }, timeout: 30_000 });
  if (r.status !== 0 && file !== '17-grade-live.mjs') throw new Error(`${file} exited ${r.status}\n${r.stderr}`);
  return r.stdout + r.stderr;
}

const EXPECT: Record<string, RegExp> = {
  '01-settle-a-covered-job.mjs': /cheated .*sums to zero: true/,
  '02-negotiate-a-hire.mjs': /DEPOSIT_BELOW_JOB/,
  '03-end-to-end-offline.mjs': /3 settle .*sums to zero/,
  '10-grade-evidence.mjs': /./,
  '11-grade-facts.mjs': /reject/,
  '12-grade-answers.mjs': /./,
  '13-grade-verdict.mjs': /UNSURE\s+→ needs_review/,
  '14-grade-record.mjs': /JevDecisionLog.record on chain 8453[\s\S]*network none → 0 calls/,
  '15-grade-end-the-job.mjs': /complete/,
  '16-grade-verify.mjs': /tampered:\s+false/,
  '17-grade-live.mjs': /set TYPESAFE_KEY to your own key/,
  '20-onboard-client.mjs': /your stated loss exceeds the damage cover/,
  '21-onboard-provider.mjs': /\[block\] this job needs a 40 deposit/,
  '22-onboard-evaluator.mjs': /without a verifiable proof you can reject but never approve/,
  '23-onboard-backer.mjs': /breaks even at/,
  '24-resell-on-base.mjs': /the doer keeps 8000 on every venue/,
  '30-read-a-job.mjs': /settles as: rejected/,
  '31-read-the-ending.mjs': /cannot_determine .*needs a grader/,
  '33-read-many-jobs.mjs': /2 jobs · self-judged: 2/,
  '40-the-article.mjs': /every claim holds/,
  '50-x402-pay-a-wall.mjs': /signs TransferWithAuthorization under USD Coin v2 on chain 8453/,
  '51-read-a-proof.mjs': /verify\(blob\) → 0x2D475a53eAA8F9AC78B69bD2429275a622C644f8, bound at block 52588585/,
  '52-arbitration-calls.mjs': /not deployed on Base[\s\S]*findCheated/,
  '53-attested-by-default.mjs': /settle \(completed\), Base 8453: mark .*JevDecisionLog.record@8453 · missing: GradeStampRegistry@8453[\s\S]*opted out: none/,
};
const NETWORK = new Set(['32-read-live-from-base.mjs']);

describe('examples', () => {
  beforeAll(() => {
    if (!existsSync(join(root, 'dist', 'index.js'))) execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' });
  }, 120_000);

  it('every example file is listed here', () => {
    const files = readdirSync(dir).filter((f) => /^\d\d-.*\.mjs$/.test(f));
    expect(files.filter((f) => !(f in EXPECT) && !NETWORK.has(f))).toEqual([]);
  });

  for (const [file, want] of Object.entries(EXPECT)) it(file, () => expect(run(file)).toMatch(want), 30_000);
});

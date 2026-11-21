#!/usr/bin/env node
// The pre-publish gate. A maintainer's machine runs the maintainers' pre-publish check and refuses without it. The release
// workflow has no such tool: there the job has already run the whole test suite (the no-secrets tests among them), so it goes on.
import { execFileSync } from 'node:child_process';

const has = (() => { try { execFileSync('pack-guard', ['--help'], { stdio: 'ignore' }); return true; } catch { return false; } })();
if (has) {
  try { execFileSync('pack-guard', [], { stdio: 'inherit' }); } catch { process.exit(1); }
} else if (process.env.GITHUB_ACTIONS === 'true') {
  console.log('prepublish: the release workflow ran the test suite before this step');
} else {
  console.error('prepublish: the pre-publish check is not installed on this machine; publish through a GitHub release');
  process.exit(1);
}

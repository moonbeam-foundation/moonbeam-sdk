// generated: do not edit. _ACCEPTANCE_TESTS_v1_: scripts/gen-acceptance-tests.mjs writes this from test/io/fixtures/bitagent-base/delivered/ (npm run gen:acceptance).
import { describe, it } from 'vitest';
import { machineRun } from '../../acceptance-harness';

describe("bitagent-base · delivered", () => {
  describe("run-fork-sell.json (run, sell)", () => {
    it("machine: the steps are the path in order, each read a GET /v1 route", () => machineRun("test/io/fixtures/bitagent-base/delivered/run-fork-sell.json", "8e611ad9e460", {"op":"sell","steps":[{"id":"opened","read":"GET /v1/jobs?ids={job}"},{"id":"settled","read":"GET /v1/jobs?ids={job}"}]}));
  });
});

// generated: do not edit. _ACCEPTANCE_TESTS_v1_: scripts/gen-acceptance-tests.mjs writes this from test/io/fixtures/bitagent-base/paid/ (npm run gen:acceptance).
import { describe, it } from 'vitest';
import { machineRun } from '../../acceptance-harness';

describe("bitagent-base · paid", () => {
  describe("run-fork-sell.json (run, sell)", () => {
    it("machine: the steps are the path in order, each read a GET /v1 route", () => machineRun("test/io/fixtures/bitagent-base/paid/run-fork-sell.json", "939b6b8e5d24", {"op":"sell","steps":[{"id":"opened","read":"GET /v1/jobs?ids={job}"},{"id":"settled","read":"GET /v1/jobs?ids={job}"}]}));
  });
});

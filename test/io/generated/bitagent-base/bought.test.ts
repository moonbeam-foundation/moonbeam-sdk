// generated: do not edit. _ACCEPTANCE_TESTS_v1_: scripts/gen-acceptance-tests.mjs writes this from test/io/fixtures/bitagent-base/bought/ (npm run gen:acceptance).
import { describe, it } from 'vitest';
import { machineRun } from '../../acceptance-harness';

describe("bitagent-base · bought", () => {
  describe("run-fork-buy.json (run, buy)", () => {
    it("machine: the steps are the path in order, each read a GET /v1 route", () => machineRun("test/io/fixtures/bitagent-base/bought/run-fork-buy.json", "69821abd0b0b", {"op":"buy","steps":[{"id":"opened","read":"GET /v1/jobs?ids={job}"},{"id":"funded","read":"GET /v1/jobs?ids={job}"},{"id":"settled","read":"GET /v1/jobs?ids={job}"}]}));
  });
  describe("run-fork-sell.json (run, sell)", () => {
    it("machine: the steps are the path in order, each read a GET /v1 route", () => machineRun("test/io/fixtures/bitagent-base/bought/run-fork-sell.json", "91566aadcabc", {"op":"sell","steps":[{"id":"opened","read":"GET /v1/jobs?ids={job}"},{"id":"settled","read":"GET /v1/jobs?ids={job}"}]}));
  });
});

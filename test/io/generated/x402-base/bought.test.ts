// generated: do not edit. _ACCEPTANCE_TESTS_v1_: scripts/gen-acceptance-tests.mjs writes this from test/io/fixtures/x402-base/bought/ (npm run gen:acceptance).
import { describe, it } from 'vitest';
import { replayFixture, schemaFixture, machineRun } from '../../acceptance-harness';

describe("x402-base · bought", () => {
  describe("read-chain-chain-tx-hash.json (GET chain/:chain/tx/:hash, devnet-ledger)", () => {
    it("replay: the recorded request through the SDK call yields the recorded answer", () => replayFixture("test/io/fixtures/x402-base/bought/read-chain-chain-tx-hash.json", "cd8dfd291c85"));
    it("schema: the recorded answer keeps its keys and value types", () => schemaFixture("test/io/fixtures/x402-base/bought/read-chain-chain-tx-hash.json", "cd8dfd291c85", {"status":200,"body":{"types":["object"],"keys":{"tx":{"types":["object"],"keys":{"block_number":{"types":["number"]},"events":{"types":["array"],"of":{"types":["object"],"keys":{"args":{"types":["object"],"keys":{"compensation":{"types":["number"]},"toBackers":{"types":["number"]},"toLayer":{"types":["number"]}},"optional":[]},"event":{"types":["string"]}},"optional":[]}}},"optional":[]}},"optional":[]}}));
  });
  describe("read-settle-id.json (GET settle/:id, live)", () => {
    it("replay: the recorded request through the SDK call yields the recorded answer", () => replayFixture("test/io/fixtures/x402-base/bought/read-settle-id.json", "293ab9c334f3"));
    it("schema: the recorded answer keeps its keys and value types", () => schemaFixture("test/io/fixtures/x402-base/bought/read-settle-id.json", "293ab9c334f3", {"status":200,"body":{"types":["object"],"keys":{"at":{"types":["number"]},"chainId":{"types":["number"]},"corrections":{"types":["array"],"of":null},"decided_by":{"types":["null"]},"decided_by_now":{"types":["object"],"keys":{"corrected":{"types":["boolean"]},"now":{"types":["null"]},"recorded":{"types":["null"]}},"optional":[]},"decision_id":{"types":["null"]},"deposit":{"types":["string"]},"ended_at":{"types":["number"]},"fee":{"types":["string"]},"id":{"types":["string"]},"jev_decision_id":{"types":["null"]},"jobId":{"types":["string"]},"kind":{"types":["null"]},"ok":{"types":["boolean"]},"opened_at":{"types":["number"]},"operator_decision_id":{"types":["null"]},"pool":{"types":["string"]},"premium":{"types":["string"]},"price":{"types":["string"]},"source":{"types":["string"]},"tenant":{"types":["null"]},"test_doer":{"types":["boolean"]},"to_buyer":{"types":["string"]},"to_evaluator":{"types":["string"]},"to_pool":{"types":["string"]},"to_seller":{"types":["string"]},"token":{"types":["string"]},"transition":{"types":["string"]},"txs":{"types":["array"],"of":{"types":["object"],"keys":{"hash":{"types":["string"]},"link":{"types":["string"]},"role":{"types":["string"]}},"optional":[]}},"verdict":{"types":["string"]}},"optional":[]}}));
  });
  describe("run-fork-sell.json (run, sell)", () => {
    it("machine: the steps are the path in order, each read a GET /v1 route", () => machineRun("test/io/fixtures/x402-base/bought/run-fork-sell.json", "90e31e557680", {"op":"sell","steps":[{"id":"settled","read":"GET /v1/chain/tx?chain=8453&hashes={tx}"},{"id":"delivered","read":"GET /v1/resale/sales/{sale}"},{"id":"legs","read":"GET /v1/resale/sales/{sale}"},{"id":"paid","read":"GET /v1/chain/tx?chain=8453&hashes={payout}"}]}));
  });
});

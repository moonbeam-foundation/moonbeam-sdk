// generated: do not edit. _ACCEPTANCE_TESTS_v1_: scripts/gen-acceptance-tests.mjs writes this from test/io/fixtures/near-agent-market/delivered/ (npm run gen:acceptance).
import { describe, it } from 'vitest';
import { replayFixture, schemaFixture } from '../../acceptance-harness';

describe("near-agent-market · delivered", () => {
  describe("read-settle-id.json (GET settle/:id, live)", () => {
    it("replay: the recorded request through the SDK call yields the recorded answer", () => replayFixture("test/io/fixtures/near-agent-market/delivered/read-settle-id.json", "0008f9ce7430"));
    it("schema: the recorded answer keeps its keys and value types", () => schemaFixture("test/io/fixtures/near-agent-market/delivered/read-settle-id.json", "0008f9ce7430", {"status":200,"body":{"types":["object"],"keys":{"at":{"types":["number"]},"chainId":{"types":["number"]},"corrections":{"types":["array"],"of":null},"decided_by":{"types":["null"]},"decided_by_now":{"types":["object"],"keys":{"corrected":{"types":["boolean"]},"now":{"types":["null"]},"recorded":{"types":["null"]}},"optional":[]},"decision_id":{"types":["null"]},"deposit":{"types":["string"]},"ended_at":{"types":["number"]},"fee":{"types":["string"]},"id":{"types":["string"]},"jev_decision_id":{"types":["null"]},"jobId":{"types":["string"]},"kind":{"types":["null"]},"ok":{"types":["boolean"]},"opened_at":{"types":["number"]},"operator_decision_id":{"types":["null"]},"pool":{"types":["string"]},"premium":{"types":["string"]},"price":{"types":["string"]},"source":{"types":["string"]},"tenant":{"types":["null"]},"test_doer":{"types":["boolean"]},"to_buyer":{"types":["string"]},"to_evaluator":{"types":["string"]},"to_pool":{"types":["string"]},"to_seller":{"types":["string"]},"token":{"types":["string"]},"transition":{"types":["string"]},"txs":{"types":["array"],"of":{"types":["object"],"keys":{"hash":{"types":["string"]},"link":{"types":["string"]},"role":{"types":["string"]}},"optional":[]}},"verdict":{"types":["string"]}},"optional":[]}}));
  });
  describe("write-handshake.json (POST handshake, contract)", () => {
    it("replay: the recorded request through the SDK call yields the recorded answer", () => replayFixture("test/io/fixtures/near-agent-market/delivered/write-handshake.json", "862e54b0b8f3"));
    it("schema: the recorded answer keeps its keys and value types", () => schemaFixture("test/io/fixtures/near-agent-market/delivered/write-handshake.json", "862e54b0b8f3", {"status":200,"body":{"types":["object"],"keys":{},"optional":[]}}));
  });
});

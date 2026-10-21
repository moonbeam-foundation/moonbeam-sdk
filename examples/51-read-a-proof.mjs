// A proof that a Base transaction is inside the layer's superroot, and the V5 proof verifier on Base checking it.
//   MOONBEAM_API=<your coordination endpoint>/v1 node examples/51-read-a-proof.mjs [txHash]
//                                                  read the proof live, then verify(blob) by eth_call on Base
//   node examples/51-read-a-proof.mjs              the recorded proof, and the call that Base answered true for
import { readFileSync } from 'node:fs';
import { readProof, verifyCall, verifyOnBase } from '@moonbeam-foundation/sdk/proof';
import { baseReader } from '@moonbeam-foundation/sdk/rpc';

const tx = process.argv[2] ?? '0x48f87043df02dc8f97c3a70afb8c8748848d0efae865cb251c429cce57bc127f';
if (process.env.OFFLINE || !process.env.MOONBEAM_API) {
  const p = JSON.parse(readFileSync(new URL('./data/proof-base-tx-52587000.json', import.meta.url), 'utf8'));
  const c = verifyCall(p.blob);
  console.log(`recorded proof of ${p.tx}: block ${p.block_number}, superroot 0x${p.super_root_hash}`);
  console.log(`verify(blob) → ${c.to}, bound at block ${c.boundAt.blockNumber}, ${c.data.length / 2 - 1} bytes of calldata`);
  process.exit(0);
}
const p = await readProof({ base: process.env.MOONBEAM_API, fetch: (u, i) => fetch(u, i) }, tx);
console.log(`proof of ${p.tx}: block ${p.block_number} · proven by the layer: ${p.proven} · ${p.ref}`);
if (p.blob) {
  const c = await verifyOnBase(baseReader(), p.blob);
  console.log(`verify(blob) on Base: ${c.verified}${c.error ? ` (${c.error})` : ''} · superroot anchored on chain: ${c.anchored} · block bound by: ${c.inclusion === 'served' ? 'the served inclusion path' : 'the header itself'}`);
}

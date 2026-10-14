/**
 * @moonbeam-foundation/sdk/proof: read the proof that a Base transaction is inside the layer's superroot, name it with a
 * ref (`v5:<chain>:<tx>@<superroot>`), and check the served blob with the V5 proof verifier on Base itself.
 *
 *   readProof(t, tx)          GET /v1/proof/tx/8453/<tx>: the block, the superroot, `checks`, `proven`, the blob
 *   proofRef / parseProofRef  the one-line name of a proof, and back
 *   verifyCall(blob)          the unsigned eth_call the verifier answers (`verify(blob)`)
 *   verifyOnBase(reader, p)   that eth_call on Base: true, false, or the verifier's own error name
 *
 * What the on-chain check proves today: the superroot commits to the Base header the blob names (L1–L3). The deployed
 * verifier folds the snapshot tip's header, so a transaction's block is bound to that tip by the served `inclusion`
 * path, which this module reports and does not re-fold. The verifier has no superroot anchor configured yet
 * (`superrootAnchor` is the zero address), so the superroot is asserted by the verifier, not anchored: `anchored: false`.
 */
import type { OnboardTransport } from '../onboard/index.js';
import { encodeFunction, decodeStatic, encodeParams } from '../abi/index.js';
import { keccakHex, hexToBytes } from '../onboard/index.js';
import { ethCall, RpcReverted, type BaseReader } from '../rpc/index.js';
import { REGISTRY } from '../acp/moonbeam-acp.generated.js';

/** TaifoonV5ProofVerifier (gated) on Base, from the address registry */
export const V5_VERIFIER = REGISTRY.v5Verifier;

export type Header = { chainId: number; chainType: number; blockNumber: number; blockHash: string; miniMmrRoot: string; twigCount: number; stateRoot: string };
export type ProofBlob = {
  superroot: { superrootHash: string; batchId: number; chainCount: number; totalTwigs: number };
  chainHeaders: Header[];
  superrootProof: { targetChainIndex: number; siblings: string[] };
  blockProof: { blockIndex: number; siblings: string[]; l4Status?: string; inclusion?: { blockNumber: number; blockHash: string; index: number; siblings: string[]; root: string; tipBlockNumber: number; tipBlockHash: string } };
  finality: { finalityType: number; finalizedBlockNumber: number; finalizedBlockHash: string; proof: string };
};
export type TxProof = {
  ok: true; chain_id: number; tx: string; block_number: number; block_hash: string; is_finalized: boolean; super_root_hash: string | null;
  checks: Record<string, boolean>; blob: ProofBlob | null;
  /** every check the layer names is true */
  proven: boolean;
  ref: string | null;
};

const TX_RE = /^0x[0-9a-fA-F]{64}$/;

/** Read the proof of one Base transaction from the layer (keyless). Throws on a malformed hash or a refused read. */
export async function readProof(t: OnboardTransport, tx: string): Promise<TxProof> {
  if (!TX_RE.test(tx)) throw new RangeError('a transaction hash is 0x + 64 hex');
  const r = await t.fetch(`${t.base}/proof/tx/8453/${tx}`, { method: 'GET', headers: { accept: 'application/json', ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) } });
  const j = (await r.json().catch(() => null)) as (Omit<TxProof, 'proven' | 'ref'> & { proven?: boolean; error?: string }) | null;
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `GET /proof/tx/8453/${tx} → ${r.status}`);
  const checks = j.checks ?? {};
  const proven = Object.keys(checks).length > 0 && Object.values(checks).every(Boolean) && j.blob !== null;
  const root = j.super_root_hash ? (j.super_root_hash.startsWith('0x') ? j.super_root_hash : `0x${j.super_root_hash}`) : null;
  return { ...j, super_root_hash: root, checks, proven, ref: root ? proofRef({ chainId: j.chain_id, tx: j.tx, superroot: root }) : null };
}

/** `v5:<chain>:<tx>@<superroot>`: the one-line name of a proof */
export const proofRef = (p: { chainId: number; tx: string; superroot: string }): string => `v5:${p.chainId}:${p.tx.toLowerCase()}@${p.superroot.toLowerCase()}`;
export function parseProofRef(ref: string): { chainId: number; tx: string; superroot: string } {
  const m = /^v5:(\d+):(0x[0-9a-fA-F]{64})@(0x[0-9a-fA-F]{64})$/.exec(ref.trim());
  if (!m) throw new RangeError('a proof ref is v5:<chain>:<tx>@<superroot>');
  return { chainId: Number(m[1]), tx: m[2]!.toLowerCase(), superroot: m[3]!.toLowerCase() };
}

const BLOB_T = '(bytes32 superrootHash,uint64 batchId,uint32 chainCount,uint64 totalTwigs) superroot,(uint64 chainId,uint8 chainType,uint64 blockNumber,bytes32 blockHash,bytes32 miniMmrRoot,uint64 twigCount,bytes32 stateRoot)[] chainHeaders,(uint32 targetChainIndex,bytes32[] siblings) superrootProof,(uint64 blockIndex,bytes32[] siblings) blockProof,(uint8 chainType,bytes encoded) event_,(uint8 finalityType,uint64 finalizedBlockNumber,bytes32 finalizedBlockHash,bytes finalityProof) finality';
const EVM_EVENT_T = '(bytes32 txHash,uint32 txIndex,bytes32[] txMerkleProof,bytes32 receiptsRoot,bytes32[] receiptProof,uint8 receiptStatus,uint64 gasUsed,address contractAddress,uint32 logIndex,bytes32[] topics,bytes data,bytes32 eventHash)';
export const VERIFY_SIG = `verify((${BLOB_T}) blob)`;
const Z32 = `0x${'0'.repeat(64)}`;

/** The verifier's `verify(blob)` call for a served blob. The header is placed at its index in the superroot (the other
 *  slots zero, as the encoder does) and bound at the snapshot tip the inclusion path names; the event is the header's
 *  carrier event (topics = [blockHash]). */
export function verifyCall(blob: ProofBlob): { to: string; data: string; boundAt: { blockNumber: number; blockHash: string } } {
  const h0 = blob.chainHeaders[0]; if (!h0) throw new Error('the blob names no chain header');
  const inc = blob.blockProof.inclusion;
  const h = inc ? { ...h0, blockNumber: inc.tipBlockNumber, blockHash: inc.tipBlockHash } : h0;
  const tci = blob.superrootProof.targetChainIndex;
  const zero = { chainId: 0, chainType: 0, blockNumber: 0, blockHash: Z32, miniMmrRoot: Z32, twigCount: 0, stateRoot: Z32 };
  const headers = Array.from({ length: tci + 1 }, (_, i) => (i === tci ? h : zero));
  const topics = [h.blockHash];
  const eventHash = keccakHex(hexToBytes(encodeParams(['bytes32[]', 'bytes'], [topics, '0x'])));
  const encoded = encodeParams([EVM_EVENT_T], [{ txHash: Z32, txIndex: 0, txMerkleProof: [], receiptsRoot: Z32, receiptProof: [], receiptStatus: 0, gasUsed: 0, contractAddress: `0x${'0'.repeat(40)}`, logIndex: 0, topics, data: '0x', eventHash }]);
  const data = encodeFunction(VERIFY_SIG, [{
    superroot: blob.superroot, chainHeaders: headers, superrootProof: blob.superrootProof,
    blockProof: { blockIndex: blob.blockProof.blockIndex, siblings: [] }, event_: { chainType: 0, encoded },
    finality: { finalityType: blob.finality.finalityType, finalizedBlockNumber: blob.finality.finalizedBlockNumber, finalizedBlockHash: blob.finality.finalizedBlockHash, finalityProof: blob.finality.proof },
  }]);
  return { to: V5_VERIFIER, data, boundAt: { blockNumber: h.blockNumber, blockHash: h.blockHash } };
}

/** the verifier's error names, by selector (from its ABI) */
export const VERIFIER_ERRORS: Readonly<Record<string, string>> = { '0xd3137376': 'L3_SuperrootPathInvalid' };

export type OnChainCheck = {
  verifier: string; verified: boolean; error: string | null;
  /** the verifier checked the superroot against an on-chain anchor (false while superrootAnchor is unset) */
  anchored: boolean;
  boundAt: { blockNumber: number; blockHash: string };
  /** the block → tip binding the layer served (not re-folded here) */
  inclusion: 'served' | 'none';
};

/** Ask the V5 verifier on Base whether the served blob verifies (an eth_call: no key, no gas). */
export async function verifyOnBase(reader: BaseReader, blob: ProofBlob): Promise<OnChainCheck> {
  const c = verifyCall(blob);
  let anchored = false;
  try { const [a] = decodeStatic(['address'], await ethCall(reader, V5_VERIFIER, encodeFunction('superrootAnchor()', []))); anchored = a !== `0x${'0'.repeat(40)}`; } catch { anchored = false; }
  const base = { verifier: V5_VERIFIER, anchored, boundAt: c.boundAt, inclusion: blob.blockProof.inclusion ? 'served' as const : 'none' as const };
  try {
    const out = await ethCall(reader, c.to, c.data);
    return { ...base, verified: decodeStatic(['bool'], out)[0] === true, error: null };
  } catch (e) {
    if (e instanceof RpcReverted) { const sel = (e.data ?? '').slice(0, 10); return { ...base, verified: false, error: VERIFIER_ERRORS[sel] ?? (sel || e.message) }; }
    throw e;
  }
}

import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, parseAbiParameters, encodeFunctionData, parseAbi, toEventSelector } from 'viem';
import { encodeParams, encodeFunction, signatureOf, topicOf, decodeStatic, parseType, canonical } from '../src/abi/index.js';

const BLOB = '(bytes32 superrootHash,uint64 batchId,uint32 chainCount,uint64 totalTwigs) superroot,(uint64 chainId,uint8 chainType,uint64 blockNumber,bytes32 blockHash,bytes32 miniMmrRoot,uint64 twigCount,bytes32 stateRoot)[] chainHeaders,(uint32 targetChainIndex,bytes32[] siblings) superrootProof,(uint64 blockIndex,bytes32[] siblings) blockProof,(uint8 chainType,bytes encoded) event_,(uint8 finalityType,uint64 finalizedBlockNumber,bytes32 finalizedBlockHash,bytes finalityProof) finality';
const H = (b: string) => `0x${b.repeat(32)}` as `0x${string}`;
const blob = {
  superroot: { superrootHash: H('11'), batchId: 7n, chainCount: 3, totalTwigs: 9n },
  chainHeaders: [{ chainId: 0n, chainType: 0, blockNumber: 0n, blockHash: H('00'), miniMmrRoot: H('00'), twigCount: 0n, stateRoot: H('00') }, { chainId: 8453n, chainType: 0, blockNumber: 5n, blockHash: H('22'), miniMmrRoot: H('33'), twigCount: 4n, stateRoot: H('44') }],
  superrootProof: { targetChainIndex: 1, siblings: [H('55'), H('66')] },
  blockProof: { blockIndex: 2n, siblings: [] as `0x${string}`[] },
  event_: { chainType: 0, encoded: '0xdeadbeef' as `0x${string}` },
  finality: { finalityType: 12, finalizedBlockNumber: 5n, finalizedBlockHash: H('22'), finalityProof: '0x0102' as `0x${string}` },
};

describe('the ABI encoder equals viem', () => {
  it('nested tuples, dynamic arrays, bytes (the V5 proof blob)', () => {
    expect(encodeParams([`(${BLOB})`], [blob])).toBe(encodeAbiParameters(parseAbiParameters(`(${BLOB})`), [blob as never]));
  });
  it('a function call with a tuple argument, and its selector', () => {
    const fn = `verify((${BLOB}) blob)`;
    expect(encodeFunction(fn, [blob])).toBe(encodeFunctionData({ abi: parseAbi([`function ${fn} returns (bool)`]), functionName: 'verify', args: [blob as never] }));
    expect(signatureOf('councilApprove(bytes32 jobId, uint8 verdict, uint256 loss)')).toBe('councilApprove(bytes32,uint8,uint256)');
  });
  it('strings, bools, fixed arrays, addresses', () => {
    const t = ['string', 'bool', 'uint16[2]', 'address', '(string a,uint8 b)[]'];
    const v = ['héllo', true, [1, 2], '0x00000000000000000000000000000000000000aa', [{ a: 'x', b: 1 }, { a: '', b: 2 }]];
    expect(encodeParams(t, v)).toBe(encodeAbiParameters(parseAbiParameters(t.join(',')), v as never));
  });
  it('event topics and static decoding', () => {
    expect(topicOf('Resolved(bytes32 indexed jobId, uint8 indexed tier, uint8 verdict, uint256 loss, address by)')).toBe(toEventSelector('event Resolved(bytes32 indexed jobId, uint8 indexed tier, uint8 verdict, uint256 loss, address by)'));
    expect(decodeStatic(['uint8', 'uint256', 'address'], encodeAbiParameters(parseAbiParameters('uint8,uint256,address'), [3, 10n, '0x00000000000000000000000000000000000000aa']))).toEqual([3n, 10n, '0x00000000000000000000000000000000000000aa']);
    expect(canonical(parseType('tuple(uint8 a, bytes32[] b)[3]'))).toBe('(uint8,bytes32[])[3]');
  });
  it('refuses what does not fit', () => {
    expect(() => encodeParams(['uint8'], [256])).toThrow(/overflows/);
    expect(() => encodeParams(['address'], ['0x1'])).toThrow(/address/);
    expect(() => encodeParams(['(uint8 a)'], [{}])).toThrow(/missing/);
  });
});

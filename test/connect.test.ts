import { describe, expect, it, vi } from 'vitest';
import {
  clockFromAttestation,
  createAttestationSource,
  createProofSource,
  describeError,
  fetchLogRange,
  formatEventRef,
  isSignedByTrusted,
  meansAbsent,
  parseAttestation,
  splitRange,
  valueOr,
  verifyAttestation,
  MAX_BLOCK_SPAN,
} from '../src/index.js';
import type { Fetch, FinalityAttestation, LogSource, RawLog } from '../src/index.js';

/** A real payload shape, kept as a fixture so tests never touch the network. */
const PAYLOAD = {
  chain_id: 8453,
  finalized_block: 50_423_075,
  relay_block: 0,
  timestamp: 1_787_640_034,
  digest: '0x03e3c227',
  signature: '0x5e28c03a',
  signer: '0x016c27e81c1f28f5d8c342bf1c3f23ab087c1606',
};

const ATTESTATION: FinalityAttestation = {
  chainId: 8453,
  finalizedBlock: 50_423_075,
  timestamp: 1_787_640_034,
  digest: '0x03e3c227',
  signature: '0x5e28c03a',
  signer: '0x016c27e81c1f28f5d8c342bf1c3f23ab087c1606',
};

const respond = (status: number, body: unknown = {}): ReturnType<Fetch> =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('an honest "no data" is not a failure', () => {
  it('reports a 404 as noData, which is a fact about the world', async () => {
    const source = createAttestationSource({ baseUrl: 'https://example.test', fetch: () => respond(404) });
    const result = await source.latest(1284);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('noData');
      expect(meansAbsent(result.error)).toBe(true);
    }
  });

  /**
   * The distinction that protects a payment: a broken service tells you
   * nothing, and "nothing" must never be read as "there is no proof".
   */
  it('reports a 500 as unavailable, which is NOT absence', async () => {
    const source = createAttestationSource({ baseUrl: 'https://example.test', fetch: () => respond(500) });
    const result = await source.latest(8453);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('unavailable');
      expect(meansAbsent(result.error)).toBe(false);
      expect(describeError(result.error)).toContain('unknown, not absent');
    }
  });

  it('reports a network failure as unknown too', async () => {
    const source = createAttestationSource({
      baseUrl: 'https://example.test',
      fetch: () => Promise.reject(new Error('offline')),
    });
    const result = await source.latest(8453);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(meansAbsent(result.error)).toBe(false);
  });
});

describe('parsing an attestation', () => {
  it('accepts a well-formed payload', async () => {
    const source = createAttestationSource({ baseUrl: 'https://example.test', fetch: () => respond(200, PAYLOAD) });
    const result = await source.latest(8453);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.finalizedBlock).toBe(50_423_075);
  });

  it('rejects a payload missing required fields', () => {
    const result = parseAttestation({ chain_id: 8453 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('malformed');
  });

  it('rejects a payload that is not an object', () => {
    expect(parseAttestation(null).ok).toBe(false);
    expect(parseAttestation('nope').ok).toBe(false);
  });
});

describe('verifying the signature, not the claim', () => {
  /**
   * The `signer` field is self-reported. Until the signature is recovered and
   * compared, it is a claim about a signer rather than evidence of one.
   */
  it('accepts an attestation whose signature recovers to the claimed signer', async () => {
    const ecrecover = vi.fn().mockResolvedValue(ATTESTATION.signer);
    const result = await verifyAttestation(ATTESTATION, ecrecover);
    expect(result.verified).toBe(true);
  });

  it('rejects one that recovers to somebody else', async () => {
    const ecrecover = vi.fn().mockResolvedValue('0x9999999999999999999999999999999999999999');
    const result = await verifyAttestation(ATTESTATION, ecrecover);
    expect(result.verified).toBe(false);
    if (!result.verified) expect(result.reason).toContain('not the claimed');
  });

  it('rejects one whose signature cannot be recovered at all', async () => {
    const result = await verifyAttestation(ATTESTATION, () => {
      throw new Error('bad signature');
    });
    expect(result.verified).toBe(false);
  });

  it('checks a recovered signer against an allowlist', async () => {
    const ecrecover = () => ATTESTATION.signer;
    expect(await isSignedByTrusted(ATTESTATION, [ATTESTATION.signer.toUpperCase()], ecrecover)).toBe(true);
    expect(await isSignedByTrusted(ATTESTATION, ['0x1111111111111111111111111111111111111111'], ecrecover)).toBe(false);
  });

  it('refuses to build an attested clock from an unverified attestation', async () => {
    const result = await clockFromAttestation(ATTESTATION, () => '0x9999999999999999999999999999999999999999');
    expect(result.ok).toBe(false);
  });

  it('builds an attested clock once the signature checks out', async () => {
    const result = await clockFromAttestation(ATTESTATION, () => ATTESTATION.signer);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.source).toBe('attested');
      expect(result.value.now).toBe(ATTESTATION.timestamp);
    }
  });
});

describe('event references', () => {
  it('formats as chain, transaction and position', () => {
    expect(formatEventRef({ chainId: 8453, txHash: '0xabc', logIndex: 3 })).toBe('8453:0xabc:3');
  });

  it('passes a 500 through as unavailable rather than absent', async () => {
    const source = createProofSource({ baseUrl: 'https://example.test', fetch: () => respond(500) });
    const result = await source.forEvent({ chainId: 8453, txHash: '0xabc', logIndex: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(meansAbsent(result.error)).toBe(false);
  });
});

describe('reading logs safely', () => {
  it('pages a wide range into spans a provider will accept', () => {
    const pages = splitRange(0, 4_000);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toEqual({ fromBlock: 0, toBlock: MAX_BLOCK_SPAN - 1 });
    expect(pages.at(-1)?.toBlock).toBe(4_000);
  });

  it('returns nothing for an inverted range', () => {
    expect(splitRange(100, 50)).toEqual([]);
  });

  it('collects every page', async () => {
    const log = { topics: ['0x00'] } as RawLog;
    const source: LogSource = { logs: async () => ({ ok: true, value: [log] }) };
    const result = await fetchLogRange(source, { fromBlock: 0, toBlock: 3_000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
  });

  /**
   * Some providers answer a valid query with an empty set instead of an error,
   * which is indistinguishable from a genuinely quiet range. Treating that as
   * "nothing happened" is how history gets a hole in it.
   */
  it('refuses to treat an empty result as authoritative by default', async () => {
    const source: LogSource = { logs: async () => ({ ok: true, value: [] }) };
    const result = await fetchLogRange(source, { fromBlock: 0, toBlock: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('noData');
  });

  it('accepts an empty result when the caller vouches for its source', async () => {
    const source: LogSource = { logs: async () => ({ ok: true, value: [] }) };
    const result = await fetchLogRange(source, { fromBlock: 0, toBlock: 100 }, { trustEmpty: true });
    expect(result.ok).toBe(true);
  });

  it('stops at the first failed page rather than returning a partial history', async () => {
    let calls = 0;
    const source: LogSource = {
      logs: async () => {
        calls += 1;
        return calls === 1
          ? { ok: true, value: [{ topics: ['0x00'] } as RawLog] }
          : { ok: false, error: { kind: 'unavailable', status: 503 } };
      },
    };
    const result = await fetchLogRange(source, { fromBlock: 0, toBlock: 5_000 });
    expect(result.ok).toBe(false);
  });
});

describe('result helpers', () => {
  it('falls back when there is no value', () => {
    expect(valueOr({ ok: false, error: { kind: 'noData', detail: 'x' } }, 42)).toBe(42);
    expect(valueOr({ ok: true, value: 1 }, 42)).toBe(1);
  });

  it('describes each error kind', () => {
    expect(describeError({ kind: 'noData', detail: 'x' })).toContain('no data');
    expect(describeError({ kind: 'network', message: 'x' })).toContain('network failure');
    expect(describeError({ kind: 'malformed', message: 'x' })).toContain('malformed');
  });
});

#!/usr/bin/env node
// One playground case on the devnet, through the coord stream port (src/playground/stream.ts). NOT run in tests; tests import
// `guard` only. It refuses to start without LIVE=1 and refuses any chain but the devnet 36927.
//
//   LIVE=1 node scripts/e2e-devnet-playground.mjs
//
// Not published (scripts/ is not in the package's files). It names no address or URL: every one comes from the environment.
//
//   LIVE=1                          the explicit go for a live run
//   MOONBEAM_API                    the coordination endpoint, /v1 included (transportFromEnv)
//   MOONBEAM_API_KEY                optional: the transport's own key, forwarded as x-api-key (the port never reads it)
//   MOONBEAM_DEVNET_CHAIN_ID        default 36927; any other chain is refused
//   MOONBEAM_PLAYGROUND_REQUESTER   the requester id the signer's register names (an id, never a key)
//   MOONBEAM_DEVNET_HOOK · _TOKEN · _ADAPTER · _POOL · _VAULT   the devnet placement (checksummed)
//
// The case is `layer-sweep`: one Moonbeam step (devnet.keeper), no wallet step, no window. This script holds no request key, so the
// port has no seal: the sign request answers not_routable and nothing is sent to the signer. On a 401, 402 or 429 it stops.
import { pathToFileURL } from 'node:url';

export const DEVNET_CHAIN = 36927;

/** The start check: { ok: true, chainId } or { ok: false, why }. Pure. */
export function guard(env = {}) {
  if (env.LIVE !== '1') return { ok: false, why: 'refused: set LIVE=1 to run a live devnet case (this script makes network calls)' };
  const raw = env.MOONBEAM_DEVNET_CHAIN_ID?.trim();
  const chainId = raw ? Number(raw) : DEVNET_CHAIN;
  if (!Number.isSafeInteger(chainId) || chainId !== DEVNET_CHAIN) return { ok: false, why: `refused: chain ${raw} is not the devnet ${DEVNET_CHAIN}; this script runs on the devnet only` };
  return { ok: true, chainId };
}

async function main() {
  const g = guard(process.env);
  if (!g.ok) { console.error(g.why); process.exit(2); }
  const requester = process.env.MOONBEAM_PLAYGROUND_REQUESTER?.trim();
  if (!requester) { console.error('refused: set MOONBEAM_PLAYGROUND_REQUESTER (the requester id the signer\'s register names)'); process.exit(2); }
  const { transportFromEnv } = await import('@moonbeam-foundation/sdk/devnet');
  const { playground, coordStream, toChecksum, StreamRefused } = await import('@moonbeam-foundation/sdk/playground');
  const need = (k) => { const v = process.env[`MOONBEAM_DEVNET_${k}`]?.trim(); if (!v) { console.error(`refused: set MOONBEAM_DEVNET_${k}`); process.exit(2); } return toChecksum(v); };
  const placement = { chainId: g.chainId, hook: need('HOOK'), token: need('TOKEN'), judgeAdapter: need('ADAPTER'), pool: need('POOL'), vault: need('VAULT') };

  const t = transportFromEnv(process.env);
  const cs = coordStream(t, { requester, chainId: g.chainId });
  const pg = playground({ net: 'devnet', placement });
  const quote = { price: 1n, premium: 0n, toBackers: 0n, protocolFee: 0n, deposit: 0n, compensation: 0n, evaluatorFee: 0n, coverCap: 1n };
  // the sweep names no party: the plan still checks two addresses, so it is given the vault's (unused by the call)
  const parties = { buyer: placement.vault, seller: placement.vault };
  const wallet = { sign: async (s) => { throw new Error(`no wallet step expected in layer-sweep (${s.fn})`); } };
  try {
    const out = await pg.run('layer-sweep', { market: 'erc8183-base', quote, salt: `0x${'00'.repeat(31)}01`, parties, deadline: Math.floor(Date.now() / 1000) + 3600 }, { wallet, stream: cs, chain: cs.chain });
    console.log(JSON.stringify({ status: out.status, stopped: out.stopped ?? null, wouldSign: out.wouldSign ?? [], steps: out.steps.map((s) => ({ fn: s.fn, signer: s.signer, tx: s.tx, ok: s.ok, sign: s.sign ?? null })) },
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
  } catch (e) {
    if (e instanceof StreamRefused) { console.error(`stopped: ${e.message}`); process.exit(1); }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

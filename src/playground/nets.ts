/**
 * The one switch of the playground: the devnet (chain 36927) and Base (chain 8453), side by side in one frozen table (`NETS`).
 *
 * A cover case is one plan with the same steps on both networks (./cases). What differs per network is only what this table
 * holds: the chain id, the token, the windows, and who signs each role. The table holds no address: the contracts a plan calls
 * come in a `Placement` the caller passes (`checkPlacement`), checksummed, for the network's own chain.
 *
 * Signer refs name WHO signs, never a key:
 *   wallet:test   a devnet-only wallet the playground makes for one run (never a managed key)
 *   wallet:user   the user's own wallet, on Base
 *   coord:<p>     a sign request on the coord pipe for purpose <p> (Moonbeam signs it there; the SDK never holds the key)
 *   null          no purpose exists for the role on this network yet: every case that needs it is refused (`gapsOf`)
 */
import { ECONOMY_ROLES } from '../economy/index.js';
import type { EconomyRole } from '../economy/index.js';
import { keccak256 } from '../onboard/index.js';
import type { Address } from '../onboard/index.js';
import { CASE_IDS, CASES, rolesOf, stepsOf } from './cases.js';
import type { CaseId, Via } from './cases.js';

export type NetId = 'devnet' | 'base';
export const NET_IDS: readonly NetId[] = Object.freeze(['devnet', 'base']);

/** Every role a plan names: the economy's six, and the seller's payout from a vault. */
export type SignerRole = EconomyRole | 'payout';
export const SIGNER_ROLES: readonly SignerRole[] = Object.freeze([...ECONOMY_ROLES, 'payout']);

export type WalletRef = `wallet:${string}`;
export type CoordRef = `coord:${string}`;
export type SignerRef = WalletRef | CoordRef;

/** The windows a job's steps wait on, in seconds. `null`: read from the hook of the placement (on Base). */
export interface NetWindows {
  /** the buyer's look at a delivery before anyone may claim the auto-completion */
  reviewS: number | null;
  /** the seller's time to dispute a rejection */
  disputeS: number | null;
  /** the arbitrator's time to rule on a dispute */
  arbitrationS: number | null;
}

export interface Net {
  id: NetId;
  name: string;
  chainId: number;
  token: { symbol: string; decimals: number };
  windows: NetWindows;
  signers: Readonly<Record<SignerRole, SignerRef | null>>;
}

const deepFreeze = <T>(o: T): T => {
  for (const v of Object.values(o as object)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return Object.freeze(o);
};

/** The one switch. */
export const NETS: Readonly<Record<NetId, Readonly<Net>>> = deepFreeze({
  devnet: {
    id: 'devnet', name: 'Moonbeam devnet', chainId: 36927,
    token: { symbol: 'dUSDC', decimals: 6 },
    windows: { reviewS: 60, disputeS: 60, arbitrationS: 120 },
    signers: {
      buyer: 'wallet:test', seller: 'wallet:test', backer: 'wallet:test',
      evaluator: 'coord:devnet.evaluate', arbitrator: 'coord:devnet.arbitrate', keeper: 'coord:devnet.keeper', payout: 'coord:devnet.payout',
    },
  },
  base: {
    id: 'base', name: 'Base', chainId: 8453,
    token: { symbol: 'USDC', decimals: 6 },
    windows: { reviewS: null, disputeS: null, arbitrationS: null },
    signers: {
      buyer: 'wallet:user', seller: 'wallet:user', backer: 'wallet:user',
      // no coord sign purpose exists for these two on Base yet: the table says so, and every case needing them is refused
      evaluator: null, arbitrator: null,
      keeper: 'coord:keeper.end', payout: 'coord:payout.seller',
    },
  },
} satisfies Record<NetId, Net>);

export function netOf(net: NetId | Net): Readonly<Net> {
  if (typeof net !== 'string') return net;
  const n = NETS[net];
  if (!n) throw new RangeError(`not a net: ${String(net)} (one of ${NET_IDS.join(', ')})`);
  return n;
}

/** A role with no signer on a net, and the cases (with their `via`, for `rejected`) it blocks. */
export interface Gap { role: SignerRole; blocks: { case: CaseId; via?: Via }[] }

/** The roles a net has no signer for, and the built cases each one blocks. */
export function gapsOf(net: NetId | Net, signers: Readonly<Record<SignerRole, SignerRef | null>> = netOf(net).signers): Gap[] {
  const gaps: Gap[] = [];
  for (const role of SIGNER_ROLES) {
    if (signers[role] !== null) continue;
    const blocks: Gap['blocks'] = [];
    for (const id of CASE_IDS) {
      const c = CASES[id];
      if (c.status !== 'planned') continue;
      if (c.vias) { for (const via of c.vias) if ((rolesOf(id, via) as SignerRole[]).includes(role)) blocks.push({ case: id, via }); }
      else if ((rolesOf(id) as SignerRole[]).includes(role)) blocks.push({ case: id });
    }
    gaps.push({ role, blocks });
  }
  return gaps;
}

// ── addresses: the placement ────────────────────────────────────────────────────────────────────────────────────────────

/** Where the contracts of one network are: passed by the caller, never held in the table. On Base, the windows are read
 *  from the hook by the caller and passed here too. */
export interface Placement {
  chainId: number;
  hook: Address;
  token: Address;
  judgeAdapter: Address;
  pool: Address;
  vault: Address;
  arbiter?: Address | null;
  windows?: Partial<{ reviewS: number; disputeS: number; arbitrationS: number }>;
}

export class PlacementError extends TypeError {
  override name = 'PlacementError';
}

const HEX40 = /^0x[0-9a-fA-F]{40}$/;

/** The EIP-55 checksummed spelling of an address. */
export function toChecksum(a: string): Address {
  if (!HEX40.test(a)) throw new PlacementError(`not an address: ${String(a)}`);
  const lower = a.slice(2).toLowerCase();
  const h = keccak256(new TextEncoder().encode(lower));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const nibble = (h[i >> 1]! >> (i % 2 === 0 ? 4 : 0)) & 0xf;
    out += nibble >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  }
  return out as Address;
}

/** True for an address written in its EIP-55 checksummed form (an all-lowercase or all-uppercase spelling is refused). */
export function isChecksumAddress(v: unknown): v is Address {
  return typeof v === 'string' && HEX40.test(v) && toChecksum(v) === v;
}

const ZERO = '0x0000000000000000000000000000000000000000';
const PLACED = ['hook', 'token', 'judgeAdapter', 'pool', 'vault'] as const;

/** Check a placement for a net: its chain is the net's, every address is checksummed and none is zero. Returns it frozen. */
export function checkPlacement(net: NetId | Net, p: Placement): Readonly<Placement> {
  const n = netOf(net);
  if (!p || typeof p !== 'object') throw new PlacementError('a placement is required: { chainId, hook, token, judgeAdapter, pool, vault }');
  if (p.chainId !== n.chainId) throw new PlacementError(`refused: the placement is for chain ${String(p.chainId)}, but ${n.id} is chain ${n.chainId}`);
  for (const k of PLACED) {
    if (!isChecksumAddress(p[k])) throw new PlacementError(`placement.${k} is not a checksummed address: ${String(p[k])}`);
    if (p[k] === ZERO) throw new PlacementError(`placement.${k} is the zero address`);
  }
  if (p.arbiter !== undefined && p.arbiter !== null && !isChecksumAddress(p.arbiter)) throw new PlacementError(`placement.arbiter is not a checksummed address: ${String(p.arbiter)}`);
  for (const [k, v] of Object.entries(p.windows ?? {}))
    if (!Number.isInteger(v) || (v as number) <= 0) throw new PlacementError(`placement.windows.${k} must be whole seconds above 0`);
  return Object.freeze({ ...p, ...(p.windows ? { windows: Object.freeze({ ...p.windows }) } : {}) });
}

/** The windows a plan on this net waits on: the table's, or (where it has none) the placement's, read from the hook. */
export function windowsOf(net: NetId | Net, p: Placement): { reviewS: number; disputeS: number; arbitrationS: number } {
  const n = netOf(net);
  const out = {} as { reviewS: number; disputeS: number; arbitrationS: number };
  for (const k of ['reviewS', 'disputeS', 'arbitrationS'] as const) {
    const fromTable = n.windows[k], fromHook = p.windows?.[k];
    if (fromTable !== null && fromHook !== undefined && fromHook !== fromTable)
      throw new PlacementError(`placement.windows.${k} is ${fromHook}, but ${n.id} fixes it at ${fromTable}`);
    const v = fromTable ?? fromHook;
    if (v === undefined) throw new PlacementError(`${n.id} reads ${k} from the hook: pass it in placement.windows`);
    out[k] = v;
  }
  return out;
}

/** How a case stands on a net: planned, refused (a role with no signer), or not built. Without a via, `rejected` is refused
 *  when any of its vias is. */
export function statusOn(net: NetId | Net, caseId: CaseId, via?: Via): 'planned' | 'refused' | 'not_built' {
  const def = CASES[caseId];
  if (def.status === 'not_built') return 'not_built';
  const n = netOf(net);
  const vias = def.vias ? (via ? [via] : def.vias) : [undefined];
  return vias.some((v) => stepsOf(caseId, v).some((s) => n.signers[s.role] === null)) ? 'refused' : 'planned';
}

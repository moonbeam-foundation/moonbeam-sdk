// _COORD_IO_COVERAGE_v1_: the masking every recorded live answer goes through (shared by scripts/io-record.mjs and
// scripts/record-api-rung.mjs). A treasury-like field is dropped and named; so is any address a payee field named earlier in the run.
import { readFileSync } from 'node:fs';

const DROP = /^(fee_to|fee_payee|pay_?to|payTo|payee|payees|treasury|safe|deployer|signer|signers|workers|worker|requester|from_signer)$/i;
/** addresses served under a treasury-like key anywhere in this run's answers (a fee payee, an x402 payTo): dropped wherever they recur */
export const TREASURY = new Set();
const ADDR = /^0x[0-9a-fA-F]{40}$/;
// _IO_OWN_KEYS_DROPPED_v1_: addresses listed in the file IO_MASK_FILE names (on the recorder's machine only) are dropped too.
try {
  if (process.env.IO_MASK_FILE) for (const a of readFileSync(process.env.IO_MASK_FILE, 'utf8').match(/0x[0-9a-fA-F]{40}/g) ?? []) TREASURY.add(a.toLowerCase());
} catch { /* none */ }
export function collect(v) {
  if (Array.isArray(v)) return v.forEach(collect);
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (DROP.test(k) && typeof x === 'string' && ADDR.test(x)) TREASURY.add(x.toLowerCase()); else collect(x); }
}
export function mask(v, path, notes) {
  if (Array.isArray(v)) return v.map((x) => mask(x, `${path}[]`, notes));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      if (DROP.test(k)) { notes.dropped.push(`${p} (a payee, requester, signer or treasury-like address field)`); continue; }
      if (typeof x === 'string' && TREASURY.has(x.toLowerCase())) { notes.dropped.push(`${p} (the address a fee payee or payTo names)`); continue; }
      if (typeof x === 'string' && /\bkms\b|kms-|\bssm\b|\bMFA\b/i.test(x)) { notes.trimmed.push(`${p} (withheld)`); out[k] = '(withheld)'; continue; }
      if (k === 'get_key' && !path) { notes.trimmed.push('get_key (the free-key offer every keyless answer carries)'); continue; }
      out[k] = mask(x, p, notes);
    }
    return out;
  }
  return v;
}

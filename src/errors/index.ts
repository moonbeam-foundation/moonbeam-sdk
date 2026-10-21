/**
 * @moonbeam-foundation/sdk/errors: one reader for every refusal the coordination layer answers with.
 *
 * The layer refuses in two shapes, and every read in this SDK goes through `refusalOf`, so neither can crash a caller:
 *
 *   the layer's own        { ok: false, code, error: "<words>", message?, next_step? }
 *   the OpenAI error       { error: { message, type, param, code }, next_step? }   (the chat door; the System One door)
 *
 * `refusalOf` never throws: an `error` that is an object, a string, missing, or a body that is not JSON at all all fold
 * into one `Refusal`. `CoordError` is the error every reader throws with it.
 */

/** One refusal, whatever shape the layer sent it in. */
export type Refusal = {
  /** the HTTP status (0 when there was no answer) */
  status: number;
  /** the words: error (a string), error.message, message, or the fallback */
  message: string;
  /** machine-readable: code, or error.code */
  code: string | null;
  /** the OpenAI shape's error.type (authentication_error, invalid_request_error, …) */
  type: string | null;
  /** the OpenAI shape's error.param: the request field the refusal is about */
  param: string | null;
  /** what to do instead, when the layer says (next_step) */
  nextStep: unknown;
  /** the body as it came */
  body: unknown;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Fold any refusal body into a Refusal. Pure; never throws. */
export function refusalOf(body: unknown, status: number, fallback: string): Refusal {
  const b = obj(body);
  const e = obj(b?.['error']);
  const message = str(b?.['error']) ?? str(e?.['message']) ?? str(b?.['message']) ?? (typeof body === 'string' && body.trim() ? body.slice(0, 300) : null) ?? fallback;
  const code = str(b?.['code']) ?? str(e?.['code']) ?? null;
  return {
    status, message, code,
    type: str(e?.['type']) ?? null,
    param: str(e?.['param']) ?? null,
    nextStep: b?.['next_step'] ?? null,
    body,
  };
}

/** The error every read of this SDK throws on a refusal: the words as message, the rest as fields. */
export class CoordError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly type: string | null;
  readonly param: string | null;
  readonly nextStep: unknown;
  readonly body: unknown;
  constructor(r: Refusal) {
    super(r.code && !r.message.includes(r.code) ? `${r.message} (${r.code})` : r.message);
    this.name = 'CoordError';
    this.status = r.status; this.code = r.code; this.type = r.type; this.param = r.param; this.nextStep = r.nextStep; this.body = r.body;
  }
}

/** Read a response's JSON, or null when it is not JSON. */
export async function jsonOf(r: { json(): Promise<unknown> }): Promise<unknown> {
  try { return await r.json(); } catch { return null; }
}

/** Throw a CoordError when the answer is a refusal (status not ok, a body that says ok: false, or no JSON object at all);
 *  else return the body. */
export function okOrThrow<T>(r: { ok: boolean; status: number }, body: unknown, what: string): T {
  if (!r.ok || !obj(body) || obj(body)?.['ok'] === false) throw new CoordError(refusalOf(body, r.status, `${what} → ${r.status}${obj(body) ? '' : ' (no JSON object)'}`));
  return body as T;
}

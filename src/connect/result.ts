/**
 * Results rather than exceptions, at the network edge.
 *
 * The distinction this type exists to preserve: "the service honestly has no
 * data for this chain" and "the service is broken" are different answers, and
 * only the first is safe to act on. Throwing collapses them into one, which is
 * how an outage gets mistaken for a fact about the world.
 */

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** The value, or a fallback. Use when the distinction genuinely does not matter. */
export function valueOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Why a lookup did not return data.
 *
 * `noData` is a fact: the source served a definitive "I have nothing for this".
 * Everything else is an absence of information, and must never be read as
 * evidence that the thing being looked for does not exist.
 */
export type LookupError =
  | { readonly kind: 'noData'; readonly detail: string }
  | { readonly kind: 'unavailable'; readonly status: number }
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'malformed'; readonly message: string };

/**
 * Did the source actually tell us there is nothing, or do we simply not know?
 *
 * Only `noData` is a statement about the world. Treating `unavailable` as
 * absence is the failure mode that would let a server outage authorise a
 * payment, so this predicate exists to make the check explicit at call sites.
 */
export function meansAbsent(error: LookupError): boolean {
  return error.kind === 'noData';
}

export function describeError(error: LookupError): string {
  switch (error.kind) {
    case 'noData':
      return `no data: ${error.detail}`;
    case 'unavailable':
      return `source unavailable (status ${error.status}) — unknown, not absent`;
    case 'network':
      return `network failure: ${error.message} — unknown, not absent`;
    case 'malformed':
      return `malformed response: ${error.message}`;
  }
}

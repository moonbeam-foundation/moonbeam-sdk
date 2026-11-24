// The types of lang/emit/selection.mjs (_SELECTION_v1_), shipped beside it to every surface that holds a copy.
export type Ref = { kind: string; venue: string; native: string };
export type RefRead = { ok: true; ref: Ref; text: string } | { ok: false; reason: string };
export type Move = { id: string; op: { method: string; name: string }; kinds: string[]; needs: string; body: string };
export type SelectionLang = {
  kinds: string[]; venues: string[]; registry_venue: string; roles: Record<string, { pages: boolean }>;
  op_prefix: string; reasons: { malformed: string; unknown: string; conflict: string }; moves: Move[];
};
export type HireBody = { need: string; ref?: string; dry_run?: true };
export type Answer = { seller: string | null; example: string | null; job: string | null; links: Record<string, string>; reason: string | null };
export type MoveOut = { id: string; op: { method: string; name: string }; needs: string; body: HireBody | null };
export type Selection = {
  parseRef(raw: unknown): RefRead;
  refOf(raw: unknown): RefRead;
  hireBody(need: string, o?: { ref?: string | null; run?: boolean }): HireBody;
  readAnswer(body: unknown, role: string): Answer;
  movesOf(ref: Ref, o?: { need?: string | null; signedIn?: boolean }): MoveOut[];
};
export function selection(lang: SelectionLang): Selection;

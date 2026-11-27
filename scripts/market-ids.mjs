// The markets the SDK names differently from coord's venue rows, and the public word for the workflow tool.
// RENAME: coord's id to the SDK's. PUBLIC_WORD: the word public text says where coord's text names the tool (its name is never public).
export const RENAME = { n8n: 'workflow-nodes' };
export const PUBLIC_WORD = { n8n: 'Workflows' };
export const coordIdOf = (id) => Object.entries(RENAME).find(([, to]) => to === id)?.[0] ?? id;

/** a coord string said publicly: the tool's name becomes its public word */
export const publicText = (t) => Object.entries(PUBLIC_WORD).reduce((s, [from, to]) => s.replace(new RegExp(`\\b${from}\\b`, 'gi'), to), t);

/** a coord venue-paths row at the public boundary: the market id and the SDK's own file ids and refs are the SDK's, prose says the public word;
 *  the route a read asks (`read`, `chat`) stays coord's, since it is the real URL */
export function publicValue(v, key = '') {
  if (Array.isArray(v)) return v.map((x) => publicValue(x, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, publicValue(x, k)]));
  if (typeof v !== 'string') return v;
  if (key === 'read' || key === 'chat') return v;
  if (key === 'market') return RENAME[v] ?? v;
  if (key === 'fixture' || key === 'ref') return Object.entries(RENAME).reduce((s, [from, to]) => s.replaceAll(`/${from}/`, `/${to}/`).replaceAll(`:${from}/`, `:${to}/`), v);
  return publicText(v);
}

import { describe, expect, it } from 'vitest';
import { ACTORS, actorsBy } from '../src/index.js';

describe('who must put capital at risk', () => {
  it('obliges exactly the two roles the system takes at their word', () => {
    const obligatory = actorsBy('obligatory').map((actor) => actor.role);
    expect(obligatory.sort()).toEqual(['evaluator', 'provider']);
  });

  it('leaves everyone else free to opt in', () => {
    const optional = actorsBy('optional').map((actor) => actor.role);
    expect(optional.sort()).toEqual(['challenger', 'client', 'doubter', 'pool']);
  });

  /**
   * The brand rule "both sides, always": no role may be described as earning
   * something without also stating what it risks. Previously this was enforced
   * by whoever remembered it during review.
   */
  it('states a risk for every role that earns', () => {
    for (const actor of Object.values(ACTORS)) {
      expect(actor.earns.length, `${actor.role} earns`).toBeGreaterThan(0);
      expect(actor.risks.length, `${actor.role} risks`).toBeGreaterThan(0);
      expect(actor.bonds.length, `${actor.role} bonds`).toBeGreaterThan(0);
    }
  });

  it('keys every entry by its own role', () => {
    for (const [key, actor] of Object.entries(ACTORS)) {
      expect(actor.role).toBe(key);
    }
  });
});

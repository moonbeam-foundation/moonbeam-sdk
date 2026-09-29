import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Skills are shipped documentation an agent acts on, so they are tested like
 * code. These rules are the ones that keep an agent from misleading a user
 * about money.
 */

const SKILLS_DIR = join(import.meta.dirname, '..', 'skills');
const names = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const read = (name: string) => readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');

describe('every skill', () => {
  it('exists for each actor plus the router and the decoder', () => {
    expect(names.sort()).toEqual([
      'moonbeam-acp-decoding',
      'moonbeam-actor-backer',
      'moonbeam-actor-challenger',
      'moonbeam-actor-client',
      'moonbeam-actor-doubter',
      'moonbeam-actor-evaluator',
      'moonbeam-actor-provider',
      'moonbeam-assurance',
    ]);
  });

  it.each(names)('%s has frontmatter whose name matches its directory', (name) => {
    const body = read(name);
    expect(body.startsWith('---\n')).toBe(true);
    expect(body).toMatch(new RegExp(`^name: ${name}$`, 'm'));
    expect(body).toMatch(/^description: .+/m);
  });

  it.each(names)('%s stays short enough to load cheaply', (name) => {
    expect(read(name).split('\n').length).toBeLessThanOrEqual(100);
  });

  /** Nothing may imply the contracts are live, because they are not. */
  it.each(names)('%s carries a "do not claim" boundary', (name) => {
    expect(read(name)).toMatch(/## Do not claim/);
  });

  it.each(names)('%s never claims the system is trustless', (name) => {
    expect(read(name).toLowerCase()).not.toContain('trustless');
  });
});

describe('actor skills state risk, not just reward', () => {
  const actorSkills = names.filter((n) => n.startsWith('moonbeam-actor-'));

  it.each(actorSkills)('%s leads with what the actor risks', (name) => {
    // The brand rule "both sides, always", enforced rather than remembered.
    expect(read(name)).toMatch(/## What you risk, first/);
  });

  /** Opposed actors must point at each other so a mis-loaded skill self-corrects. */
  it('points the backer and doubter at each other', () => {
    expect(read('moonbeam-actor-backer')).toContain('moonbeam-actor-doubter');
    expect(read('moonbeam-actor-doubter')).toContain('moonbeam-actor-backer');
  });

  it('points the client and provider at each other', () => {
    expect(read('moonbeam-actor-client')).toContain('moonbeam-actor-provider');
    expect(read('moonbeam-actor-provider')).toContain('moonbeam-actor-client');
  });

  it('points the evaluator and challenger at each other', () => {
    expect(read('moonbeam-actor-evaluator')).toContain('moonbeam-actor-challenger');
    expect(read('moonbeam-actor-challenger')).toContain('moonbeam-actor-evaluator');
  });
});

describe('the router', () => {
  it('names every actor skill it routes to', () => {
    const router = read('moonbeam-assurance');
    for (const name of names.filter((n) => n !== 'moonbeam-assurance')) {
      expect(router).toContain(name);
    }
  });
});

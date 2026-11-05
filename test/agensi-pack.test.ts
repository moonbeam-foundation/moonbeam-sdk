import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs script, no types
import { buildPack, packSkill } from '../scripts/agensi-pack.mjs';

describe('the Agensi pack', () => {
  it('adds the listing fields after the description and changes nothing else', () => {
    const text = '---\nname: demo\ndescription: Do one thing. Then more.\n---\n\n# Demo\n';
    const out: string = packSkill(text, { version: '1.2.3' });
    expect(out.split('\n').slice(3, 7)).toEqual([
      'summary: "Do one thing."',
      'version: "1.2.3"',
      'tags: ["moonbeam", "assurance", "agent-commerce", "base"]',
      'docs_url: "https://github.com/moonbeam-foundation/moonbeam-sdk/tree/main/skills/demo"',
    ]);
    expect(out.split('\n').filter((_, i) => i < 3 || i > 6).join('\n')).toBe(text);
  });

  it('builds every skill under skills/<name>/ with the README heading, within the upload limits', () => {
    const out = mkdtempSync(join(tmpdir(), 'moonbeam-agensi-test-'));
    const r = buildPack(out, { version: '0.0.0-test' });
    expect(r.skills).toBe(8);
    expect(r.files.length).toBeLessThanOrEqual(100);
    expect(r.bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(readFileSync(join(r.pack, 'README.md'), 'utf8')).toMatch(/^# Moonbeam assurance skills\n/);
    for (const f of r.files.filter((x: string) => x.endsWith('SKILL.md'))) {
      expect(f).toMatch(/^skills\/moonbeam-[a-z-]+\/SKILL\.md$/);
      const t = readFileSync(join(r.pack, f), 'utf8');
      expect(t).toMatch(/\nversion: "0\.0\.0-test"\n/);
      expect(t).not.toMatch(/taifoon|\bstak|harvest/i);
    }
  });
});

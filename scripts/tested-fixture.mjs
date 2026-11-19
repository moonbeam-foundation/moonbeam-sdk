// _VENUE_TESTED_v1_: a feature-matrix cell marked tested stands only on Moonbeam's own end-to-end run kept in this SDK as an I/O
// fixture: a JSON file under test/io that exists. Pure apart from the one existence check, which the caller can replace.
import { existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
/** whether `fixture` names an I/O fixture of this SDK (a test/io/….json path that exists) */
export const isIoFixture = (fixture, exists = (p) => existsSync(new URL(p, ROOT))) =>
  typeof fixture === 'string' && /^test\/io\/[\w/-]+(\.[\w-]+)*\.json$/.test(fixture) && !fixture.split('/').includes('..') && exists(fixture);

#!/usr/bin/env node
// After tsc: copy the vendored payment scheme (a .mjs file tsc does not emit) and its pin and types beside the built resale module.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist', 'resale'), { recursive: true });
for (const f of ['payment-scheme.mjs', 'payment-scheme.d.mts', 'payment-scheme.pin.json']) copyFileSync(join(root, 'src', 'resale', f), join(root, 'dist', 'resale', f));
console.log('postbuild: the vendored payment scheme sits beside dist/resale');

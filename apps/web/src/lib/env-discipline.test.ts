/**
 * Secrets must be read at RUNTIME, never at build time.
 *
 * This is structural, so the test is structural: it reads the sources rather
 * than asserting a behaviour, for the same reason the T009 registry test reads
 * `orchestrator.ts` instead of trusting that nobody will add an import.
 *
 * ## What went wrong, measured 2026-09-15
 *
 * `import.meta.env['SITE_PASSWORD']` looks like it reads the environment. In a
 * dev server it does, which is why three end-to-end checks passed. In a
 * production build **Vite substitutes the literal value**, so the password ends
 * up baked into the deployed function.
 *
 * Proven by building with a marker value and grepping the output: the marker
 * appeared in `virtual_astro_middleware.mjs` and `entrar_*.mjs`. After the
 * switch to `process.env`, it appears nowhere.
 *
 * Two consequences, and the second is the one that matters:
 *
 *  1. Changing the password in Vercel would do nothing without a rebuild,
 *     which breaks HU-07's "a configuration change, not a code change".
 *  2. **T023 is about to add `SUPABASE_SERVER_READ_KEY`.** The same mistake
 *     there bakes a database credential into a build artefact — and with N4
 *     that key can empty `quotes`.
 *
 * `import.meta.env.PROD` and friends are fine: they are build constants by
 * design, not secrets. Only the named variables below are checked.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Anything whose value is a secret or a deployment detail. A build-time read of
 * any of these is wrong for the same reason.
 */
const RUNTIME_ONLY = [
  'SITE_PASSWORD',
  'SUPABASE_URL',
  'SUPABASE_SERVER_READ_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.(ts|astro|mjs|js)$/.test(entry) && !entry.endsWith('.test.ts')) {
      found.push(full);
    }
  }
  return found;
}

describe('secrets are read at runtime, not inlined at build', () => {
  const files = sourceFiles(SRC);

  it('finds sources to check — a test over an empty set proves nothing', () => {
    assert.ok(files.length >= 4, `only found ${files.length} source files`);
  });

  for (const name of RUNTIME_ONLY) {
    it(`does not read ${name} through import.meta.env`, () => {
      const offenders = files.filter((file) => {
        const text = readFileSync(file, 'utf8');
        // Both spellings Vite substitutes: dotted and bracketed.
        return (
          text.includes(`import.meta.env.${name}`) ||
          text.includes(`import.meta.env['${name}']`) ||
          text.includes(`import.meta.env["${name}"]`)
        );
      });

      assert.deepEqual(
        offenders.map((f) => f.slice(SRC.length + 1)),
        [],
        `${name} must come from process.env: import.meta.env is substituted at build time`,
      );
    });
  }

  it('reads SITE_PASSWORD from process.env in both places that need it', () => {
    // The positive half. Without it, deleting the read entirely would pass.
    const readers = files.filter((file) =>
      readFileSync(file, 'utf8').includes("process.env['SITE_PASSWORD']"),
    );

    assert.equal(readers.length, 2, 'the middleware and the login form');
    assert.ok(readers.some((f) => f.endsWith('middleware.ts')));
    assert.ok(readers.some((f) => f.endsWith('entrar.astro')));
  });
});

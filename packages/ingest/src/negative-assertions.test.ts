/**
 * Every negative assertion names what it expects (2026-09-15).
 *
 * The rule this package already had written down: *"un test negativo que solo
 * comprueba «fallo» no prueba nada"*, because the defence under test, a broken
 * credential, a dead endpoint and a typo all look identical from outside. It
 * was written down, and then one assertion was written without a matcher
 * anyway — `trm.test.ts`, whose name promised it propagated a *transport*
 * failure while checking only that something threw.
 *
 * CI is what found it, and by accident: a missing `INGEST_USER_AGENT` threw a
 * different error at the whole suite, and three tests reported a message
 * mismatch while that one stayed green on the wrong error.
 *
 * So the rule stops depending on anybody remembering it. `assert.rejects` and
 * `assert.throws` take the expectation as a second argument — a regular
 * expression, an error class, or a validation function — and this check
 * fails if any call in the package omits it.
 *
 * ## Why it scans text
 *
 * There is no way to ask the test runner "was this assertion specific?". The
 * property lives in the source, so the check reads the source, same as the
 * T009 check that reads `orchestrator.ts` rather than asserting a property
 * that would quietly stop being true.
 *
 * ## Measured, not assumed
 *
 * The scanner has to skip string and template literals, or a comma inside a
 * message would read as an argument separator. It does not try to parse regular
 * expression literals, and it does not need to: the test below pins the total
 * it finds, so if the scanner ever starts missing calls — or inventing them
 * — that number moves and this file fails instead of going quietly green over
 * nothing. A check that silently matches zero calls is the failure mode that
 * already bit the T027 order verification.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));

/** Written this way on purpose: a literal backslash does not survive the
 * shell-written scripts this repo uses to edit files (CLAUDE.md, rule 4). */
const ESCAPE = String.fromCharCode(92);
/** Likewise: a backtick inside a shell-written script is command substitution. */
const BACKTICK = String.fromCharCode(96);

type Call = { readonly file: string; readonly line: number; readonly hasMatcher: boolean };

function testFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(resolve(SRC, dir), { withFileTypes: true })) {
    const child = dir === '.' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...testFilesUnder(child));
      continue;
    }
    // This file names the two calls in string literals so it can find them,
    // which makes it the one file where they are not calls. Scanning itself
    // reads those literals as a malformed call and throws.
    if (entry.name === 'negative-assertions.test.ts') continue;
    if (entry.name.endsWith('.test.ts')) found.push(child);
  }
  return found;
}

/**
 * Walks one call from its opening parenthesis and reports whether a comma
 * appears at the top level of the argument list — that is, a second argument.
 */
function hasSecondArgument(text: string, openIndex: number, file: string): boolean {
  let depth = 0;
  let quote = '';

  for (let i = openIndex; i < text.length; i += 1) {
    const char = text.charAt(i);

    if (quote !== '') {
      if (char === ESCAPE) {
        i += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }

    if (char === "'" || char === '"' || char === BACKTICK) {
      quote = char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) return false;
      continue;
    }

    if (char === ',' && depth === 1) return true;
  }

  throw new Error(`${file}: unbalanced call at index ${String(openIndex)}`);
}

function negativeAssertions(): Call[] {
  const calls: Call[] = [];

  for (const file of testFilesUnder('.')) {
    const text = readFileSync(resolve(SRC, file), 'utf8');

    for (const name of ['assert.rejects(', 'assert.throws(']) {
      let from = 0;
      for (;;) {
        const at = text.indexOf(name, from);
        if (at === -1) break;
        from = at + name.length;

        const openIndex = at + name.length - 1;
        calls.push({
          file,
          line: text.slice(0, at).split(String.fromCharCode(10)).length,
          hasMatcher: hasSecondArgument(text, openIndex, file),
        });
      }
    }
  }

  return calls;
}

describe('negative assertions say what they expect', () => {
  const calls = negativeAssertions();

  // Pinned so the scanner cannot pass by finding nothing. The exact number is
  // expected to move as tests are added; what must never happen is it dropping
  // toward zero while this file still reports success.
  it('finds the negative assertions at all', () => {
    assert.ok(
      calls.length >= 50,
      `expected the negative assertions of this package, found ${String(calls.length)}`,
    );
    assert.ok(
      calls.some((call) => call.file.includes('http.test.ts')),
      'the negative tests of the HTTP client are the ones most worth covering',
    );
  });

  it('every one of them names the error it expects', () => {
    const bare = calls
      .filter((call) => !call.hasMatcher)
      .map((call) => `${call.file}:${String(call.line)}`);

    assert.deepEqual(
      bare,
      [],
      'assert.rejects/throws needs a regexp, an error class or a validation ' +
        'function: without one the test passes on any failure, including the ' +
        'wrong one',
    );
  });
});

/**
 * Tests for the governance-document integrity check.
 *
 * Two halves, and the second matters as much as the first:
 *
 *  1. It must fail on the damage that actually happened — truncation to zero,
 *     a deleted heading, an eaten word.
 *  2. It must NOT fail on the healthy documents. The first draft of this
 *     checker flagged four intact lines in CLAUDE.md, and a checker that cries
 *     wolf is switched off by the second day. Those four shapes are pinned
 *     here so they cannot come back.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { driftRatio, type GovernedDoc, inspectDoc } from './docs-integrity.ts';

const DOC: GovernedDoc = {
  path: 'test.md',
  minBytes: 100,
  measuredBytes: 200,
  sections: ['## Estado actual', '### A medias'],
};

/** Healthy content, comfortably over the floor. */
function healthy(extra = ''): string {
  return (
    '# Título\n\n## Estado actual\n\n' +
    'Un párrafo de relleno que existe sólo para pasar el piso de bytes, ' +
    'repetido lo suficiente como para no disparar el umbral por accidente. ' +
    'Más texto todavía, porque cien bytes se alcanzan enseguida pero quiero ' +
    'margen de sobra para que los tests hablen de una cosa a la vez.\n\n' +
    '### A medias\n\nAlgo pendiente.\n' +
    extra
  );
}

function kinds(content: string, doc: GovernedDoc = DOC): string[] {
  return inspectDoc(doc, content).problems.map((p) => p.kind);
}

describe('damage that actually happened', () => {
  it('catches the truncation to zero bytes — twice in two days', () => {
    const report = inspectDoc(DOC, '');
    assert.ok(report.problems.some((p) => p.kind === 'empty'));
    assert.match(report.problems[0]?.detail ?? '', /EMPTY/);
  });

  it('catches a file that lost most of its content', () => {
    assert.ok(kinds('# Título\n\n## Estado actual\n\n### A medias\n').includes('too_small'));
  });

  it('catches a heading deleted by an off-by-one splice', () => {
    // Happened at least three times here, once deleting '### A medias'.
    const damaged = healthy().replace('### A medias', 'Algo que no es el heading');
    assert.ok(kinds(damaged).includes('missing_section'));
  });

  it('catches the word the shell ate, which no backtick rule could', () => {
    // The real incident: `pg_cron` in a python -c string was run as command
    // substitution. BOTH backticks went with the word, so parity was intact —
    // what was left behind was a gap in a sentence.
    const damaged = healthy('\nEl reloj cuenta desde que  dispara, no desde antes.\n');
    const problems = inspectDoc(DOC, damaged).problems;

    assert.ok(problems.some((p) => p.kind === 'gap_in_prose'));
    assert.ok(!problems.some((p) => p.kind === 'unclosed_backtick'), 'parity really is intact');
  });

  it('catches a single eaten backtick', () => {
    assert.ok(kinds(healthy('\nUn `span que no cierra.\n')).includes('unclosed_backtick'));
  });

  it('catches a write that stopped mid-file, leaving a fence open', () => {
    assert.ok(kinds(healthy('\n```sql\nselect 1;\n')).includes('unbalanced_fence'));
  });

  it('catches encoding damage, which renders as a box and survives review', () => {
    assert.ok(kinds(healthy('\nTexto da�ado.\n')).includes('replacement_char'));
  });
});

describe('healthy documents it must stay quiet about', () => {
  // Each of these was a false positive in the first draft, found by running it
  // against the real files rather than by imagining what it would do.

  it('an inline code span wrapped across two lines', () => {
    // CLAUDE.md has several. Counting backticks per line called them unclosed.
    const wrapped = healthy(
      '\nConfirmó las dos por separado — `RLS on all four\ntables, no policies`. Así que el candado no depende de una capa.\n',
    );
    assert.deepEqual(kinds(wrapped), []);
  });

  it('an indented code fence', () => {
    // Requiring column zero made the three backticks read as an odd count.
    assert.deepEqual(kinds(healthy('\n  ```sql\n  select 1;\n  ```\n')), []);
  });

  it('a table padded to align its columns', () => {
    const table = healthy(
      '\n| Proveedor     | Margen  |\n|---|---|\n| wise          | -0,0049 |\n',
    );
    assert.deepEqual(kinds(table), []);
  });

  it('SQL aligned inside a fence — all 75 of plan.md are this shape', () => {
    const sql = healthy('\n```sql\nid        text primary key,\nname      text not null,\n```\n');
    assert.deepEqual(kinds(sql), []);
  });

  it('says nothing at all about an intact document', () => {
    assert.deepEqual(kinds(healthy()), []);
  });
});

describe('drift against the measured size', () => {
  it('reports growth so a stale floor stays visible', () => {
    assert.equal(driftRatio(400, 200), 2);
    assert.equal(driftRatio(200, 200), 1);
  });

  it('does not divide by zero when nothing was measured', () => {
    assert.equal(driftRatio(100, 0), 0);
  });
});

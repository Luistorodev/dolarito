/**
 * Integrity of the governance documents.
 *
 * ## Why this exists
 *
 * CLAUDE.md was truncated to zero bytes **twice in two days**, both times by a
 * script that opened it for writing and then threw before writing anything —
 * once on a lone surrogate from an emoji written as a UTF-16 pair, once on the
 * shell eating an unescaped backtick mid-string. Both were caught by a human
 * happening to look at the file size afterwards.
 *
 * That is not a defence, it is luck. If a governance document is truncated and
 * nobody looks, the next session starts with no context at all and does not
 * know it — the same class of silent failure Art. VI is about, applied to the
 * documents instead of to the data.
 *
 * ## What each rule is FOR
 *
 * Every rule targets a failure that actually happened in this repository. A
 * check nobody can explain gets disabled the first time it is inconvenient.
 *
 * | Rule | Catches |
 * |---|---|
 * | Size floor | Truncation to zero, or catastrophic loss |
 * | Required sections | A heading deleted by an off-by-one line splice |
 * | Balanced fences | A write that stopped mid-file |
 * | Unclosed backtick span | One backtick of a pair eaten |
 * | Repeated spaces in prose | A whole inline span eaten, leaving a gap |
 * | Replacement characters | Encoding damage from a bad round-trip |
 *
 * ## Two rules that had to be measured before they were trusted
 *
 * The first draft of this file flagged four healthy lines in CLAUDE.md, because
 * it counted backticks per line and required fences at column zero. A checker
 * that cries wolf on intact files is ignored by the second day, so:
 *
 * - **Backticks are tracked across the whole document**, not per line. Markdown
 *   lets an inline span wrap, and CLAUDE.md has several that do.
 * - **Fences may be indented** up to three spaces, per CommonMark.
 * - **Repeated spaces are only counted in prose** — outside fenced blocks and
 *   outside table rows. Measured first: counted naively there are 75 in
 *   plan.md, all of them aligned SQL inside code blocks. Excluding fences and
 *   tables the count is **zero across all five documents**, so a hit is signal.
 *
 * That last rule is the one that catches the real incident. When the shell ate
 * `` `pg_cron` `` it took **both** backticks with the word, so parity was
 * preserved and no backtick rule could have noticed — what it left behind was
 * `"desde que  dispara"`, a gap in a sentence.
 */

/** A document worth failing over. */
export type GovernedDoc = {
  path: string;
  /**
   * Bytes below which the file is presumed damaged.
   *
   * Roughly 70% of the size measured on 2026-09-14, recorded in
   * `measuredBytes`. The gap is slack for ordinary editing; these documents
   * grow, they do not shrink by a third.
   */
  minBytes: number;
  /** Size when the floor was set, so staleness is visible rather than implicit. */
  measuredBytes: number;
  /**
   * Headings that must be present, verbatim.
   *
   * Read out of the files rather than remembered — the same discipline that
   * `cron.job_run_details.jobname` taught the hard way. Chosen for load-bearing
   * sections: losing any of these changes what a reader believes about the
   * project, which is the damage worth failing over.
   */
  sections: string[];
};

export const GOVERNED_DOCS: GovernedDoc[] = [
  {
    path: 'CLAUDE.md',
    minBytes: 45_000,
    measuredBytes: 67_150,
    sections: [
      '## Documentos de gobierno',
      '## Reglas de trabajo',
      '## Convenciones técnicas',
      '### Tests negativos',
      '## Estado actual',
      '### Completado',
      '### A medias',
    ],
  },
  {
    path: '.specify/memory/constitution.md',
    minBytes: 6_800,
    measuredBytes: 9_812,
    sections: [
      '## Artículo I — Integridad del dato',
      '## Artículo II — Aislamiento de fallos',
      '## Artículo III — Comparabilidad honesta',
      '## Artículo IV — Honestidad con quien lo usa',
      '## Artículo V — Respeto a las fuentes',
      '## Artículo VI — Observabilidad antes que funcionalidad',
      '## Artículo VII — El contrato manda',
      '## Gobernanza',
    ],
  },
  {
    path: 'specs/001-dolarito/spec.md',
    minBytes: 10_000,
    measuredBytes: 14_254,
    sections: [
      '## 1. Problema',
      '## 4. Historias de usuario',
      '## 5. Requisitos funcionales',
      '## 6. Fuentes incluidas (alcance congelado)',
      '## 7. Explícitamente fuera de alcance',
    ],
  },
  {
    path: 'specs/001-dolarito/plan.md',
    minBytes: 32_000,
    measuredBytes: 46_513,
    sections: [
      '## 1. Decisiones de stack',
      '## 2. Esquema de datos',
      '## 3. Contrato del adapter',
      '## 4. Estructura del repo',
      '## 5. Observabilidad',
      '## 7. Riesgos',
    ],
  },
  {
    path: 'specs/001-dolarito/tasks.md',
    minBytes: 22_000,
    measuredBytes: 31_700,
    sections: [
      '## Fase 0 — Cimientos',
      '## Fase 3 — Adapters, de simple a complejo',
      '## Fase 4 — Operación',
      '## Fase 5 — Frontend',
      '## Dependencias',
      '## Bloqueos conocidos',
    ],
  },
];

export type Problem = { kind: string; detail: string };

export type DocReport = {
  path: string;
  bytes: number;
  minBytes: number;
  measuredBytes: number;
  problems: Problem[];
};

/** Up to three spaces of indentation, per CommonMark. */
const FENCE = /^ {0,3}```/;
/** A table row, which legitimately pads with spaces to align columns. */
const TABLE_ROW = /^\s*\|/;
/** Two or more spaces between two non-space characters: a gap where a word was. */
const GAP_IN_PROSE = / {2,}/;

/** How far the file has drifted from the size its floor was set against. */
export function driftRatio(bytes: number, measuredBytes: number): number {
  return measuredBytes === 0 ? 0 : bytes / measuredBytes;
}

/**
 * Inspects one document's content.
 *
 * Takes the text rather than reading the file, so every rule is testable
 * without touching the repository — and so the tests can construct the damage
 * instead of waiting for it to happen again.
 */
export function inspectDoc(doc: GovernedDoc, content: string): DocReport {
  const bytes = Buffer.byteLength(content, 'utf8');
  const problems: Problem[] = [];

  // Truncation. Zero is called out separately because it is the case that
  // actually happened, twice, and it deserves to say so plainly rather than
  // hide inside a threshold message.
  if (bytes === 0) {
    problems.push({ kind: 'empty', detail: 'the file is EMPTY — a write truncated it' });
  } else if (bytes < doc.minBytes) {
    problems.push({
      kind: 'too_small',
      detail: `${bytes} bytes, below the floor of ${doc.minBytes} — presumed truncated`,
    });
  }

  // A heading lost to an off-by-one line splice. Happened at least three times
  // in this repository, once deleting the '### A medias' heading outright.
  for (const section of doc.sections) {
    if (!content.includes(section)) {
      problems.push({ kind: 'missing_section', detail: `section not found: ${section}` });
    }
  }

  const lines = content.split('\n');
  let inFence = false;
  let fenceCount = 0;
  let openSpanLine: number | undefined;
  let ticksOpen = false;

  lines.forEach((line, index) => {
    const lineNo = index + 1;

    if (FENCE.test(line)) {
      fenceCount += 1;
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    // Backtick parity carried ACROSS lines: a span may legitimately wrap.
    for (const _ of line.matchAll(/`/g)) {
      ticksOpen = !ticksOpen;
      if (ticksOpen) openSpanLine = lineNo;
    }

    // A gap where a word used to be. Only in prose: table rows pad to align,
    // and fenced code aligns its columns.
    if (!TABLE_ROW.test(line)) {
      const trimmed = line.replace(/\s+$/, '');
      // Leading indentation is normal; look only after the first word.
      const body = trimmed.replace(/^\s+/, '');
      if (GAP_IN_PROSE.test(body)) {
        problems.push({
          kind: 'gap_in_prose',
          detail: `line ${lineNo}: repeated spaces — a word may have been eaten: ${body.slice(0, 60)}`,
        });
      }
    }
  });

  if (fenceCount % 2 !== 0) {
    problems.push({
      kind: 'unbalanced_fence',
      detail: `${fenceCount} code fences — one is unclosed, the file may be cut short`,
    });
  }

  if (ticksOpen) {
    problems.push({
      kind: 'unclosed_backtick',
      detail: `an inline code span opened near line ${openSpanLine ?? '?'} is never closed`,
    });
  }

  // U+FFFD is what a bad encoding round-trip leaves behind. It renders as a
  // box, so it survives review far more easily than missing text does.
  if (content.includes('�')) {
    problems.push({ kind: 'replacement_char', detail: 'contains U+FFFD — encoding was damaged' });
  }

  return {
    path: doc.path,
    bytes,
    minBytes: doc.minBytes,
    measuredBytes: doc.measuredBytes,
    problems,
  };
}

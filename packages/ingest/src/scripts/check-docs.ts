/**
 * `pnpm check:docs` — are the governance documents intact?
 *
 * Reads the five files and reports every problem in all of them, then exits 1
 * if any turned up. It does not stop at the first, for the same reason the
 * pg_cron verifier no longer does: a checker that aborts early reports one
 * problem and hides the rest.
 *
 * The rules and the reasoning live in ../docs-integrity.ts.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DocReport, driftRatio, GOVERNED_DOCS, inspectDoc } from '../docs-integrity.ts';

// packages/ingest/src/scripts -> repository root
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function main(): void {
  const reports: DocReport[] = [];
  let unreadable = 0;

  for (const doc of GOVERNED_DOCS) {
    let content: string;
    try {
      content = readFileSync(join(ROOT, doc.path), 'utf8');
    } catch (error) {
      // A missing governance document is the loudest possible failure, so it
      // is reported as one rather than throwing and taking the rest with it.
      unreadable += 1;
      console.error(`  ✖ ${doc.path}`);
      console.error(`      UNREADABLE — ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    reports.push(inspectDoc(doc, content));
  }

  let failed = unreadable;

  for (const report of reports) {
    const drift = driftRatio(report.bytes, report.measuredBytes);
    const size = `${report.bytes} bytes (floor ${report.minBytes})`;

    if (report.problems.length === 0) {
      console.log(`  ✔ ${report.path.padEnd(34)} ${size}`);
    } else {
      failed += 1;
      console.error(`  ✖ ${report.path.padEnd(34)} ${size}`);
      for (const problem of report.problems) {
        console.error(`      [${problem.kind}] ${problem.detail}`);
      }
    }

    // Not a failure. The floors are measured values with a date on them, and
    // a document that has doubled since deserves a raised floor — otherwise
    // the check quietly weakens as the project grows.
    if (drift > 1.6) {
      console.log(
        `      note: ${Math.round(drift * 100)}% of its measured size — ` +
          'consider raising the floor in docs-integrity.ts',
      );
    }
  }

  console.log('');

  if (failed > 0) {
    console.error(`DOCUMENT INTEGRITY FAILED: ${failed} of ${GOVERNED_DOCS.length} file(s)`);
    process.exitCode = 1;
    return;
  }

  console.log(`All ${GOVERNED_DOCS.length} governance documents are intact.`);
}

main();

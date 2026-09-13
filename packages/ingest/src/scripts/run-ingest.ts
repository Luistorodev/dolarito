/**
 * The ingest entry point (T018).
 *
 * One cycle: open a run, resolve both references, then every quote adapter,
 * persist, and close. This is what the cron invokes and the only place where
 * the registry, the orchestrator and the real database meet.
 *
 * The exit code is the whole point of it being a script rather than a library
 * call: Actions turns a non-zero exit red, and plan.md §5.1 defines exactly
 * when that should happen.
 */

import { createSupabaseRunStore } from '../db.ts';
import { runIngest } from '../orchestrator.ts';
import { ADAPTERS, assertRegistryIsCoherent } from '../registry.ts';

const BRACKETS = [1, 100, 500, 1000];

async function main(): Promise<void> {
  // Cheap, and it catches the class of mistake that would otherwise corrupt
  // the coverage metric silently: a provider claimed twice, or one that is not
  // in the catalogue at all.
  assertRegistryIsCoherent();

  const startedAt = Date.now();
  const outcome = await runIngest({
    adapters: ADAPTERS,
    store: createSupabaseRunStore(),
    brackets: BRACKETS,
  });

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`run ${outcome.runId} finished in ${seconds}s`);
  console.log(`  quotes saved:     ${outcome.quotesSaved}`);
  console.log(`  references saved: ${outcome.referencesSaved}`);
  console.log(`  sources ok:       ${outcome.sourcesOk.join(', ') || '(none)'}`);

  for (const [id, reason] of Object.entries(outcome.sourcesFailed)) {
    console.log(`  FAILED ${id}: ${reason}`);
  }

  if (outcome.providersLost.length > 0) {
    console.log(`  providers lost:   ${outcome.providersLost.join(', ')}`);
  }

  if (outcome.exitCode === 0) {
    console.log('run is green');
    return;
  }

  // Named one by one so the Actions log says why without anyone opening the
  // database.
  console.error('run is RED:');
  for (const reason of outcome.exitReasons) console.error(`  - ${reason}`);
  process.exitCode = outcome.exitCode;
}

await main();

/**
 * The daily silence check (T019).
 *
 * Reads `quotes` and `runs` and exits non-zero if anything has gone quiet.
 * The logic lives in `silence.ts` and is tested without a database; this only
 * fetches and prints.
 *
 * Running it daily also keeps the repository active, which is what stops
 * Actions disabling the cron for inactivity (plan.md §5).
 */

import { PROVIDERS } from '../lib/providers.ts';
import { createServiceRoleClient } from '../lib/supabase.ts';
import {
  buildReport,
  EXPECTED_INTERVAL_MINUTES,
  type QuoteSighting,
  type RunSighting,
  SILENCE_HOURS,
} from '../silence.ts';

async function main(): Promise<void> {
  const supabase = createServiceRoleClient();
  const since = new Date(Date.now() - SILENCE_HOURS * 3_600_000).toISOString();

  const { data: quotes, error: quotesError } = await supabase
    .from('quotes')
    .select('provider_id, captured_at')
    .gte('captured_at', since);
  if (quotesError) throw new Error(`could not read quotes: ${quotesError.message}`);

  // Runs inside the window, for the cadence check and the reference verdict.
  const { data: windowRuns, error: runsError } = await supabase
    .from('runs')
    .select('started_at, mid_market, mid_market_at')
    .gte('started_at', since)
    .order('started_at', { ascending: false });
  if (runsError) throw new Error(`could not read runs: ${runsError.message}`);

  let runs = windowRuns ?? [];

  // If nothing ran inside the window at all, the window holds no evidence of
  // the outage — the hole has to be measured against the last run that does
  // exist, however old. Without this the longest outages are the quietest,
  // which is exactly backwards.
  if (runs.length === 0) {
    const { data: newest, error: newestError } = await supabase
      .from('runs')
      .select('started_at, mid_market, mid_market_at')
      .order('started_at', { ascending: false })
      .limit(1);
    if (newestError) throw new Error(`could not read runs: ${newestError.message}`);
    runs = newest ?? [];
  }

  const report = buildReport(
    PROVIDERS.map((provider) => provider.id),
    (quotes ?? []) as QuoteSighting[],
    runs as RunSighting[],
  );

  console.log(`window: ${SILENCE_HOURS}h, from ${since}`);
  console.log(
    `providers reporting: ${PROVIDERS.length - report.silentProviders.length} of ${PROVIDERS.length}`,
  );
  console.log(`mid_market: ${report.reference.kind}`);
  console.log(`runs in window: ${runs.length} (cadence: every ${EXPECTED_INTERVAL_MINUTES} min)`);

  if (report.problems.length === 0) {
    console.log('');
    console.log('Nothing is silent.');
    return;
  }

  console.error('');
  console.error(`SILENCE DETECTED (${report.problems.length}):`);
  for (const problem of report.problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
}

await main();

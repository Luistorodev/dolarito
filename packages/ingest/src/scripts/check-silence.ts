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
  collectSightings,
  EXPECTED_INTERVAL_MINUTES,
  type RunSighting,
  SILENCE_HOURS,
} from '../silence.ts';

async function main(): Promise<void> {
  const supabase = createServiceRoleClient();
  const since = new Date(Date.now() - SILENCE_HOURS * 3_600_000).toISOString();
  const providerIds = PROVIDERS.map((provider) => provider.id);

  // One query per provider, asking only for its newest row.
  //
  // NOT a bulk query over the window. That is what produced the false RED on
  // 2026-09-15: PostgREST capped the result at 1000 of the 1924 rows present,
  // and the rows it dropped happened to be every single one belonging to wise,
  // instarem and western_union. All three were reported as having "no rows at
  // all, ever" while they had written seconds before.
  //
  // Eight one-row queries have no cap to reach, so this cannot come back as the
  // window grows — and the window only grows from here.
  const sightings = await collectSightings(providerIds, async (providerId) => {
    const { data, error } = await supabase
      .from('quotes')
      .select('captured_at')
      .eq('provider_id', providerId)
      .order('captured_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(`could not read quotes for ${providerId}: ${error.message}`);
    const row = data?.[0] as { captured_at?: string } | undefined;
    return row?.captured_at;
  });

  // Runs inside the window, for the cadence check and the reference verdict.
  const { data: windowRuns, error: runsError } = await supabase
    .from('runs')
    // sources_ok comes along because the reference verdict needs it to tell a
    // stale upstream from something of ours — without it, it errs loud.
    .select('started_at, mid_market, mid_market_at, sources_ok')
    .gte('started_at', since)
    .order('started_at', { ascending: false });
  if (runsError) throw new Error(`could not read runs: ${runsError.message}`);

  // One run from BEYOND the window edge, always.
  //
  // A hole that starts before the window and ends inside it is otherwise
  // invisible: the run that opens it falls outside the query, so the check
  // sees a lone run and can only describe the trailing hole. Measured on
  // 2026-09-14 — an 8h51m overnight hole would not have been reported, and had
  // anything landed just before the daily check it would have said "nothing is
  // silent" with that hole right behind it. Same family as the false green of
  // the day before: the window bounds what the check can see.
  //
  // It also covers the case where nothing ran inside the window at all, which
  // is the longest outage of all and was otherwise the quietest.
  const { data: edgeRun, error: edgeError } = await supabase
    .from('runs')
    .select('started_at, mid_market, mid_market_at, sources_ok')
    .lt('started_at', since)
    .order('started_at', { ascending: false })
    .limit(1);
  if (edgeError) throw new Error(`could not read runs: ${edgeError.message}`);

  const runs = [...(windowRuns ?? []), ...(edgeRun ?? [])];

  const report = buildReport(providerIds, sightings, runs as RunSighting[]);

  console.log(`window: ${SILENCE_HOURS}h, from ${since}`);
  console.log(
    `providers reporting: ${PROVIDERS.length - report.silentProviders.length} of ${PROVIDERS.length}`,
  );
  console.log(
    `mid_market: ${report.reference.kind}` +
      (report.reference.kind === 'stale_source'
        ? ` (frozen ${report.reference.frozenHours.toFixed(1)}h — our ingest is fine)`
        : ''),
  );
  console.log(
    `runs in window: ${(windowRuns ?? []).length} (cadence: every ${EXPECTED_INTERVAL_MINUTES} min` +
      `${(edgeRun ?? []).length > 0 ? ', plus one from before the edge' : ''})`,
  );

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

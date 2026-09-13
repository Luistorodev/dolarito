/**
 * T011b — seed the daily USD/COP history.
 *
 * A one-off load into `market_history`. DML, so it runs here with the
 * service_role key rather than by hand in the SQL Editor (CLAUDE.md, "Cómo se
 * aplica el SQL").
 *
 * Upsert on `d`: re-running must be harmless, and a re-seed is exactly what
 * `loaded_at` exists to make visible (N5). It touches `market_history` and
 * nothing else — the done criterion includes `runs` being untouched, so the
 * script checks that itself rather than asking anyone to trust it.
 */

import { createServiceRoleClient } from '../lib/supabase.ts';
import { fetchHistory, HISTORY_SRC } from '../references/market-history.ts';

/** Six months of business days, the floor the task sets. */
const MINIMUM_ROWS = 126;

/** PostgREST takes a large body fine, but a bounded batch fails more legibly. */
const BATCH = 250;

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!condition) failures.push(message);
}

async function countRows(
  supabase: ReturnType<typeof createServiceRoleClient>,
  table: string,
): Promise<number> {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`could not count ${table}: ${error.message}`);
  return count ?? 0;
}

async function main(): Promise<void> {
  const supabase = createServiceRoleClient();

  const runsBefore = await countRows(supabase, 'runs');
  const quotesBefore = await countRows(supabase, 'quotes');

  console.log('fetching the daily series from Yahoo:');
  const { rows, skipped } = await fetchHistory();
  console.log(`  ${rows.length} usable closes`);
  console.log(
    `  skipped ${skipped.noClose} with no close (holidays), ` +
      `${skipped.notYetClosed} still open`,
  );

  if (rows.length === 0) {
    console.error('nothing to seed');
    process.exitCode = 1;
    return;
  }

  const first = rows[0]?.d;
  const last = rows[rows.length - 1]?.d;
  console.log(`  range ${first} -> ${last}`);

  console.log('');
  console.log('writing to market_history:');
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH).map((row) => ({
      d: row.d,
      close: row.close,
      src: HISTORY_SRC,
    }));

    const { error } = await supabase.from('market_history').upsert(batch, { onConflict: 'd' });
    if (error) {
      console.error(`  upsert failed at row ${start}: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`  wrote ${start + batch.length} / ${rows.length}`);
  }

  console.log('');
  console.log('checking the done criterion:');

  const total = await countRows(supabase, 'market_history');
  check(total >= MINIMUM_ROWS, `${total} rows, at least ${MINIMUM_ROWS} required`);

  const { data: span, error: spanError } = await supabase
    .from('market_history')
    .select('d')
    .order('d', { ascending: true });
  if (spanError) throw new Error(`could not read back: ${spanError.message}`);

  const days = (span ?? []) as Array<{ d: string }>;
  const oldest = days[0]?.d;
  const newest = days[days.length - 1]?.d;
  const months =
    (Date.parse(`${newest}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / 86_400_000 / 30.44;
  check(months >= 6, `${months.toFixed(1)} months of series (${oldest} -> ${newest})`);

  // The timezone conversion is what this proves. Read as naive UTC, a year of
  // bars lands 31 Sundays; read in the exchange timezone, none at all.
  const weekend = days.filter((row) => {
    const day = new Date(`${row.d}T12:00:00Z`).getUTCDay();
    return day === 0 || day === 6;
  });
  check(weekend.length === 0, `no weekend rows (${weekend.length} found)`);

  const runsAfter = await countRows(supabase, 'runs');
  const quotesAfter = await countRows(supabase, 'quotes');
  check(runsAfter === runsBefore, `runs untouched at ${runsAfter}`);
  check(quotesAfter === quotesBefore, `quotes untouched at ${quotesAfter}`);

  console.log('');
  if (failures.length > 0) {
    console.error(`T011b FAILED (${failures.length}): ${failures.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('T011b OK: the history is seeded, and nothing else moved.');
}

await main();

/**
 * T004 — seed the provider catalogue.
 *
 * DML, so it runs here with the service_role key rather than by hand in the
 * SQL Editor (see CLAUDE.md, "Cómo se aplica el SQL").
 *
 * Upsert rather than insert: re-running must be harmless. `providers` is a
 * catalogue, not an observation log, so the no-UPDATE rule that protects
 * `quotes` does not apply to it.
 *
 * Exits non-zero if the done criterion is not met: eight rows, none of them
 * missing `asset` or `channel`.
 */

import { PROVIDERS } from '../lib/providers.ts';
import { createServiceRoleClient } from '../lib/supabase.ts';

const EXPECTED_COUNT = 8;

async function main(): Promise<void> {
  const supabase = createServiceRoleClient();

  const { error: upsertError } = await supabase
    .from('providers')
    .upsert([...PROVIDERS], { onConflict: 'id' });

  if (upsertError) {
    console.error(`Seed failed: ${upsertError.message}`);
    process.exitCode = 1;
    return;
  }

  // Read back rather than trust the write: the criterion is about what the
  // table holds, not about what we sent.
  const { data, error: readError } = await supabase
    .from('providers')
    .select('id, name, mode, asset, channel')
    .order('mode', { ascending: true })
    .order('id', { ascending: true });

  if (readError) {
    console.error(`Read-back failed: ${readError.message}`);
    process.exitCode = 1;
    return;
  }

  const rows = data ?? [];
  const problems: string[] = [];

  if (rows.length !== EXPECTED_COUNT) {
    problems.push(`expected ${EXPECTED_COUNT} rows, found ${rows.length}`);
  }

  for (const row of rows) {
    if (row.asset === null) problems.push(`${row.id}: asset is null`);
    if (row.channel === null) problems.push(`${row.id}: channel is null`);
  }

  console.log(`Providers in the catalogue: ${rows.length}`);
  for (const row of rows) {
    console.log(
      `  ${row.mode.padEnd(6)} ${row.id.padEnd(14)} ${row.asset.padEnd(4)} ${row.channel}`,
    );
  }

  if (problems.length > 0) {
    console.error(`\nT004 FAILED: ${problems.join('; ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nT004 OK: ${EXPECTED_COUNT} rows, every one with asset and channel.`);
}

await main();

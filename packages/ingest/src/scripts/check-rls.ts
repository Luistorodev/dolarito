/**
 * T005 — prove that RLS does what plan.md §2.3 says.
 *
 * Done criterion: the anon key fails to read AND fails to write, and a server
 * key reads correctly.
 *
 * On "server key": the only factory key in Supabase that can read is the secret
 * one, which can also write. Using it here is what we have, not what the web
 * tier should end up with — that is decision N4, due before T023.
 *
 * On "fails to read": RLS with no policies returns an empty set, not an error.
 * The migration also revokes privileges from anon so that a read is a hard
 * permission error. Either outcome means no data leaked, so both are accepted
 * and the script reports which one actually happened.
 */

import { readSupabaseEnv } from '../lib/env.ts';
import { createAnonClient, createServiceRoleClient } from '../lib/supabase.ts';

const PROTECTED = ['providers', 'runs', 'quotes', 'market_history', 'latest_quotes'] as const;
const EXPECTED_PROVIDERS = 8;

const failures: string[] = [];

function pass(message: string): void {
  console.log(`  ok    ${message}`);
}

function fail(message: string): void {
  console.log(`  FAIL  ${message}`);
  failures.push(message);
}

/**
 * Proves the anon key is one this project accepts, before any RLS assertion
 * runs.
 *
 * Without this the suite is worthless: an invalid key makes every "must not
 * read" check pass for the wrong reason, because the gateway rejects the
 * request before RLS is ever consulted. `/auth/v1/settings` is the right probe
 * — it answers on key validity alone and has no RLS to hide behind.
 *
 * Returns false instead of exiting: calling process.exit() while a fetch
 * connection is still open trips a libuv assertion on Windows and loses the
 * exit code entirely.
 */
async function assertAnonKeyIsAccepted(): Promise<boolean> {
  const env = readSupabaseEnv();
  const response = await fetch(`${env.url}/auth/v1/settings`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${env.anonKey}` },
  });

  if (response.ok) return true;

  const body = (await response.text()).slice(0, 300);
  console.error('T005 INCONCLUSIVE: the project rejects SUPABASE_ANON_KEY itself, so every');
  console.error('negative check below would pass without RLS having anything to do with it.');
  console.error(`  GET /auth/v1/settings -> ${response.status} ${body}`);
  console.error('Fix the key in .env (Supabase dashboard -> Project Settings -> API Keys,');
  console.error('the publishable key for this project), then run this again.');
  return false;
}

async function main(): Promise<void> {
  if (!(await assertAnonKeyIsAccepted())) {
    process.exitCode = 1;
    return;
  }

  const anon = createAnonClient();
  const server = createServiceRoleClient();

  console.log('anon key must not read:');
  for (const table of PROTECTED) {
    const { data, error } = await anon.from(table).select('*').limit(1);

    if (error) {
      pass(`${table}: rejected — ${error.message}`);
    } else if ((data ?? []).length === 0) {
      pass(`${table}: no error, but zero rows (RLS with no policy)`);
    } else {
      fail(`${table}: LEAKED ${(data ?? []).length} row(s) to the anon key`);
    }
  }

  console.log('');
  console.log('anon key must not write:');
  const { error: writeError } = await anon.from('providers').insert({
    id: '__rls_probe__',
    name: 'rls probe',
    mode: 'local',
    asset: 'usdt',
    channel: 'exchange',
  });

  if (writeError) {
    pass(`providers insert rejected — ${writeError.message}`);
  } else {
    fail('providers insert was ACCEPTED with the anon key');
  }

  console.log('');
  console.log('server key must read:');
  const { data: rows, error: readError } = await server.from('providers').select('id');

  if (readError) {
    fail(`providers read failed with the server key — ${readError.message}`);
  } else if ((rows ?? []).length !== EXPECTED_PROVIDERS) {
    fail(`providers read returned ${(rows ?? []).length} rows, expected ${EXPECTED_PROVIDERS}`);
  } else {
    pass(`providers: ${(rows ?? []).length} rows`);
  }

  // If the anon write slipped through, do not leave the probe row behind.
  if (!writeError) {
    await server.from('providers').delete().eq('id', '__rls_probe__');
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`T005 FAILED (${failures.length}): ${failures.join('; ')}`);
    process.exitCode = 1;
    return;
  }

  console.log('T005 OK: anon reads nothing, anon writes nothing, server key reads.');
}

await main();

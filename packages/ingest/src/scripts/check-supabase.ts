/**
 * T002 verification script: connect to Supabase and list the tables.
 *
 * Run with:  pnpm --filter @dolarito/ingest run check:supabase
 *
 * Prints no key material. Exits non-zero on any failure so it can be reused
 * as a smoke test from CI.
 */

import { MissingEnvError, readSupabaseEnv } from '../lib/env.ts';
import { createServiceRoleClient } from '../lib/supabase.ts';

/** Tables and views PostgREST exposes, read from its OpenAPI root document. */
async function listExposedRelations(url: string, key: string): Promise<readonly string[]> {
  const response = await fetch(new URL('/rest/v1/', url), {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `PostgREST root returned ${response.status} ${response.statusText}. ` +
        `Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`,
    );
  }

  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('definitions' in body)) return [];

  const definitions = body.definitions;
  if (typeof definitions !== 'object' || definitions === null) return [];

  return Object.keys(definitions).sort();
}

async function main(): Promise<void> {
  const env = readSupabaseEnv();
  console.log(`Project:  ${env.url}`);
  console.log('Keys:     SUPABASE_SERVICE_ROLE_KEY set, SUPABASE_ANON_KEY set');

  // Proves the dependency wires up and the key parses before any network call.
  createServiceRoleClient();

  const relations = await listExposedRelations(env.url, env.serviceRoleKey);

  console.log(`\nConnected. Tables and views exposed: ${relations.length}`);
  for (const name of relations) console.log(`  - ${name}`);

  if (relations.length === 0) {
    console.log('  (none yet — the schema migration is T003)');
  }
}

try {
  await main();
} catch (error: unknown) {
  if (error instanceof MissingEnvError) {
    console.error(`\n${error.message}`);
  } else {
    console.error('\nCould not reach Supabase.');
    if (error instanceof Error) {
      // fetch() reports a bare 'fetch failed'; the detail sits in `cause`.
      const cause = error.cause;
      const detail = cause instanceof Error ? ` (${cause.message})` : '';
      console.error(`${error.message}${detail}`);
    } else {
      console.error(String(error));
    }
  }
  process.exitCode = 1;
}

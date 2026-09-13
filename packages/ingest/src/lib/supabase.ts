import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { readSupabaseEnv } from './env.ts';

/**
 * Supabase access for the ingest tier.
 *
 * This package always writes with the service_role key and always runs on a
 * server (GitHub Actions). The key must never reach a browser bundle
 * (plan.md 2.3). The web tier reads with its own server key and does not
 * import anything from here.
 */
export function createServiceRoleClient(): SupabaseClient {
  const env = readSupabaseEnv();

  return createClient(env.url, env.serviceRoleKey, {
    auth: {
      // No user sessions here: this is a cron job, not a browser.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

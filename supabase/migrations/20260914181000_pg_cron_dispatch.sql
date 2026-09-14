-- pg_cron dispatches the ingest through GitHub's workflow_dispatch API.
--
-- WHY THIS SHAPE. GitHub's *runner* works: 44 s, green, 8 of 8 sources. What
-- fails is GitHub's *scheduler* — measured 2026-09-14, 2 runs fired out of ~66
-- expected in 16 h, a 97% drop rate, and neither landed on the cron minutes
-- actually deployed. So only the trigger is replaced. Moving the work itself to
-- an Edge Function would have swapped a working Node runtime (the one all 257
-- tests exercise) for Deno, and traded Actions' logs for a thinner viewer —
-- changing what works to fix what does not.
--
-- ⚠️ DO NOT APPLY until the PAT exists and is stored in Vault (step 1 below).
-- Scheduling first would run a job that 401s every 15 minutes.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- pg_cron: the scheduler. pg_net: async HTTP from inside Postgres, which is
-- what lets a scheduled job reach an external API without an intermediary.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- 1. The secret — run this ONCE, by hand, with the real token
-- ---------------------------------------------------------------------------
-- Kept in Vault rather than inline in the job definition: `cron.job` is a plain
-- table, and a token pasted into its command column is readable by anything
-- with database access. N4 already accepted one credential risk; this does not
-- add a second.
--
--   select vault.create_secret(
--     'ghp_REPLACE_WITH_THE_REAL_TOKEN',
--     'github_pat_dispatch',
--     'Fine-grained PAT, Actions:write on Luistorodev/dolarito only. Used by '
--     'pg_cron to dispatch the ingest workflow.'
--   );
--
-- To rotate later, without touching the job:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'github_pat_dispatch'),
--     'ghp_THE_NEW_TOKEN'
--   );

-- ---------------------------------------------------------------------------
-- 2. The schedule
-- ---------------------------------------------------------------------------
-- Every 15 minutes, on the round minutes. The contended-minute concern was
-- about GitHub's scheduler deciding when to fire; pg_cron fires when told, and
-- a workflow_dispatch runs immediately rather than waiting in that queue.
--
-- Deliberately OFF the minutes ingest.yml uses (7,22,37,52). While both routes
-- are live, the timestamp alone separates them — a second, independent reading
-- of `trigger_src` rather than a single point of truth.
select cron.schedule(
  'dispatch-ingest',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://api.github.com/repos/Luistorodev/dolarito/actions/workflows/ingest.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'github_pat_dispatch'
      ),
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      -- GitHub's API rejects requests without one, and Art. V.4 asks for an
      -- honest identity with a way to reach us anyway.
      'User-Agent', 'dolarito-pg-cron (+https://github.com/Luistorodev/dolarito)',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'ref', '001-dolarito',
      -- This is what makes the run attributable. The workflow turns it into
      -- INGEST_TRIGGER, which becomes runs.trigger_src. Without it a pg_cron
      -- dispatch is indistinguishable from someone clicking "Run workflow".
      'inputs', jsonb_build_object('trigger', 'pg_cron')
    )
  );
  $job$
);

-- ---------------------------------------------------------------------------
-- Undo, if this route has to be rolled back
-- ---------------------------------------------------------------------------
--   select cron.unschedule('dispatch-ingest');

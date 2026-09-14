-- Verifier for the pg_cron dispatch route.
--
-- Run it a few minutes AFTER applying the schedule, so at least one firing has
-- happened. It asserts the job exists and — the part that matters — that the
-- firings actually succeeded, because a job that runs and 401s every 15 minutes
-- looks identical to a healthy one from the job list alone.

do $$
declare
  n int;
  last_status text;
begin
  -- 1. The job is scheduled and active
  select count(*) into n from cron.job where jobname = 'dispatch-ingest' and active;
  if n <> 1 then raise exception 'dispatch-ingest is not scheduled or not active'; end if;

  -- 2. The secret is readable by the job's role. A missing secret makes the
  -- Authorization header the literal string "Bearer ", which GitHub answers
  -- with 401 — and pg_net swallows it, so nothing would ever look wrong here.
  select count(*) into n from vault.decrypted_secrets where name = 'github_pat_dispatch';
  if n <> 1 then raise exception 'vault secret github_pat_dispatch is missing'; end if;

  -- 3. The most recent firings succeeded at the SQL level
  select status into last_status
  from cron.job_run_details
  where jobname = 'dispatch-ingest'
  order by start_time desc limit 1;

  if last_status is null then
    raise notice 'no firing recorded yet — wait for the next quarter hour and re-run';
  elsif last_status <> 'succeeded' then
    raise exception 'last dispatch firing status: %', last_status;
  else
    raise notice 'last dispatch firing: succeeded';
  end if;
end $$;

-- 4. What GitHub actually answered. `succeeded` above only means the SQL ran;
-- the HTTP result lives here, and 204 is what a accepted dispatch returns.
-- Anything else — 401 bad token, 403 wrong scope, 404 wrong repo/ref/filename —
-- is a silent failure everywhere else.
select
  r.status_code,
  case r.status_code
    when 204 then 'accepted — the workflow was dispatched'
    when 401 then 'bad or missing token'
    when 403 then 'token lacks Actions: write on this repo'
    when 404 then 'wrong repo, workflow filename, or ref'
    else 'unexpected — read the body'
  end as meaning,
  r.content,
  r.created
from net._http_response r
order by r.created desc
limit 5;

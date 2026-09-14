-- Verifier for the pg_cron dispatch route (T018).
--
-- ONE result set, one row per check, nothing aborts. The first version was a
-- single do-block that raised on the first failure, so when it hit an invented
-- column name (`cron.job_run_details.jobname`, which does not exist — the join
-- goes through `jobid`) it took the rest of the checks down with it and we
-- could not see whether they were wrong too. A verifier's job is to report the
-- whole state, and that one reported the first problem and went quiet.
--
-- Column names below were read from information_schema, not remembered:
-- see t018_pg_cron_introspect.sql, which is kept for the next time this drifts.
--
-- Run a few minutes after applying the migration, so at least one firing exists.

with job as (
  select jobid, jobname, schedule, active
  from cron.job
  where jobname = 'dispatch-ingest'
),
last_run as (
  select d.status, d.return_message, d.start_time
  from cron.job_run_details d
  join job j on j.jobid = d.jobid
  order by d.start_time desc
  limit 1
),
-- `net._http_response` carries no job reference, and the URL lives in
-- `http_request_queue`, which drains. So this is "the most recent pg_net
-- response", not "the most recent response to OUR request". True while this is
-- the only job using pg_net; if a second one appears, this reading turns
-- ambiguous and needs revisiting rather than trusting.
last_http as (
  select status_code, timed_out, error_msg, content, created
  from net._http_response
  order by created desc
  limit 1
),
triggers as (
  select
    count(*) filter (where trigger_src = 'pg_cron')         as via_pg_cron,
    count(*) filter (where trigger_src = 'github_schedule') as via_github,
    count(*) filter (where trigger_src is null)             as unknown
  from runs
)
select * from (

  select 1 as n, 'job is scheduled and active' as check_name,
    case when (select count(*) from job where active) = 1 then 'PASS' else 'FAIL' end as result,
    coalesce(
      (select 'jobid ' || jobid || ', ' || schedule || ', active=' || active::text from job),
      'no job named dispatch-ingest'
    ) as detail

  union all
  select 2, 'vault secret is readable',
    case when (select count(*) from vault.decrypted_secrets
               where name = 'github_pat_dispatch') = 1 then 'PASS' else 'FAIL' end,
    case when (select count(*) from vault.decrypted_secrets
               where name = 'github_pat_dispatch') = 1
         then 'github_pat_dispatch present'
         -- Worth stating: a missing secret makes the header the literal
         -- "Bearer ", GitHub answers 401, and pg_net swallows it. Nothing
         -- else in the system would look wrong.
         else 'MISSING — the Authorization header would be the literal "Bearer "'
    end

  union all
  select 3, 'last firing ran (SQL level)',
    case when (select count(*) from last_run) = 0 then 'INFO'
         when (select status from last_run) = 'succeeded' then 'PASS'
         else 'FAIL' end,
    coalesce(
      (select status || ' at ' || start_time::text
              || coalesce(' — ' || return_message, '') from last_run),
      'no firing recorded yet — wait for the next quarter hour and re-run'
    )

  union all
  -- The check that matters. Above only says the SQL ran; a job that 401s every
  -- fifteen minutes is `succeeded` there and looks identical to a healthy one.
  select 4, 'what GitHub actually answered',
    case when (select count(*) from last_http) = 0 then 'INFO'
         when (select timed_out from last_http) then 'FAIL'
         when (select error_msg from last_http) is not null then 'FAIL'
         when (select status_code from last_http) = 204 then 'PASS'
         else 'FAIL' end,
    coalesce((
      select case
        -- timed_out and error_msg separate "GitHub refused us" from "we never
        -- reached GitHub", which the status code alone cannot do.
        when timed_out then 'TIMED OUT — the request never got an answer'
        when error_msg is not null then 'TRANSPORT ERROR — ' || error_msg
        when status_code = 204 then '204 accepted — the workflow was dispatched'
        when status_code = 401 then '401 — bad or missing token'
        when status_code = 403 then '403 — token lacks Actions: write on this repo'
        when status_code = 404 then '404 — wrong repo, workflow filename, or ref'
        else status_code::text || ' — unexpected: ' || coalesce(left(content, 300), '(no body)')
      end || '  [' || created::text || ']'
      from last_http
    ), 'no pg_net response recorded yet')

  union all
  -- End to end: the dispatch became a labelled row. Everything above can pass
  -- while this fails, if the workflow ran but never wrote.
  select 5, 'a run is labelled pg_cron',
    case when (select via_pg_cron from triggers) > 0 then 'PASS' else 'FAIL' end,
    (select 'pg_cron: ' || via_pg_cron || ', github_schedule: ' || via_github
            || ', unknown (pre-column): ' || unknown from triggers)

  union all
  -- Not a pass/fail. While both routes are live this is the only place the
  -- answer shows: from the Actions UI a pg_cron dispatch reads as "Manually
  -- run by <PAT owner>", so the two routes are indistinguishable there.
  select 6, 'is GitHub''s own scheduler alive?',
    'INFO',
    case when (select via_github from triggers) > 0
         then 'yes — ' || (select via_github from triggers)::text
              || ' run(s) fired by GitHub itself'
         else 'no runs from GitHub''s scheduler since the column exists'
    end

) checks order by n;

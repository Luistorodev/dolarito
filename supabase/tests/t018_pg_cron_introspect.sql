-- Introspection before assertion (T018).
--
-- The first version of t018_pg_cron_verify.sql invented column names —
-- `cron.job_run_details.jobname` does not exist — and because every check lived
-- in one do-block, the first wrong guess hid whatever else was wrong behind it.
--
-- So: read the real shapes first, write the assertions second. Run this in the
-- SQL Editor and paste back both results.

-- 1. Which tables these extensions actually expose. Catches a table that is
--    named something other than what the docs or memory say.
select table_schema, table_name
from information_schema.tables
where table_schema in ('cron', 'net')
order by table_schema, table_name;

-- 2. The columns the verifier needs to name.
select table_schema,
       table_name,
       ordinal_position as pos,
       column_name,
       data_type
from information_schema.columns
where table_schema in ('cron', 'net')
order by table_schema, table_name, ordinal_position;

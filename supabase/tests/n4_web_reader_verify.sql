-- Verification for the web_reader role (N4). Read-only; writes nothing.
-- Not a migration: it lives outside supabase/migrations/.
--
-- Proves the two halves that matter: the role CAN read the surface the UI
-- needs, and CANNOT write anywhere or reach the raw tables directly.

do $$
declare
  bad text[] := '{}';
  n int;
begin
  if not exists (select 1 from pg_roles where rolname = 'web_reader') then
    raise exception 'N4 FAILED: role web_reader does not exist';
  end if;

  if exists (
    select 1 from pg_roles where rolname = 'web_reader' and (rolsuper or rolcreaterole or rolcreatedb or rolbypassrls or rolcanlogin)
  ) then
    bad := bad || 'web_reader has attributes it should not';
  end if;

  -- It must be able to read the three objects the UI uses.
  for n in
    select 1 from unnest(array['latest_quotes','providers','market_history']) as t(name)
    where not has_table_privilege('web_reader', 'public.' || name, 'SELECT')
  loop
    bad := bad || 'web_reader cannot SELECT something it needs';
  end loop;

  -- And it must not be able to write anywhere, nor read the raw tables.
  select count(*) into n
  from information_schema.table_privileges
  where grantee = 'web_reader'
    and table_schema = 'public'
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');
  if n > 0 then bad := bad || (n || ' write privilege(s) granted to web_reader'); end if;

  for n in
    select 1 from unnest(array['quotes','runs']) as t(name)
    where has_table_privilege('web_reader', 'public.' || name, 'SELECT')
  loop
    bad := bad || 'web_reader can read a raw table directly';
  end loop;

  if array_length(bad, 1) is not null then
    raise exception 'N4 FAILED: %', array_to_string(bad, ' | ');
  end if;
end
$$;

select 'N4 verification PASSED: web_reader reads the UI surface and cannot write' as result;

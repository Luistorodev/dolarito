-- Verification for T005. Not a migration — it lives outside supabase/migrations/,
-- so `supabase db push` never picks it up. Read-only; it writes nothing.
--
-- Why this exists: `check:rls` proves the anon key gets no data, which is the
-- done criterion. It cannot prove WHICH layer stopped it. The migration puts two
-- in place — RLS with no policies, and revoked privileges — and a revoke alone
-- produces the exact same "permission denied" that both together produce. If RLS
-- had silently not been enabled, that script would still report green.
--
-- This checks the layers directly, from the catalog:
--   1. RLS is enabled on all four tables,
--   2. no policy grants anonymous read,
--   3. `latest_quotes` runs with security_invoker, so the tables' RLS applies to
--      whoever queries it instead of to the view's owner,
--   4. `anon` holds no privileges on any of the five objects.

do $$
declare
  bad text[] := '{}';
  t text;
  opts text[];
  leftover int;
  policies int;
begin
  -- 1. RLS enabled on every table.
  foreach t in array array['providers','runs','quotes','market_history'] loop
    if not exists (
      select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      bad := bad || (t || ': RLS is NOT enabled');
    end if;
  end loop;

  -- 2. No policies at all: during the private phase there is no public read.
  select count(*) into policies
  from pg_policies
  where schemaname = 'public'
    and tablename in ('providers','runs','quotes','market_history');

  if policies <> 0 then
    bad := bad || (policies || ' polic(ies) exist; plan.md §2.3 expects none');
  end if;

  -- 3. The view must not run with its owner's privileges.
  select c.reloptions into opts
  from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'latest_quotes';

  if opts is null or not ('security_invoker=on' = any(opts)) then
    bad := bad || 'latest_quotes: security_invoker is NOT on — the view would bypass RLS';
  end if;

  -- 4. anon holds nothing on any of the five objects.
  select count(*) into leftover
  from information_schema.table_privileges
  where table_schema = 'public'
    and grantee = 'anon'
    and table_name in ('providers','runs','quotes','market_history','latest_quotes');

  if leftover <> 0 then
    bad := bad || (leftover || ' privilege(s) still granted to anon');
  end if;

  if array_length(bad, 1) is not null then
    raise exception 'T005 verification FAILED: %', array_to_string(bad, ' | ');
  end if;
end
$$;

select 'T005 verification PASSED: RLS on all four tables, no policies, '
       'security_invoker on the view, no anon privileges' as result;

-- Verifier for 20260914180000_margins_trigger_src_and_view_columns.sql.
--
-- Leaves no rows and does not rely on the editor's transaction handling.
-- Every check is an assertion that raises; reaching the final notice means all
-- of them passed.
--
-- The margin checks run against the REAL captured rows rather than a synthetic
-- insert, so they test the view as the interface will read it.

do $$
declare
  n int;
  cols text;
begin
  -- 1. trigger_src exists, constrained, and rejects an invented value ---------
  select count(*) into n
  from information_schema.columns
  where table_name = 'runs' and column_name = 'trigger_src';
  if n <> 1 then raise exception 'runs.trigger_src missing'; end if;

  begin
    insert into runs (trigger_src) values ('not_a_real_trigger');
    raise exception 'trigger_src accepted a value outside its check constraint';
  exception when check_violation then
    null;  -- expected
  end;

  -- Pre-existing runs keep an unknown trigger rather than a backfilled guess.
  select count(*) into n from runs where trigger_src is null;
  raise notice 'runs with unknown trigger (expected: the ones from before): %', n;

  -- 2. The view exposes what Phase 5 needs ----------------------------------
  for cols in
    select unnest(array['trm_from', 'trm_to', 'mid_market_src', 'effective_rate',
                        'markup_vs_trm', 'markup_vs_mid'])
  loop
    select count(*) into n
    from information_schema.columns
    where table_name = 'latest_quotes' and column_name = cols;
    if n <> 1 then raise exception 'latest_quotes is missing column %', cols; end if;
  end loop;

  -- 3. What the DROP removed is back ----------------------------------------
  -- This is the check that matters most: forgetting it is not an error, it is
  -- anon quietly reading every row the RLS underneath withholds.
  select count(*) into n
  from pg_class c
  where c.relname = 'latest_quotes'
    and c.reloptions @> array['security_invoker=on'];
  if n <> 1 then raise exception 'security_invoker is NOT on — T005 was undone'; end if;

  select count(*) into n
  from information_schema.role_table_grants
  where table_name = 'latest_quotes' and grantee = 'anon';
  if n <> 0 then raise exception 'anon has % privilege(s) on latest_quotes', n; end if;

  -- 4. The margin invariant, over the real rows ------------------------------
  -- Positive must mean worse than the reference, in BOTH directions. Defect 2
  -- was exactly this: one formula for two directions, reporting a 4% overcharge
  -- as a discount on every cop_to_usd row.
  select count(*) into n
  from latest_quotes
  where markup_vs_trm is not null and trm is not null
    and (
      (direction = 'cop_to_usd' and effective_rate > trm and markup_vs_trm <= 0) or
      (direction = 'usd_to_cop' and effective_rate < trm and markup_vs_trm <= 0)
    );
  if n <> 0 then
    raise exception '% row(s) report a discount while being worse than the TRM', n;
  end if;

  -- And the mirror: nothing may report a penalty while actually being better.
  select count(*) into n
  from latest_quotes
  where markup_vs_trm is not null and trm is not null
    and (
      (direction = 'cop_to_usd' and effective_rate < trm and markup_vs_trm >= 0) or
      (direction = 'usd_to_cop' and effective_rate > trm and markup_vs_trm >= 0)
    );
  if n <> 0 then
    raise exception '% row(s) report a penalty while being better than the TRM', n;
  end if;

  -- 5. The effective rate carries the fixed fee ------------------------------
  -- Defect 1: for the three providers that charge one, effective_rate must
  -- differ from gross_rate. If they match everywhere, the fee is not inside it
  -- and we are still comparing advertised rates.
  select count(*) into n
  from latest_quotes
  where provider_id in ('wise', 'western_union', 'instarem')
    and fee_fixed_usd is not null and fee_fixed_usd > 0
    and effective_rate is not null and gross_rate is not null
    and abs(effective_rate - gross_rate) < 0.01;
  if n <> 0 then
    raise exception '% fee-charging row(s) have effective_rate == gross_rate', n;
  end if;

  raise notice 'T020 migration verification PASSED';
end $$;

-- No rows were added: the only insert above is rejected by its constraint.
select count(*) as runs_total, count(trigger_src) as runs_with_known_trigger from runs;

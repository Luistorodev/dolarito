-- Verification for T003. Not a migration — it lives outside supabase/migrations/,
-- so `supabase db push` never picks it up. Run it after the migration applies.
--
-- Proves the three things T003 declares as done:
--   1. the objects exist as plan.md §2 describes them,
--   2. a duplicate insert within one run is rejected by the unique index,
--   3. an invalid `status` or `direction` is rejected by its CHECK.
--
-- It leaves no rows behind, and does so without explicit transaction control:
-- a DO block is one statement, so a failed assertion rolls the whole thing back
-- on its own, and the happy path deletes its fixtures before finishing. That
-- keeps it safe to paste into the Supabase SQL Editor.
--
-- Reading the result: an ERROR means the check failed and says which one. The
-- final SELECT only returns its row if every assertion passed.

do $$
declare
  run uuid;
  failed text[] := '{}';
  fired int := 0;
begin
  -- 1. The objects exist.
  perform 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'providers';
  if not found then failed := failed || 'table providers missing'; end if;
  perform 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'runs';
  if not found then failed := failed || 'table runs missing'; end if;
  perform 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'quotes';
  if not found then failed := failed || 'table quotes missing'; end if;
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'market_history'
      and column_name = 'loaded_at';
  if not found then failed := failed || 'market_history.loaded_at missing (N5)'; end if;
  perform 1 from information_schema.views
    where table_schema = 'public' and table_name = 'latest_quotes';
  if not found then failed := failed || 'view latest_quotes missing'; end if;

  if array_length(failed, 1) is not null then
    raise exception 'T003 verification FAILED: %', array_to_string(failed, ' | ');
  end if;

  -- Fixture rows the negative tests hang off.
  insert into providers (id, name, mode, asset, channel)
    values ('__verify__', 'verify fixture', 'local', 'usdt', 'exchange');
  insert into runs default values returning id into run;

  insert into quotes (
    run_id, provider_id, mode, asset, channel, direction, bracket_usd,
    fixed_side, amount_in, currency_in, amount_out, currency_out,
    status, amounts_source, raw, captured_at
  ) values (
    run, '__verify__', 'local', 'usdt', 'exchange', 'usd_to_cop', 100,
    'in', 100, 'USD', 400000, 'COP',
    'ok', 'computed', '{}'::jsonb, now()
  );

  -- 2. Same run, same provider, same direction, same bracket, same (null)
  --    payment method: the unique index must reject it.
  begin
    insert into quotes (
      run_id, provider_id, mode, asset, channel, direction, bracket_usd,
      fixed_side, amount_in, currency_in, amount_out, currency_out,
      status, amounts_source, raw, captured_at
    ) values (
      run, '__verify__', 'local', 'usdt', 'exchange', 'usd_to_cop', 100,
      'in', 100, 'USD', 399000, 'COP',
      'ok', 'computed', '{}'::jsonb, now()
    );
    failed := failed || 'duplicate row was ACCEPTED by the unique index';
  exception when unique_violation then
    fired := fired + 1;
  end;

  -- 3a. Invalid `status`.
  begin
    insert into quotes (
      run_id, provider_id, mode, asset, channel, direction, bracket_usd,
      fixed_side, status, amounts_source, raw, captured_at
    ) values (
      run, '__verify__', 'local', 'usdt', 'exchange', 'usd_to_cop', 500,
      'in', 'failed', 'computed', '{}'::jsonb, now()
    );
    failed := failed || 'invalid status was ACCEPTED by the CHECK';
  exception when check_violation then
    fired := fired + 1;
  end;

  -- 3b. Invalid `direction`.
  begin
    insert into quotes (
      run_id, provider_id, mode, asset, channel, direction, bracket_usd,
      fixed_side, status, amounts_source, raw, captured_at
    ) values (
      run, '__verify__', 'local', 'usdt', 'exchange', 'cop_to_cop', 500,
      'in', 'ok', 'computed', '{}'::jsonb, now()
    );
    failed := failed || 'invalid direction was ACCEPTED by the CHECK';
  exception when check_violation then
    fired := fired + 1;
  end;

  -- Clean up the fixtures on the happy path. On the failure path the raise
  -- below aborts the DO block and PostgreSQL discards every insert above.
  delete from quotes    where provider_id = '__verify__';
  delete from runs      where id = run;
  delete from providers where id = '__verify__';

  if array_length(failed, 1) is not null then
    raise exception 'T003 verification FAILED: %', array_to_string(failed, ' | ');
  end if;

  if fired <> 3 then
    raise exception 'T003 verification FAILED: expected 3 rejections, got %', fired;
  end if;
end
$$;

select 'T003 verification PASSED: objects present, 3 rejections fired as expected'
       as result;

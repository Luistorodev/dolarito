-- Three changes that all land on the same objects, so they travel together:
-- one paste into the SQL Editor instead of three.
--
--   1. `runs.trigger_src` — which route opened the run (T018 / pg_cron).
--   2. The two margin defects of plan.md §2.2, corrected.
--   3. Three columns of `runs` the Phase 5 tasks need and the view never exposed.
--
-- ⚠️ The view is DROPPED and recreated, not replaced: `create or replace view`
-- cannot add columns in the middle or change their order. That drop takes
-- `security_invoker` and the `anon` revokes of T005 with it, silently. Both are
-- re-applied at the bottom, and the verifier checks them — because the failure
-- mode of forgetting is not an error, it is `anon` quietly reading everything.

begin;

-- ---------------------------------------------------------------------------
-- 1. Which route opened this run
-- ---------------------------------------------------------------------------
-- Without this, two triggers write indistinguishable rows and "the ingest ran"
-- cannot tell us WHICH scheduler ran it. That would make the pg_cron migration
-- unverifiable: we would only ever learn that something ran.
--
-- Nullable on purpose. The runs captured before this column existed genuinely
-- have an unknown trigger, and Art. I.1 says unknown stays unknown rather than
-- being backfilled with a guess.
alter table runs add column trigger_src text
  check (trigger_src in ('github_schedule', 'pg_cron', 'manual', 'local'));

comment on column runs.trigger_src is
  'Which trigger opened this run. NULL for runs captured before 2026-09-14, '
  'whose trigger is genuinely unknown and is not backfilled.';

-- ---------------------------------------------------------------------------
-- 2 & 3. The read view, rebuilt
-- ---------------------------------------------------------------------------
drop view if exists latest_quotes;

create view latest_quotes as
with latest as (
  select distinct on (q.provider_id, q.direction, q.bracket_usd, coalesce(q.payment_method, ''))
         q.*,
         -- trm_from/trm_to: T024 needs the validity window to mark the TRM
         -- frozen on weekends and holidays. The columns existed; the view
         -- simply never passed them through.
         r.trm, r.trm_from, r.trm_to,
         -- mid_market_src: Yahoo is intraday and er-api a daily snapshot
         -- (T011). A margin shown without saying which one answered silently
         -- mixes two different measurements.
         r.mid_market, r.mid_market_src, r.mid_market_at
  from quotes q
  join runs r on r.id = q.run_id
  where q.captured_at > now() - interval '24 hours'
  order by q.provider_id, q.direction, q.bracket_usd, coalesce(q.payment_method, ''),
           q.captured_at desc
)
select latest.*,
       eff.effective_rate,
       -- Positive always means WORSE than the reference, in both directions.
       -- Selling, the person receives pesos and more is better, so the shortfall
       -- against the reference is (ref - effective). Buying, they pay pesos and
       -- less is better, so it is the other way round. Using one formula for
       -- both is defect 2: it reported a 4% overcharge as a discount on half
       -- the rows of every provider.
       case when latest.direction = 'usd_to_cop'
              then (latest.trm - eff.effective_rate) / nullif(latest.trm, 0)
            else (eff.effective_rate - latest.trm) / nullif(latest.trm, 0)
       end as markup_vs_trm,
       case when latest.direction = 'usd_to_cop'
              then (latest.mid_market - eff.effective_rate) / nullif(latest.mid_market, 0)
            else (eff.effective_rate - latest.mid_market) / nullif(latest.mid_market, 0)
       end as markup_vs_mid
from latest
-- Computed once and exposed, rather than repeated in both margins. The
-- effective rate is pesos per dollar actually paid or received, whichever side
-- the COP is on, so the fixed fee is inside it. Comparing against `gross_rate`
-- was defect 1, and Art. III.1 forbids ordering or comparing by the advertised
-- rate. Exposing it also lets the interface show the number it ranks by.
cross join lateral (
  select case when latest.currency_out = 'COP'
                then latest.amount_out / nullif(latest.amount_in, 0)
              else latest.amount_in / nullif(latest.amount_out, 0)
         end as effective_rate
) eff;

-- ---------------------------------------------------------------------------
-- Re-apply what the DROP removed (T005). Not optional.
-- ---------------------------------------------------------------------------
-- A view carries no RLS of its own. Without this it runs with its owner's
-- privileges and hands the anon key exactly the rows the RLS underneath
-- withholds — the hole T005 existed to close.
alter view latest_quotes set (security_invoker = on);

-- RLS with no policies returns an empty set rather than an error; the revoke
-- turns it into a hard error. Belt and braces, as T005 established.
revoke all on latest_quotes from anon;

commit;

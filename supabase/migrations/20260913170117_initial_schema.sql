-- T003 — Initial schema.
-- Implements plan.md §2 and §2.2 verbatim: the four tables, their CHECK
-- constraints, the unique index that makes a repeated run harmless, the two
-- query indexes, and the `latest_quotes` view with its 24-hour cutoff and both
-- markups.
--
-- Out of scope on purpose: RLS is T005, provider seed rows are T004.
--
-- Index names are given explicitly. PostgreSQL would generate them otherwise;
-- the column lists are unchanged from the plan.

-- Catalogue. Only entities that appear in rankings. References are NOT
-- providers: they live in `runs`.
create table providers (
  id        text primary key,     -- 'eldorado', 'dolarapp', 'binance_p2p'
  name      text not null,
  mode      text not null check (mode in ('local','remesa')),
  asset     text not null check (asset in ('usd','usdt','usdc')),
  channel   text not null check (channel in ('exchange','p2p','bank_transfer','fintech')),
  site_url  text,
  notes     text
);

-- One row per run. Observability + the references captured at that instant.
create table runs (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  trm             numeric(14,4),
  trm_from        date,                     -- vigenciadesde
  trm_to          date,                     -- vigenciahasta (covers weekends)
  mid_market      numeric(14,4),
  mid_market_src  text check (mid_market_src in ('yahoo','er_api')),
  mid_market_at   timestamptz,              -- when the datum is from, not when captured
  sources_ok      text[]  not null default '{}',
  sources_failed  jsonb   not null default '{}'
);

-- The central table. Real observations only: a network failure does NOT write here.
create table quotes (
  id              bigserial primary key,
  run_id          uuid not null references runs(id) on delete cascade,
  provider_id     text not null references providers(id),

  mode            text not null check (mode in ('local','remesa')),
  asset           text not null check (asset in ('usd','usdt','usdc')),
  channel         text not null check (channel in ('exchange','p2p','bank_transfer','fintech')),
  direction       text not null check (direction in ('cop_to_usd','usd_to_cop')),
  bracket_usd     numeric not null check (bracket_usd in (1,100,500,1000)),
  payment_method  text,

  -- The fixed side is always denominated in USD and equals bracket_usd.
  fixed_side      text not null check (fixed_side in ('in','out')),
  amount_in       numeric(18,4),   -- what the person hands over
  currency_in     text check (currency_in in ('COP','USD')),
  amount_out      numeric(18,4),   -- what the person receives
  currency_out    text check (currency_out in ('COP','USD')),

  status          text not null check (status in ('ok','out_of_range')),
  limit_reason    text check (limit_reason in ('below_minimum','above_maximum','insufficient_liquidity')),

  gross_rate      numeric(14,4),
  fee_pct         numeric(8,6),
  fee_fixed_usd   numeric(12,4),
  fee_amount_usd  numeric(12,4),   -- absolute fee when the source states one
  amounts_source  text not null check (amounts_source in ('provider','computed')),
  eta_minutes     integer,

  raw             jsonb not null,
  captured_at     timestamptz not null
);

create unique index quotes_run_provider_direction_bracket_method_uidx on quotes
  (run_id, provider_id, direction, bracket_usd, coalesce(payment_method,''));
create index quotes_provider_direction_bracket_captured_idx on quotes
  (provider_id, direction, bracket_usd, captured_at desc);
create index quotes_mode_direction_bracket_status_captured_idx on quotes
  (mode, direction, bracket_usd, status, captured_at desc);

-- Market history, seeded once. Never mixed with the captures.
create table market_history (
  d          date primary key,
  close      numeric(14,4) not null,
  src        text not null default 'yahoo_seed',
  loaded_at  timestamptz not null default now()   -- when the row was fetched
);

-- Read view. The 24-hour cutoff is deliberate: without it a provider that went
-- down three weeks ago would still show up as "the latest datum". Neither markup
-- is persisted — both are derivable, and persisting them would create a second
-- source of truth.
create view latest_quotes as
select distinct on (provider_id, direction, bracket_usd, coalesce(payment_method,''))
       q.*, r.trm, r.mid_market, r.mid_market_at,
       (r.trm        - q.gross_rate) / nullif(r.trm,0)        as markup_vs_trm,
       (r.mid_market - q.gross_rate) / nullif(r.mid_market,0) as markup_vs_mid
from quotes q join runs r on r.id = q.run_id
where q.captured_at > now() - interval '24 hours'
order by provider_id, direction, bracket_usd, coalesce(payment_method,''),
         q.captured_at desc;

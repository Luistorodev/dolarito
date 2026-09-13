-- N4 — a read-only role for the web tier.
--
-- plan.md §2.3 requires every read to happen server-side with a "server key",
-- and left which key open. The only factory key that can read is the secret
-- one, which can also write, delete and drop: handing it to the web tier gives
-- a page that only ever runs SELECT the power to empty `quotes`.
--
-- This creates the role the web tier should read as. Binding an API key to it
-- is a dashboard step, not SQL — see CLAUDE.md.
--
-- What it can reach is deliberately the smallest surface that serves the UI:
--
--   latest_quotes   the rankings (HU-01, HU-02, HU-03)
--   providers       the catalogue, for the provider pages (RF-15)
--   market_history  the seeded series, for HU-08
--
-- `quotes` and `runs` are NOT included. The interface never needs raw rows: it
-- needs the view, which already applies the 24-hour cutoff. Exposing `quotes`
-- would also expose every `raw` payload we ever stored.

create role web_reader nologin;

-- Schema visibility, then reads. No INSERT, UPDATE, DELETE or TRUNCATE
-- anywhere, and no default privileges on future tables: a table added later is
-- invisible to this role until someone grants it on purpose.
grant usage on schema public to web_reader;

grant select on latest_quotes  to web_reader;
grant select on providers      to web_reader;
grant select on market_history to web_reader;

-- The view runs with security_invoker (T005), so the caller's RLS applies to
-- the tables underneath it. Without policies for this role the view would come
-- back empty, so each underlying table needs one — read-only, and only for the
-- data the view already exposes.
create policy web_reader_reads_quotes on quotes
  for select to web_reader using (true);

create policy web_reader_reads_runs on runs
  for select to web_reader using (true);

create policy web_reader_reads_providers on providers
  for select to web_reader using (true);

create policy web_reader_reads_market_history on market_history
  for select to web_reader using (true);

-- Note on `using (true)`: there is no per-row privacy to enforce here — every
-- row is a public price. The protection this project needs during the private
-- phase is at the door (HU-07, the site password), not per row. What these
-- policies buy is that the role can read and cannot write, which is the whole
-- point of N4. `quotes` and `runs` stay ungranted at the table level, so the
-- policy alone does not let anyone select from them directly.

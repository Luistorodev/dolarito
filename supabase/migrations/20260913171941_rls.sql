-- T005 — Row Level Security.
--
-- Implements plan.md §2.3: during the private phase there is NO public read.
-- HU-07 requires every piece of content to sit behind the password, and a
-- public read policy with the anon key in the browser would let anyone query
-- the Supabase API directly, going around the middleware and leaving the
-- protection worth nothing.
--
-- RLS is enabled with NO policies at all. That is the point: every read happens
-- server-side with a server key, and every write happens with the service_role
-- key, which bypasses RLS by design.
--
-- Two things here go beyond the literal text of plan.md §2.3. Both are flagged
-- in CLAUDE.md; neither changes the data contract.
--
--   1. `market_history` also gets RLS. §2.3 names only quotes, runs and
--      providers, but leaving the fourth table open would expose the seeded
--      series to the anon key and contradict HU-07.
--
--   2. Privileges are revoked from `anon` as well. RLS without policies makes a
--      read return an empty set rather than an error; revoking makes it a hard
--      permission error. Defense in depth, and it makes the negative test
--      unambiguous. `authenticated` keeps its grants and is stopped by RLS,
--      because which key the web tier will read with is still undecided (N4).

alter table providers      enable row level security;
alter table runs           enable row level security;
alter table quotes         enable row level security;
alter table market_history enable row level security;

-- A view does not carry RLS of its own. Without `security_invoker` it runs with
-- its owner's privileges, so `latest_quotes` would happily hand the anon key
-- every row the RLS above is meant to withhold. This is the setting that makes
-- the underlying tables' RLS apply to whoever is querying.
alter view latest_quotes set (security_invoker = on);

revoke all on providers      from anon;
revoke all on runs           from anon;
revoke all on quotes         from anon;
revoke all on market_history from anon;
revoke all on latest_quotes  from anon;

-- 0198_collection_ai_results.sql — a paid Collection AI answer survives a
-- lost response.
--
-- Found by the 2026-11-10 tools audit. The Collection Deck Builder's two
-- paid calls ("Build with AI", "Suggest a commander" — 1 credit each) save
-- nothing: the answer goes back to the page, which keeps it in the browser.
-- The credit is SETTLED the moment the answer exists, before the response
-- is written — so an answer whose response never arrived (a dropped
-- connection, a closed laptop, a proxy timeout on a two-minute call) was
-- paid for and gone, while the page said "if a credit was taken it comes
-- back by itself". It did not: a settled spend is never refunded.
--
-- This table keeps what became of each paid call, by the request id the page
-- made for it, in the states the route writes:
--
--   running   the request reached the route — written BEFORE anything is
--             charged, and the call is refused if it can't be written
--   refused   the route turned it down before the charge
--   done      the answer, written BEFORE the credit is settled (a credit is
--             settled only for an answer that was kept)
--   failed    the call failed after the charge; its credit was refunded
--
-- So a page whose response never arrived asks for its request
-- (GET /api/tools/collection-builder/ai-result) and is told exactly what
-- happened — and "no record of that request" means it never reached the
-- route: nothing was charged.
--
-- One row per REQUEST (two calls of one kind that overlap — two tabs — never
-- take each other's row). A new call drops the same user's rows of that kind
-- older than an hour (a page stops asking long before), and the weekly prune
-- drops everything past 7 days. An answer is the user's own collection's
-- cards — never shared, never read by another user.
--
-- Service role only (the routes write and read it after their own access
-- check): RLS on with no policy, the API roles revoked. Grants are explicit
-- (0097). Idempotent. Ships through a PR; never applied ad-hoc.

create table if not exists public.collection_ai_results (
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The id the page made for the request this row is about.
  request_id uuid not null,
  kind text not null check (kind in ('build', 'suggest')),
  status text not null check (status in ('running', 'refused', 'done', 'failed')),
  result jsonb
    check (result is null or (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 1000000)),
  created_at timestamptz not null default now(),
  primary key (user_id, request_id),
  -- An answer exactly when the call is done.
  constraint collection_ai_results_done_has_result check ((status = 'done') = (result is not null))
);

-- A new call's trim of the user's older rows of its kind.
create index if not exists collection_ai_results_user_kind_idx
  on public.collection_ai_results (user_id, kind, created_at);
-- The weekly prune.
create index if not exists collection_ai_results_created_idx
  on public.collection_ai_results (created_at);

comment on table public.collection_ai_results is
  'What became of each paid Collection AI call, by the page''s request id (0198): running (written before the charge), refused, done (with its answer, kept before the credit is settled) or failed — so a page whose response never arrived can ask. Service role only; pruned after 7 days.';

alter table public.collection_ai_results enable row level security;

revoke all on public.collection_ai_results from public, anon, authenticated;
grant select, insert, update, delete on public.collection_ai_results to service_role;

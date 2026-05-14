-- Phase 11 chunk 15 — usage-insight aggregate functions.
--
-- Two SQL functions return per-day usage counts for the calling user.
-- Used by the Settings page's UsagePanel to render a 30-day bar chart
-- without pulling thousands of rows into the client.
--
-- Posture:
--   - SECURITY INVOKER (default) — the function runs with the caller's
--     permissions, so RLS still applies on the underlying tables.
--   - Filtered by auth.uid() so a leaky function call can't peek at
--     another user's history. (Belt-and-braces: RLS would block it too.)
--   - GRANT EXECUTE to authenticated only; anon users have no usage data
--     and don't need to call these.

create or replace function public.card_ai_calls_daily(since timestamptz)
returns table (day date, count bigint)
language sql
stable
security invoker
as $$
  select date_trunc('day', created_at)::date as day,
         count(*)::bigint as count
  from public.card_ai_calls
  where user_id = auth.uid()
    and created_at >= since
  group by 1
  order by 1 asc;
$$;

create or replace function public.scryfall_calls_daily(since timestamptz)
returns table (day date, count bigint)
language sql
stable
security invoker
as $$
  select date_trunc('day', created_at)::date as day,
         count(*)::bigint as count
  from public.scryfall_calls
  where user_id = auth.uid()
    and created_at >= since
  group by 1
  order by 1 asc;
$$;

revoke all on function public.card_ai_calls_daily(timestamptz) from public;
revoke all on function public.scryfall_calls_daily(timestamptz) from public;
grant execute on function public.card_ai_calls_daily(timestamptz) to authenticated;
grant execute on function public.scryfall_calls_daily(timestamptz) to authenticated;

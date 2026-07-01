-- App-wide Scryfall usage aggregates for the admin dashboard
-- (/admin/scryfall).
--
-- The per-user RPC from 0017 (scryfall_calls_daily) is auth.uid()-scoped,
-- so an app-wide view needs its own functions. Posture matches the
-- moderation queue: gate on profiles.is_admin in app code, then read via
-- the service-role client — EXECUTE is granted to service_role only, so
-- neither anon nor authenticated sessions can call these at all.

create or replace function public.scryfall_usage_admin_daily(since timestamptz)
returns table (day date, action text, count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select date_trunc('day', c.created_at)::date as day,
         c.action,
         count(*)::bigint as count
  from public.scryfall_calls c
  where c.created_at >= since
  group by 1, 2
  order by 1 asc, 2 asc;
$$;

create or replace function public.scryfall_usage_admin_top_users(
  since timestamptz,
  max_rows int default 10
)
returns table (user_id uuid, username text, calls bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.user_id,
         p.username,
         count(*)::bigint as calls
  from public.scryfall_calls c
  left join public.profiles p on p.id = c.user_id
  where c.created_at >= since
  group by 1, 2
  order by 3 desc
  limit greatest(1, least(max_rows, 50));
$$;

revoke all on function public.scryfall_usage_admin_daily(timestamptz)
  from public, anon, authenticated;
revoke all on function public.scryfall_usage_admin_top_users(timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.scryfall_usage_admin_daily(timestamptz)
  to service_role;
grant execute on function public.scryfall_usage_admin_top_users(timestamptz, int)
  to service_role;

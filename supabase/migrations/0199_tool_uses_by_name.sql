-- 0199_tool_uses_by_name.sql — a tool's "uses" are the events it lists as
-- uses.
--
-- Found by the 2026-11-10 tools audit's review. The admin Tools pages count
-- a "use" as every tool_events row that is not `open` (0182). That was true
-- while a tool recorded only its successes. Since the tools record what
-- happened — a refusal or failure under `<name>_failed`, a step (`plan`,
-- `dialog_opened`), how a run ended (`run_finished`), a visitor's
-- `shared_view` — one press writes two or three rows, and a tester with no
-- credits pressing "Build with AI" five times read as five uses and one
-- using user with nothing built.
--
-- WHICH events are a use is the app's to say, per tool
-- (lib/tools/catalog.ts TOOL_USE_EVENTS), so it is a PARAMETER, never a
-- list restated in SQL: `p_uses` = {"<tool slug>": ["<event>", …], …}. A
-- row is a use when its event is in its tool's list. Read at query time, so
-- a corrected list re-reads every stored row — nothing is stamped on a row
-- and nothing is backfilled.
--
-- Both functions keep their result shape; only what `uses` / `using_users`
-- count changes. A caller that names no `p_uses` (the deployment live while
-- this lands calls with its old arguments and reaches the default) gets the
-- old count: anything but `open`. The old signatures go, so one name never
-- resolves two ways.
--
-- Grants are explicit (0097): both stay the service role's. Idempotent.
-- Ships through a PR; never applied ad-hoc.

-- One row per tool that has a release row, a tester, an interested user or
-- an event: the overview's counts.
drop function if exists public.admin_tool_summary();
create or replace function public.admin_tool_summary(p_uses jsonb default null)
returns table (
  tool_slug text,
  testers bigint,
  interested bigint,
  users_7d bigint,
  users_30d bigint,
  opens_30d bigint,
  uses_30d bigint,
  last_event_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with slugs as (
    select slug as tool_slug from public.tool_releases
    union select g.tool_slug from public.tool_access_grants g
    union select i.tool_slug from public.tool_interest i
    union select distinct e.tool_slug from public.tool_events e
      where e.created_at > now() - interval '30 days'
  )
  select
    s.tool_slug,
    (select count(*) from public.tool_access_grants g
      where g.tool_slug = s.tool_slug and (g.expires_at is null or g.expires_at > now())),
    (select count(*) from public.tool_interest i where i.tool_slug = s.tool_slug),
    (select count(distinct e.user_id) from public.tool_events e
      where e.tool_slug = s.tool_slug and e.created_at > now() - interval '7 days'),
    (select count(distinct e.user_id) from public.tool_events e
      where e.tool_slug = s.tool_slug and e.created_at > now() - interval '30 days'),
    (select count(*) from public.tool_events e
      where e.tool_slug = s.tool_slug and e.event = 'open' and e.created_at > now() - interval '30 days'),
    (select count(*) from public.tool_events e
      where e.tool_slug = s.tool_slug and e.event <> 'open' and (p_uses is null or coalesce(p_uses -> e.tool_slug, '[]'::jsonb) ? e.event) and e.created_at > now() - interval '30 days'),
    (select max(e.created_at) from public.tool_events e where e.tool_slug = s.tool_slug)
  from slugs s;
$$;

revoke all on function public.admin_tool_summary(jsonb) from public, anon, authenticated;
grant execute on function public.admin_tool_summary(jsonb) to service_role;

-- One tool over the last p_days (1–365): totals, a zero-filled UTC day
-- series, the event names, the access paths and the 20 most active users.
drop function if exists public.admin_tool_detail(text, integer);
create or replace function public.admin_tool_detail(
  p_slug text,
  p_days integer default 30,
  p_uses jsonb default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select greatest(1, least(coalesce(p_days, 30), 365)) as days
  ),
  ev as (
    select
      e.*,
      -- A USE: one of the events the tool lists as one (p_uses), or — for
      -- a caller that names none — anything that is not the page's `open`.
      (e.event <> 'open'
        and (p_uses is null or coalesce(p_uses -> e.tool_slug, '[]'::jsonb) ? e.event)) as is_use
    from public.tool_events e, params
    where e.tool_slug = p_slug
      -- From the start of the chart's first UTC day, so the totals and the
      -- daily series count the same rows.
      and e.created_at >= (((now() at time zone 'utc')::date - (params.days - 1))::timestamp
                           at time zone 'utc')
  ),
  days as (
    select d::date as day
    from params,
      generate_series(
        (now() at time zone 'utc')::date - (params.days - 1),
        (now() at time zone 'utc')::date,
        interval '1 day'
      ) d
  ),
  per_day as (
    select
      (ev.created_at at time zone 'utc')::date as day,
      count(*) filter (where ev.event = 'open') as opens,
      count(*) filter (where ev.is_use) as uses,
      count(distinct ev.user_id) as users
    from ev
    group by 1
  ),
  per_user as (
    select
      ev.user_id,
      count(*) filter (where ev.event = 'open') as opens,
      count(*) filter (where ev.is_use) as uses,
      count(distinct (ev.created_at at time zone 'utc')::date) as active_days,
      max(ev.created_at) as last_at,
      (array_agg(ev.access order by ev.created_at desc))[1] as access
    from ev
    where ev.user_id is not null
    group by ev.user_id
  )
  select jsonb_build_object(
    'days', (select days from params),
    'totals', jsonb_build_object(
      'opens', (select count(*) from ev where event = 'open'),
      'uses', (select count(*) from ev where is_use),
      'users', (select count(distinct user_id) from ev),
      'using_users', (select count(distinct user_id) from ev where is_use),
      'returning_users', (select count(*) from per_user where active_days >= 2)
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', to_char(days.day, 'YYYY-MM-DD'),
        'opens', coalesce(pd.opens, 0),
        'uses', coalesce(pd.uses, 0),
        'users', coalesce(pd.users, 0)
      ) order by days.day)
      from days
      left join per_day pd on pd.day = days.day
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('event', x.event, 'count', x.n, 'users', x.u) order by x.n desc)
      from (
        select event, count(*) as n, count(distinct user_id) as u
        from ev group by event
      ) x
    ), '[]'::jsonb),
    'access', coalesce((
      select jsonb_agg(jsonb_build_object('access', x.access, 'users', x.u, 'uses', x.n) order by x.u desc)
      from (
        select coalesce(access, 'unknown') as access,
               count(distinct user_id) as u,
               count(*) filter (where is_use) as n
        from ev group by coalesce(access, 'unknown')
      ) x
    ), '[]'::jsonb),
    'top_users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', t.user_id, 'opens', t.opens, 'uses', t.uses,
        'active_days', t.active_days, 'last_at', t.last_at, 'access', t.access
      ) order by t.uses desc, t.opens desc)
      from (select * from per_user order by uses desc, opens desc limit 20) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.admin_tool_detail(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.admin_tool_detail(text, integer, jsonb) to service_role;

-- 0204_admin_tool_analytics.sql — who used each tool, how often, and what
-- happened: the readers of /admin/analytics' Tools tab.
--
-- The owner's request (2026-11-10): "add tracking on all the tools. I want
-- to know which users have used each tool and how often. Include tool
-- specific analytics." The tracking shipped with the tools audit (0182's
-- tool_events, written by lib/tools/events.ts; 0199 made a "use" the events
-- a tool lists as uses). What read it was /admin/tools' two functions:
-- fixed 7 / 30-day windows, the 20 most active users of a tool and no
-- failures or reasons. These five read the same rows for the
-- analytics page, over the period the page asks for:
--
--   1. admin_tools_overview    — one row per tool: people, people who used
--                                it, opens, uses, failures.
--   2. admin_tool_breakdown    — one tool (or every tool, '*') as jsonb:
--                                totals, a zero-filled UTC day series, every
--                                event name, and why its failures failed.
--   3. admin_tool_users        — EVERY signed-in user of a tool in the
--                                period (paged), not a top 20.
--   4. admin_tool_user_events  — one user's newest events of one tool.
--   5. admin_user_tool_usage   — one user's tools, all time (the admin
--                                Users page's "Tools used").
--
-- ONE reading of a row, shared by all five (and by the app):
--   - the period is [p_since, p_until); days are UTC;
--   - an OPEN is the page's `open` (one a visit);
--   - a USE is 0199's rule, unchanged: `p_uses` = {"<tool slug>":
--     ["<event>", …]} (the app's TOOL_USE_EVENTS, lib/tools/catalog.ts —
--     never a list restated here), and a row is a use when its event is in
--     its tool's list; a caller that names no `p_uses` gets anything but
--     `open`;
--   - a FAILURE is an event named `…_failed`, `…_refused` or `…_lost` —
--     the same rule as toolEventIsFailure (lib/tools/catalog.ts; a unit
--     test holds this file's regex to that one);
--   - NO CREDITS here. An event's `credits` prop is not a charge: a batch
--     start carries the run's PRICE, a refused start carries the price of a
--     run that never began, and a step that fails is refunded afterwards.
--     Summing it read 40 credits for a run refused for lack of credits. What
--     a tool cost is the credit LEDGER's, by reason
--     (lib/admin/analytics/credits.ts CREDIT_REASON_TOOLS — the Tools tab
--     reads it from there);
--   - `p_include_admins = false` (the default) leaves out the team: events
--     of users who are admins now AND events recorded on the admin access
--     path (`access = 'admin'` — an account that was an admin then). An
--     event with no user (a shared sheet's visitor) is nobody's and stays.
--
-- Indexes: tool_events has (tool_slug, created_at desc) and (user_id,
-- created_at desc). The per-tool readers range-scan the first; the
-- per-user readers the second; the two that read EVERY tool list the slugs
-- with a loose index scan (a recursive step per tool) and range-scan each,
-- so a period is never a walk of the whole log.
--
-- Read-only: no table, row or older function changes (/admin/tools keeps
-- admin_tool_summary / admin_tool_detail).
--
-- Grants are explicit (0097): all five are the service role's (the page
-- checks is_admin before calling). Idempotent. Ships through a PR; never
-- applied ad-hoc.

-- ---------------------------------------------------------------------------
-- 1. Every tool, one row each
-- ---------------------------------------------------------------------------
-- One row per tool with an event in the period (a tool with none has no
-- row: the page lists the catalog and fills zeros). `users` = distinct
-- signed-in users with any event; `using_users` = those with a use.
-- `last_event_at` = the newest event IN THE PERIOD.
create or replace function public.admin_tools_overview(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_uses jsonb default null,
  p_include_admins boolean default false
)
returns table (
  tool_slug text,
  users bigint,
  using_users bigint,
  opens bigint,
  uses bigint,
  failures bigint,
  last_event_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive slugs as (
    -- Every slug in the log, one index step each (never a scan of it).
    (select e.tool_slug from public.tool_events e order by e.tool_slug limit 1)
    union all
    select (
      select e.tool_slug from public.tool_events e
      where e.tool_slug > s.tool_slug
      order by e.tool_slug limit 1
    )
    from slugs s
    where s.tool_slug is not null
  )
  select
    s.tool_slug,
    a.users,
    a.using_users,
    a.opens,
    a.uses,
    a.failures,
    a.last_event_at
  from slugs s
  -- One aggregate PER TOOL (lateral), so each is a range scan of
  -- (tool_slug, created_at): joined to the slug list instead, the planner
  -- reads the whole log for any period.
  cross join lateral (
    select
      count(*) as events,
      count(distinct ev.user_id) as users,
      count(distinct ev.user_id) filter (where ev.is_use) as using_users,
      count(*) filter (where ev.event = 'open') as opens,
      count(*) filter (where ev.is_use) as uses,
      count(*) filter (where ev.is_failure) as failures,
      max(ev.created_at) as last_event_at
    from (
      select
        e.user_id,
        e.event,
        e.created_at,
        (e.event <> 'open'
          and (p_uses is null or coalesce(p_uses -> e.tool_slug, '[]'::jsonb) ? e.event)) as is_use,
        (e.event ~ '_(failed|refused|lost)$') as is_failure
      from public.tool_events e
      where e.tool_slug = s.tool_slug
        and e.created_at >= p_since
        and e.created_at < coalesce(p_until, now())
        and (
          coalesce(p_include_admins, false)
          or (
            e.access is distinct from 'admin'
            and (
              e.user_id is null
              or e.user_id not in (select p.id from public.profiles p where p.is_admin)
            )
          )
        )
    ) ev
  ) a
  where s.tool_slug is not null
    and a.events > 0;
$$;

revoke all on function public.admin_tools_overview(timestamptz, timestamptz, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.admin_tools_overview(timestamptz, timestamptz, jsonb, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 2. One tool, in full
-- ---------------------------------------------------------------------------
-- `p_slug` = a tool's slug, or '*' for EVERY tool together (never a slug:
-- a slug starts with a letter). '*' is how the page reads "people who used
-- a tool" across tools — a person who used three tools is ONE person, which
-- the overview's per-tool rows cannot add up to.
--
-- The answer, key by key:
--   slug    the p_slug asked for
--   totals  { users, using_users, opens, uses, failures,
--             visitor_events, last_event_at }
--             users / using_users = distinct SIGNED-IN users (any event /
--             a use); visitor_events = events with no user; last_event_at =
--             the newest event in the period, or null
--   daily   [{ day 'YYYY-MM-DD', opens, uses, failures, users }] — every UTC
--             day of the period, oldest first, zeros where nothing happened
--   events  [{ tool_slug, event, count, users }] — most frequent first
--   reasons [{ tool_slug, event, reason, count }] — failures that carry a
--             string `reason`, most frequent first
create or replace function public.admin_tool_breakdown(
  p_slug text,
  p_since timestamptz,
  p_until timestamptz default now(),
  p_uses jsonb default null,
  p_include_admins boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with recursive every_slug as (
    (select e.tool_slug from public.tool_events e order by e.tool_slug limit 1)
    union all
    select (
      select e.tool_slug from public.tool_events e
      where e.tool_slug > s.tool_slug
      order by e.tool_slug limit 1
    )
    from every_slug s
    where s.tool_slug is not null
  ),
  slugs as (
    -- The one tool asked for — or, for '*', every slug in the log (the
    -- recursive list is only walked then).
    select p_slug as tool_slug where p_slug <> '*'
    union all
    select s.tool_slug from every_slug s where p_slug = '*' and s.tool_slug is not null
  ),
  ev as (
    select x.*
    from slugs s
    -- Per slug, a range scan of (tool_slug, created_at). `offset 0` keeps
    -- the planner from folding this into a plain join, which it answers
    -- with a read of the whole log when the slugs are many ('*').
    cross join lateral (
      select
        e.tool_slug,
        e.user_id,
        e.event,
        e.props,
        e.created_at,
        (e.created_at at time zone 'utc')::date as day,
        (e.event <> 'open'
          and (p_uses is null or coalesce(p_uses -> e.tool_slug, '[]'::jsonb) ? e.event)) as is_use,
        (e.event ~ '_(failed|refused|lost)$') as is_failure
      from public.tool_events e
      where e.tool_slug = s.tool_slug
        and e.created_at >= p_since
        and e.created_at < coalesce(p_until, now())
        and (
          coalesce(p_include_admins, false)
          or (
            e.access is distinct from 'admin'
            and (
              e.user_id is null
              or e.user_id not in (select p.id from public.profiles p where p.is_admin)
            )
          )
        )
      offset 0
    ) x
  ),
  days as (
    -- The period's UTC days. `p_until` is exclusive: a period that ends on
    -- a midnight ends with the day before.
    select d::date as day
    from generate_series(
      (p_since at time zone 'utc')::date::timestamp,
      ((coalesce(p_until, now()) - interval '1 microsecond') at time zone 'utc')::date::timestamp,
      interval '1 day'
    ) d
  ),
  per_day as (
    select
      ev.day,
      count(*) filter (where ev.event = 'open') as opens,
      count(*) filter (where ev.is_use) as uses,
      count(*) filter (where ev.is_failure) as failures,
      count(distinct ev.user_id) as users
    from ev
    group by ev.day
  )
  select jsonb_build_object(
    'slug', p_slug,
    'totals', (
      select jsonb_build_object(
        'users', count(distinct ev.user_id),
        'using_users', count(distinct ev.user_id) filter (where ev.is_use),
        'opens', count(*) filter (where ev.event = 'open'),
        'uses', count(*) filter (where ev.is_use),
        'failures', count(*) filter (where ev.is_failure),
        'visitor_events', count(*) filter (where ev.user_id is null),
        'last_event_at', max(ev.created_at)
      )
      from ev
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', to_char(days.day, 'YYYY-MM-DD'),
        'opens', coalesce(pd.opens, 0),
        'uses', coalesce(pd.uses, 0),
        'failures', coalesce(pd.failures, 0),
        'users', coalesce(pd.users, 0)
      ) order by days.day)
      from days
      left join per_day pd on pd.day = days.day
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object('tool_slug', x.tool_slug, 'event', x.event, 'count', x.n, 'users', x.u)
        order by x.n desc, x.event, x.tool_slug
      )
      from (
        select ev.tool_slug, ev.event, count(*) as n, count(distinct ev.user_id) as u
        from ev
        group by ev.tool_slug, ev.event
      ) x
    ), '[]'::jsonb),
    'reasons', coalesce((
      select jsonb_agg(
        jsonb_build_object('tool_slug', x.tool_slug, 'event', x.event, 'reason', x.reason, 'count', x.n)
        order by x.n desc, x.event, x.reason, x.tool_slug
      )
      from (
        -- A reason is a CODE (lower-case snake case); anything else — a
        -- browser may post any short string — is counted as "other". The
        -- 50 most frequent, so the list cannot be grown without bound.
        select ev.tool_slug, ev.event, r.reason, count(*) as n
        from ev
        cross join lateral (
          select case
            when ev.props ->> 'reason' ~ '^[a-z][a-z0-9_]{0,39}$' then ev.props ->> 'reason'
            else 'other'
          end as reason
        ) r
        where ev.is_failure and jsonb_typeof(ev.props -> 'reason') = 'string'
        group by ev.tool_slug, ev.event, r.reason
        order by count(*) desc, ev.event, r.reason, ev.tool_slug
        limit 50
      ) x
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.admin_tool_breakdown(text, timestamptz, timestamptz, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.admin_tool_breakdown(text, timestamptz, timestamptz, jsonb, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Everyone who used a tool
-- ---------------------------------------------------------------------------
-- Every signed-in user with an event of the tool in the period: most uses
-- first, then the most recent (the user id last, so a page never repeats or
-- drops a row). `access` = the path of their newest event; `active_days` =
-- UTC days with any event; `total_count` = how many such users there are —
-- the same on every row — for the pager. `p_limit` is held to 1..200.
create or replace function public.admin_tool_users(
  p_slug text,
  p_since timestamptz,
  p_until timestamptz default now(),
  p_uses jsonb default null,
  p_include_admins boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  username text,
  is_admin boolean,
  access text,
  opens bigint,
  uses bigint,
  failures bigint,
  active_days bigint,
  first_at timestamptz,
  last_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with ev as (
    select
      e.id,
      e.user_id,
      e.event,
      e.access,
      e.created_at,
      (e.event <> 'open'
        and (p_uses is null or coalesce(p_uses -> e.tool_slug, '[]'::jsonb) ? e.event)) as is_use,
      (e.event ~ '_(failed|refused|lost)$') as is_failure
    from public.tool_events e
    where e.tool_slug = p_slug
      and e.user_id is not null
      and e.created_at >= p_since
      and e.created_at < coalesce(p_until, now())
      and (
        coalesce(p_include_admins, false)
        or (
          e.access is distinct from 'admin'
          and e.user_id not in (select p.id from public.profiles p where p.is_admin)
        )
      )
  ),
  per_user as (
    select
      ev.user_id,
      (array_agg(ev.access order by ev.created_at desc, ev.id desc))[1] as access,
      count(*) filter (where ev.event = 'open') as opens,
      count(*) filter (where ev.is_use) as uses,
      count(*) filter (where ev.is_failure) as failures,
      count(distinct (ev.created_at at time zone 'utc')::date) as active_days,
      min(ev.created_at) as first_at,
      max(ev.created_at) as last_at
    from ev
    group by ev.user_id
  )
  select
    u.user_id,
    pr.username,
    coalesce(pr.is_admin, false),
    u.access,
    u.opens,
    u.uses,
    u.failures,
    u.active_days,
    u.first_at,
    u.last_at,
    count(*) over ()
  from per_user u
  left join public.profiles pr on pr.id = u.user_id
  order by u.uses desc, u.last_at desc, u.user_id
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.admin_tool_users(text, timestamptz, timestamptz, jsonb, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_tool_users(text, timestamptz, timestamptz, jsonb, boolean, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. One user's events of one tool
-- ---------------------------------------------------------------------------
-- The newest first, whenever they happened (no period: this is the log a
-- support question is answered from). `p_limit` is held to 1..500. Props
-- are counts, codes and booleans (lib/tools/events.ts) — never typed text.
create or replace function public.admin_tool_user_events(
  p_slug text,
  p_user_id uuid,
  p_limit integer default 100
)
returns table (
  created_at timestamptz,
  event text,
  access text,
  props jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.created_at, e.event, e.access, e.props
  from public.tool_events e
  where e.user_id = p_user_id
    and e.tool_slug = p_slug
  order by e.created_at desc, e.id desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.admin_tool_user_events(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_tool_user_events(text, uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 5. One user's tools
-- ---------------------------------------------------------------------------
-- All time: one row per tool the user has an event of, the most recently
-- touched first.
create or replace function public.admin_user_tool_usage(
  p_user_id uuid,
  p_uses jsonb default null
)
returns table (
  tool_slug text,
  opens bigint,
  uses bigint,
  failures bigint,
  last_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.tool_slug,
    count(*) filter (where e.event = 'open'),
    count(*) filter (
      where e.event <> 'open'
        and (p_uses is null or coalesce(p_uses -> e.tool_slug, '[]'::jsonb) ? e.event)
    ),
    count(*) filter (where e.event ~ '_(failed|refused|lost)$'),
    max(e.created_at)
  from public.tool_events e
  where e.user_id = p_user_id
  group by e.tool_slug
  order by max(e.created_at) desc, e.tool_slug;
$$;

revoke all on function public.admin_user_tool_usage(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_user_tool_usage(uuid, jsonb) to service_role;

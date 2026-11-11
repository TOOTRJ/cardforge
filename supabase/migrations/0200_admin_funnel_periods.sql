-- 0200_admin_funnel_periods.sql — the funnel reads a PERIOD, follows the
-- people who signed up in it, and measures a trial over its own length.
--
-- For the admin analytics page (/admin/analytics, the 2026-11 analytics
-- audit). Nothing a user sees changes; what the admin reads does.
--
-- 1. admin_funnel_counts takes the period's END (`p_until`, null = no end)
--    as well as its start. The panel's windows were hard-coded — 7 days and
--    30 days back from "now" — so a period could never be set beside the
--    one before it. The app asks twice: the period, then the same stretch
--    N days earlier, [previousSince, previousUntil), exactly as long.
--
-- 2. admin_trial_engagement measures each trial over ITS OWN length. The
--    old body counted every trial's activity over a fixed 7 days, but a
--    trial is as long as the days banked for it (the 7 signup days, a
--    friend's days on top), and it read the activity through a list cut at
--    `p_since`. Now: the trials STARTED in the period; `ended_at` = the
--    time of that trial's `trial_converted` / `trial_lapsed` row (matched on
--    the subscription id, the latest), null while it has none; activity is
--    counted from the start to that end (to now while it runs), never more
--    than 60 days, and never cut by the period's own edges. `window_days`
--    is that length to the nearest whole day, at least 1. `outcome` is the
--    end row's name; with none it is `ongoing` for 60 days and `unknown`
--    after — a `trial_started` row carries the tier, the interval and the
--    subscription id, never the trial's end, so a trial whose end was never
--    recorded cannot be told from a running one before that. Newest first,
--    200 trials at most.
--
-- 3. admin_funnel_cohort (new) follows the SAME people: of the accounts
--    whose `signup` row is in the period, how many have since reached each
--    step. It replaces the panel's "Rate 30d", which divided one step's
--    event count by the step before's — two unrelated counts (it once read
--    109 first cards over 42 signups). An account deleted since has no user
--    id on its rows and cannot be followed: it is not in the cohort.
--
-- 4. admin_signups_daily (new): signups per UTC day and how the account was
--    made (`props.method`). A row with NO method is an email signup: until
--    0197 the email form was the only writer of a signup row (an account
--    made with Google or Discord had none — 0197 gave each one, with its
--    method), and it did not write the method down. So it is counted as
--    `email`, never as "not recorded".
--
-- The period is [p_since, p_until) and days are UTC. `p_include_admins =
-- false` (the default) leaves out the team's own accounts; a row with no
-- user is never an admin's. The two-argument signatures of the first two
-- functions go, so one name never resolves two ways; a call that names only
-- `p_since` (the deployment live while this lands) reaches the defaults.
--
-- Grants are explicit (0097): all four are the service role's alone.
-- Idempotent. Ships through a PR; never applied ad-hoc.

-- ---------------------------------------------------------------------------
-- 1. Counts per event in a period
-- ---------------------------------------------------------------------------
drop function if exists public.admin_funnel_counts(timestamptz, boolean);
create or replace function public.admin_funnel_counts(
  p_since timestamptz,
  p_include_admins boolean default false,
  p_until timestamptz default null
)
returns table (event text, n bigint, users bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.event,
    count(*)::bigint as n,
    count(distinct e.user_id)::bigint as users
  from public.funnel_events e
  where e.created_at >= p_since
    and (p_until is null or e.created_at < p_until)
    and (
      p_include_admins
      or e.user_id is null
      or e.user_id not in (select p.id from public.profiles p where p.is_admin)
    )
  group by e.event
$$;

revoke all on function public.admin_funnel_counts(timestamptz, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_funnel_counts(timestamptz, boolean, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 2. What each trial did, over its own length
-- ---------------------------------------------------------------------------
drop function if exists public.admin_trial_engagement(timestamptz, boolean);
create or replace function public.admin_trial_engagement(
  p_since timestamptz,
  p_include_admins boolean default false,
  p_until timestamptz default null
)
returns table (
  user_id uuid,
  username text,
  started_at timestamptz,
  ended_at timestamptz,
  window_days integer,
  outcome text,
  active_days integer,
  saves integer,
  generations integer,
  downloads integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with trials as (
    select e.id, e.user_id, e.created_at as started_at, e.props ->> 'subscriptionId' as sub_id
    from public.funnel_events e
    where e.event = 'trial_started'
      and e.user_id is not null
      and e.created_at >= p_since
      and (p_until is null or e.created_at < p_until)
      and (
        p_include_admins
        or e.user_id not in (select p.id from public.profiles p where p.is_admin)
      )
    order by e.created_at desc, e.id desc
    limit 200
  ),
  ended as (
    select t.id, t.user_id, t.started_at, o.event as end_event, o.created_at as ended_at
    from trials t
    left join lateral (
      select f.event, f.created_at
      from public.funnel_events f
      where f.event in ('trial_converted', 'trial_lapsed')
        and f.props ->> 'subscriptionId' = t.sub_id
      order by f.created_at desc
      limit 1
    ) o on true
  ),
  measured as (
    -- The window the trial is measured over: start → its end (now while it
    -- runs), never more than 60 days, never before its own start.
    select
      d.*,
      greatest(
        d.started_at,
        least(coalesce(d.ended_at, now()), d.started_at + interval '60 days')
      ) as window_end
    from ended d
  )
  select
    m.user_id,
    p.username,
    m.started_at,
    m.ended_at,
    greatest(1, round(extract(epoch from (m.window_end - m.started_at)) / 86400.0)::integer) as window_days,
    coalesce(
      m.end_event,
      case when m.started_at + interval '60 days' > now() then 'ongoing' else 'unknown' end
    ) as outcome,
    a.active_days,
    a.saves,
    a.generations,
    a.downloads
  from measured m
  left join public.profiles p on p.id = m.user_id
  cross join lateral (
    select
      count(distinct (f.created_at at time zone 'utc')::date)::integer as active_days,
      (count(*) filter (where f.event = 'card_saved'))::integer as saves,
      (count(*) filter (where f.event = 'ai_generation'))::integer as generations,
      (count(*) filter (where f.event = 'download'))::integer as downloads
    from public.funnel_events f
    where f.user_id = m.user_id
      and f.event in ('card_saved', 'ai_generation', 'download')
      and f.created_at >= m.started_at
      and f.created_at <= m.window_end
  ) a
  order by m.started_at desc, m.id desc
$$;

revoke all on function public.admin_trial_engagement(timestamptz, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_trial_engagement(timestamptz, boolean, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The people who signed up in the period, and how far they have come
-- ---------------------------------------------------------------------------
create or replace function public.admin_funnel_cohort(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_include_admins boolean default false
)
returns table (step text, users bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with cohort as (
    select distinct e.user_id
    from public.funnel_events e
    where e.event = 'signup'
      and e.user_id is not null
      and e.created_at >= p_since
      and e.created_at < p_until
      and (
        p_include_admins
        or e.user_id not in (select p.id from public.profiles p where p.is_admin)
      )
  ),
  steps (step, position) as (
    values
      ('signup', 1),
      ('first_card_saved', 2),
      ('first_ai_generation', 3),
      ('first_download', 4),
      ('trial_started', 5),
      ('trial_converted', 6)
  )
  select
    s.step,
    (
      select count(distinct f.user_id)
      from public.funnel_events f
      where f.event = s.step
        and f.user_id in (select c.user_id from cohort c)
    )::bigint as users
  from steps s
  order by s.position
$$;

revoke all on function public.admin_funnel_cohort(timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.admin_funnel_cohort(timestamptz, timestamptz, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Signups per UTC day, by how the account was made
-- ---------------------------------------------------------------------------
create or replace function public.admin_signups_daily(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_include_admins boolean default false
)
returns table (day date, method text, n bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (e.created_at at time zone 'utc')::date as day,
    coalesce(nullif(e.props ->> 'method', ''), 'email') as method,
    count(*)::bigint as n
  from public.funnel_events e
  where e.event = 'signup'
    and e.created_at >= p_since
    and e.created_at < p_until
    and (
      p_include_admins
      or e.user_id is null
      or e.user_id not in (select p.id from public.profiles p where p.is_admin)
    )
  group by 1, 2
  order by 1, 2
$$;

revoke all on function public.admin_signups_daily(timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.admin_signups_daily(timestamptz, timestamptz, boolean) to service_role;

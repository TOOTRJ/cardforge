-- 0197_funnel_correctness.sql — the funnel counts what it says it counts.
--
-- Found by the 2026-11-10 analytics audit; none of it changes what a user
-- sees, all of it changes what the admin reads.
--
-- 1. ONCE-PER-USER events are once per user. `signup` and the three
--    activation milestones (`first_card_saved`, `first_ai_generation`,
--    `first_download`) were written check-then-insert
--    (lib/analytics/funnel-server.ts recordActivity) with nothing in the
--    database to hold them to one: parallel AI job steps or a ZIP export
--    could write several "firsts" for one user. The duplicates go (the
--    earliest row stays) and a partial UNIQUE index keeps it so; the app
--    now inserts and reads the conflict.
--
-- 2. EVERY account has a `signup` row. Only the email form wrote one
--    (app/(auth)/actions.ts), so an account made with Google or Discord had
--    none — "Signups", the source lists and the signup → first card rate
--    all left them out — and neither had an account older than 0112. Each
--    account without a row gets one, dated when the account was created,
--    with how it signed up (`method`: its FIRST identity's provider — the
--    account's own `provider` field can change when an identity is linked)
--    and `backfilled: true`, which the admin lists read as "not recorded"
--    (never "direct": nobody knows where these arrived from). Anonymous and
--    soft-deleted auth users are not accounts. From here on the app writes
--    an OAuth account's row itself, at /auth/callback, and adds its first
--    touch at onboarding (lib/analytics/funnel-server.ts recordSignup).
--
-- 3. The team is not the funnel. admin_funnel_counts, admin_trial_engagement
--    and admin_credit_grant_stats counted admin accounts — in beta, most of
--    the activity. Each takes `p_include_admins boolean default false` and
--    leaves them out unless asked. A call that names only `p_since` (the
--    deployment live while this lands) reaches the new function with the
--    default. A row with no user (an anonymous step, a deleted account) is
--    never an admin's.
--
-- Not here on purpose: the trial-engagement table's 7-day window and the
-- "Rate 30d" columns are redefined with the admin analytics page.
--
-- Grants are explicit (0097): the three functions stay the service role's.
-- Idempotent. Ships through a PR; never applied ad-hoc.

-- ---------------------------------------------------------------------------
-- 1. Once per user
-- ---------------------------------------------------------------------------
-- No writer between the clean-up and the index: the deployment live while
-- this lands still checks-then-inserts, and a duplicate committed in
-- between would fail the index (and the migration). Readers go on; the
-- writes are deferred, best-effort rows that wait the few milliseconds.
lock table public.funnel_events in share row exclusive mode;

delete from public.funnel_events f
using public.funnel_events keep
where f.user_id is not null
  and f.event in ('signup', 'first_card_saved', 'first_ai_generation', 'first_download')
  and keep.user_id = f.user_id
  and keep.event = f.event
  and (keep.created_at, keep.id) < (f.created_at, f.id);

create unique index if not exists funnel_events_once_per_user_idx
  on public.funnel_events (user_id, event)
  where user_id is not null
    and event in ('signup', 'first_card_saved', 'first_ai_generation', 'first_download');

comment on index public.funnel_events_once_per_user_idx is
  'A user has ONE signup row and ONE of each activation milestone (0197). The app inserts and treats the conflict as "already recorded" (lib/analytics/funnel-server.ts).';

-- ---------------------------------------------------------------------------
-- 2. A signup row for every account
-- ---------------------------------------------------------------------------
insert into public.funnel_events (event, user_id, props, source, created_at)
select
  'signup',
  u.id,
  jsonb_build_object(
    'method',
    case
      when m.provider in ('email', 'google', 'discord') then m.provider
      else 'other'
    end,
    'backfilled', true
  ),
  'server',
  coalesce(u.created_at, now())
from auth.users u
cross join lateral (
  select coalesce(
    (select i.provider from auth.identities i
      where i.user_id = u.id
      order by i.created_at asc nulls last, i.id asc
      limit 1),
    u.raw_app_meta_data ->> 'provider',
    'email'
  ) as provider
) m
where u.deleted_at is null
  and not coalesce(u.is_anonymous, false)
  and not exists (
    select 1 from public.funnel_events f where f.user_id = u.id and f.event = 'signup'
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Admins left out unless asked
-- ---------------------------------------------------------------------------

-- Counts per event since p_since — the admin Funnel panel's one read.
drop function if exists public.admin_funnel_counts(timestamptz);
create or replace function public.admin_funnel_counts(
  p_since timestamptz,
  p_include_admins boolean default false
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
    and (
      p_include_admins
      or e.user_id is null
      or e.user_id not in (select p.id from public.profiles p where p.is_admin)
    )
  group by e.event
$$;

revoke all on function public.admin_funnel_counts(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.admin_funnel_counts(timestamptz, boolean) to service_role;

-- What each trial did during its first 7 days (0113's body, unchanged but
-- for the admin filter on the trials it lists).
drop function if exists public.admin_trial_engagement(timestamptz);
create or replace function public.admin_trial_engagement(
  p_since timestamptz,
  p_include_admins boolean default false
)
returns table (
  user_id uuid,
  username text,
  started_at timestamptz,
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
    select e.user_id, e.created_at as started_at, e.props ->> 'subscriptionId' as sub_id
    from public.funnel_events e
    where e.event = 'trial_started'
      and e.user_id is not null
      and e.created_at >= p_since
      and (
        p_include_admins
        or e.user_id not in (select p.id from public.profiles p where p.is_admin)
      )
  ),
  activity as (
    select a.user_id, a.event, a.created_at
    from public.funnel_events a
    where a.event in ('card_saved', 'ai_generation', 'download')
      and a.user_id is not null
      and a.created_at >= p_since
  )
  select
    t.user_id,
    p.username,
    t.started_at,
    coalesce(
      (select o.event from public.funnel_events o
        where o.event in ('trial_converted', 'trial_lapsed')
          and o.props ->> 'subscriptionId' = t.sub_id
        order by o.created_at desc limit 1),
      case when t.started_at + interval '7 days' > now() then 'ongoing' else 'unknown' end
    ) as outcome,
    (select count(distinct date_trunc('day', a.created_at))::integer from activity a
      where a.user_id = t.user_id and a.created_at between t.started_at and t.started_at + interval '7 days') as active_days,
    (select count(*)::integer from activity a
      where a.user_id = t.user_id and a.event = 'card_saved' and a.created_at between t.started_at and t.started_at + interval '7 days') as saves,
    (select count(*)::integer from activity a
      where a.user_id = t.user_id and a.event = 'ai_generation' and a.created_at between t.started_at and t.started_at + interval '7 days') as generations,
    (select count(*)::integer from activity a
      where a.user_id = t.user_id and a.event = 'download' and a.created_at between t.started_at and t.started_at + interval '7 days') as downloads
  from trials t
  left join public.profiles p on p.id = t.user_id
  order by t.started_at desc
  limit 50
$$;

revoke all on function public.admin_trial_engagement(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.admin_trial_engagement(timestamptz, boolean) to service_role;

-- Credits granted by reason (0181's body, unchanged but for the filter).
drop function if exists public.admin_credit_grant_stats(timestamptz);
create or replace function public.admin_credit_grant_stats(
  p_since timestamptz default null,
  p_include_admins boolean default false
)
returns table (reason text, credits bigint, grants bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(nullif(lower(btrim(split_part(l.reason, ':', 1))), ''), 'other') as reason,
    sum(l.delta)::bigint as credits,
    count(*)::bigint as grants
  from public.credit_ledger l
  where l.delta > 0
    and (p_since is null or l.created_at >= p_since)
    and (
      p_include_admins
      or l.user_id not in (select p.id from public.profiles p where p.is_admin)
    )
  group by 1
  order by 2 desc, 1 asc;
$$;

revoke all on function public.admin_credit_grant_stats(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.admin_credit_grant_stats(timestamptz, boolean) to service_role;

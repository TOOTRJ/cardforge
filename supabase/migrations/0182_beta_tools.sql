-- 0182_beta_tools.sql — beta tools: who may open a tool before it is
-- released, how an admin releases it, and what it is used for (owner request
-- 2026-11-06; lib/tools/*, /admin/tools, /dashboard/tools).
--
-- A TOOL is declared in code (lib/tools/catalog.ts: its slug, name, page,
-- whether it is built). The database holds only what an admin changes
-- without a deploy:
--
-- 1. tool_releases — one row per tool an admin has touched. `release_tier`
--    NULL = BETA (admins + testers only); 'free' / 'plus' / 'pro' = released
--    to that plan and up. `paused` is the kill switch: admins only, testers
--    and plans included. A tool with no row is in beta.
-- 2. tool_access_grants — the testers: one row per (tool, user), optionally
--    ending (`expires_at`). Written by the admin actions (service role) only.
-- 3. tool_interest — "Notify me" on a coming-soon card: one row per (tool,
--    user). The admin page lists them and grants access from the list.
-- 4. tool_events — what a tool is used for: `open` (its page) and the
--    tool's own event names (a search, a generation, a download). Service
--    role only; the admin page reads it through the functions below. Rows
--    carry the access path that let the user in ('admin' / 'grant' /
--    'release'), so beta use and released use read apart.
-- 5. has_tool_access(slug) — the ONE access rule in SQL, for a tool's own
--    tables' RLS (a collection table, say). Mirrors lib/tools/access.ts
--    `resolveToolAccess` with billing ON (the TS side gives everyone the Pro
--    perks while billing is off, as getEntitlements does); change both
--    together.
-- 6. admin_tool_summary() / admin_tool_detail(slug, days) — the admin
--    page's numbers, service role only (the page checks is_admin first).
-- 7. The notification kind 'tool_access' (0179's list plus it): a tester is
--    told when they are let in.
--
-- Grants are explicit (0097). Idempotent. Ships through a PR; never applied
-- ad-hoc.

-- ---------------------------------------------------------------------------
-- 1. Release state
-- ---------------------------------------------------------------------------
create table if not exists public.tool_releases (
  slug text primary key check (slug ~ '^[a-z][a-z0-9-]{1,47}$'),
  release_tier text check (release_tier in ('free', 'plus', 'pro')),
  paused boolean not null default false,
  released_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.tool_releases is
  'Beta tools (0182): who a tool is released to. release_tier NULL = beta (admins + tool_access_grants only); free/plus/pro = that plan and up. paused = admins only. No row = beta. Tools themselves are declared in lib/tools/catalog.ts.';

alter table public.tool_releases enable row level security;

-- What is released to whom is not a secret (the hub shows it): anyone reads.
drop policy if exists "Tool releases: anyone reads" on public.tool_releases;
create policy "Tool releases: anyone reads"
  on public.tool_releases for select
  using (true);

revoke all on public.tool_releases from public, anon, authenticated;
grant select on public.tool_releases to anon, authenticated;
grant select, insert, update, delete on public.tool_releases to service_role;

-- ---------------------------------------------------------------------------
-- 2. Testers
-- ---------------------------------------------------------------------------
create table if not exists public.tool_access_grants (
  tool_slug text not null check (tool_slug ~ '^[a-z][a-z0-9-]{1,47}$'),
  user_id uuid not null references public.profiles (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  note text check (note is null or char_length(note) <= 200),
  primary key (tool_slug, user_id)
);

create index if not exists tool_access_grants_user_idx
  on public.tool_access_grants (user_id);

comment on table public.tool_access_grants is
  'Beta testers (0182): a user let into a tool before it is released to their plan. expires_at NULL = until revoked. Written by the admin actions (service role) only.';

alter table public.tool_access_grants enable row level security;

drop policy if exists "Tool grants: own or admin read" on public.tool_access_grants;
create policy "Tool grants: own or admin read"
  on public.tool_access_grants for select
  to authenticated
  using (user_id = auth.uid() or public.viewer_is_admin());

revoke all on public.tool_access_grants from public, anon, authenticated;
grant select on public.tool_access_grants to authenticated;
grant select, insert, update, delete on public.tool_access_grants to service_role;

-- ---------------------------------------------------------------------------
-- 3. Interest ("Notify me")
-- ---------------------------------------------------------------------------
create table if not exists public.tool_interest (
  tool_slug text not null check (tool_slug ~ '^[a-z][a-z0-9-]{1,47}$'),
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tool_slug, user_id)
);

create index if not exists tool_interest_user_idx
  on public.tool_interest (user_id);

comment on table public.tool_interest is
  'Beta tools (0182): a user asked to hear about a tool that is not open to them yet. Written by the server action (service role) only, after it checks the slug against the catalog.';

alter table public.tool_interest enable row level security;

drop policy if exists "Tool interest: own or admin read" on public.tool_interest;
create policy "Tool interest: own or admin read"
  on public.tool_interest for select
  to authenticated
  using (user_id = auth.uid() or public.viewer_is_admin());

revoke all on public.tool_interest from public, anon, authenticated;
grant select on public.tool_interest to authenticated;
grant select, insert, update, delete on public.tool_interest to service_role;

-- ---------------------------------------------------------------------------
-- 4. Usage events
-- ---------------------------------------------------------------------------
create table if not exists public.tool_events (
  id bigint generated always as identity primary key,
  tool_slug text not null check (tool_slug ~ '^[a-z][a-z0-9-]{1,47}$'),
  user_id uuid references public.profiles (id) on delete set null,
  event text not null check (event ~ '^[a-z][a-z0-9_]{1,39}$'),
  access text check (access in ('admin', 'grant', 'release')),
  props jsonb not null default '{}'::jsonb
    check (jsonb_typeof(props) = 'object' and octet_length(props::text) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists tool_events_slug_time_idx
  on public.tool_events (tool_slug, created_at desc);
create index if not exists tool_events_user_idx
  on public.tool_events (user_id, created_at desc);

comment on table public.tool_events is
  'Beta tools (0182): one row per tool event — open (the tool''s page) or a tool''s own action name. access = the path that let the user in. Service role only; read through admin_tool_summary / admin_tool_detail.';

alter table public.tool_events enable row level security;

revoke all on public.tool_events from public, anon, authenticated;
grant select, insert, update, delete on public.tool_events to service_role;

-- ---------------------------------------------------------------------------
-- 5. The access rule
-- ---------------------------------------------------------------------------
create or replace function public.has_tool_access(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select
      p.id,
      coalesce(p.is_admin, false) as is_admin,
      greatest(
        case
          when p.subscription_tier in ('plus', 'pro')
           and public.subscription_perks_on(p.subscription_status, p.payment_failed_at)
          then case p.subscription_tier when 'pro' then 2 else 1 end
          else 0
        end,
        case
          when p.comp_tier in ('plus', 'pro')
           and (p.comp_expires_at is null or p.comp_expires_at > now())
          then case p.comp_tier when 'pro' then 2 else 1 end
          else 0
        end
      ) as tier_rank
    from public.profiles p
    where p.id = auth.uid()
  ),
  rel as (
    select r.release_tier, r.paused
    from public.tool_releases r
    where r.slug = p_slug
  )
  select coalesce((
    select me.is_admin
        or (
          not coalesce((select rel.paused from rel), false)
          and (
            exists (
              select 1 from rel
              where rel.release_tier is not null
                and me.tier_rank >= case rel.release_tier when 'pro' then 2 when 'plus' then 1 else 0 end
            )
            or exists (
              select 1 from public.tool_access_grants g
              where g.tool_slug = p_slug
                and g.user_id = me.id
                and (g.expires_at is null or g.expires_at > now())
            )
          )
        )
    from me
  ), false);
$$;

comment on function public.has_tool_access(text) is
  'Whether the caller may use a tool (0182): an admin always; nobody else while it is paused; else a plan at or above its release_tier, or an unexpired tool_access_grants row. Mirrors lib/tools/access.ts resolveToolAccess (billing on); change both together.';

revoke all on function public.has_tool_access(text) from public, anon;
grant execute on function public.has_tool_access(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The admin page's numbers
-- ---------------------------------------------------------------------------

-- One row per tool that has a release row, a tester, an interested user or
-- an event: the overview's counts.
create or replace function public.admin_tool_summary()
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
      where e.tool_slug = s.tool_slug and e.event <> 'open' and e.created_at > now() - interval '30 days'),
    (select max(e.created_at) from public.tool_events e where e.tool_slug = s.tool_slug)
  from slugs s;
$$;

-- One tool over the last p_days (1–365): totals, a zero-filled UTC day
-- series, the event names, the access paths and the 20 most active users.
create or replace function public.admin_tool_detail(p_slug text, p_days integer default 30)
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
    select e.*
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
      count(*) filter (where ev.event <> 'open') as uses,
      count(distinct ev.user_id) as users
    from ev
    group by 1
  ),
  per_user as (
    select
      ev.user_id,
      count(*) filter (where ev.event = 'open') as opens,
      count(*) filter (where ev.event <> 'open') as uses,
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
      'uses', (select count(*) from ev where event <> 'open'),
      'users', (select count(distinct user_id) from ev),
      'using_users', (select count(distinct user_id) from ev where event <> 'open'),
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
               count(*) filter (where event <> 'open') as n
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

revoke all on function public.admin_tool_summary() from public, anon, authenticated;
grant execute on function public.admin_tool_summary() to service_role;
revoke all on function public.admin_tool_detail(text, integer) from public, anon, authenticated;
grant execute on function public.admin_tool_detail(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Notification kind
-- ---------------------------------------------------------------------------
alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'like', 'comment', 'remix', 'follow', 'feedback', 'moderation', 'message',
      'credit_grant', 'comp_plan', 'card_limit', 'render_update', 'site_update',
      'deck_generated', 'trial_ending', 'payment_received', 'checkout_reminder',
      'trial_lapsed', 'render_sweep_paused', 'credit_refill_failed',
      'deck_like', 'deck_card_added', 'moderation_unhidden', 'comp_ending',
      'deck_cloned', 'challenge_winner',
      'payment_failed', 'billing_alert',
      'referral_signup', 'referral_reward',
      'banked_days',
      -- BETA TOOLS
      'tool_access'
    )
  );

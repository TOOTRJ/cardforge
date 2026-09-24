-- 0112 — funnel_events: first-party funnel instrumentation.
--
-- One row per funnel step, written server-side by the code paths that already
-- see the money moving (checkout action, Stripe webhook) and by POST
-- /api/events for the handful of steps only the browser sees (pricing page
-- view, CTA click, upgrade-modal open). No identifiers for signed-out
-- visitors — anonymous rows carry user_id NULL and nothing else (owner
-- decision 2026-09-24: counts, no cookie). Signed-in rows carry the user id
-- so the admin Funnel panel can count distinct users per step.
--
-- `event` is validated in the app (lib/analytics/funnel-events.ts) rather
-- than by a CHECK, so adding a step is a code change, not a migration.
-- `props` is a small allow-listed JSON object (tier, period, pack, surface,
-- reason, amounts) — never free text.
--
-- Reads: admins, through admin_funnel_counts() (service role, called after
-- the admin check). Writes: service role only. Rows older than 180 days are
-- pruned weekly (/api/cron/prune-funnel-events).

create table if not exists public.funnel_events (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  user_id uuid references auth.users (id) on delete set null,
  props jsonb not null default '{}'::jsonb,
  source text not null default 'server' check (source in ('server', 'client')),
  created_at timestamptz not null default now()
);

create index if not exists funnel_events_event_created_idx
  on public.funnel_events (event, created_at desc);
create index if not exists funnel_events_created_idx
  on public.funnel_events (created_at);
create index if not exists funnel_events_user_event_idx
  on public.funnel_events (user_id, event)
  where user_id is not null;

alter table public.funnel_events enable row level security;

drop policy if exists "Funnel events: admin read" on public.funnel_events;
create policy "Funnel events: admin read"
  on public.funnel_events for select
  using (public.viewer_is_admin());

-- Counts per event since p_since — the admin Funnel panel's one read.
create or replace function public.admin_funnel_counts(p_since timestamptz)
returns table (event text, n bigint, users bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.event,
    count(*)::bigint as n,
    count(distinct e.user_id)::bigint as users
  from public.funnel_events e
  where e.created_at >= p_since
  group by e.event
$$;

-- Grants (every migration states them — new projects don't auto-grant).
grant select on public.funnel_events to authenticated;
grant select, insert, update, delete on public.funnel_events to service_role;
revoke all on function public.admin_funnel_counts(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_funnel_counts(timestamptz) to service_role;

-- 0121 — automatic re-bake: one shared sweep lease, a circuit breaker, and
-- what the admin control shows.
--
-- A "sweep" layout bump (lib/cards/layout-version.ts VERSION_ROLLOUT) used to
-- wait for the owner to run scripts/rebake-renders.mjs from a laptop. The
-- cron /api/cron/auto-rebake (vercel.json, every 10 minutes on production)
-- now re-bakes those cards itself (lib/cards/auto-rebake.ts). Three callers
-- run the same batch (lib/cards/rebake-batch.ts): that cron, the manual
-- POST /api/admin/rebake (the script) and the compare page's
-- POST /api/admin/rebake-marked. They must never run at the same time.
--
-- public.render_sweep_state — ONE row (id = 1):
--   lease_holder / lease_token / lease_expires_at
--       The sweep lease. 'cron' or 'manual' (the script and the compare
--       page). A holder with a token is running a batch now. A 'manual'
--       holder WITHOUT a token is "parked" between two calls of a manual run:
--       the next manual call may take it back, the cron may not. The expiry
--       (310 s after taking it) is just over the routes' maxDuration (300 s),
--       so a function that dies without releasing frees it on its own.
--   yield_requested_at
--       A manual call found the cron holding the lease and asked it to stop
--       after its current batch. Cleared whenever the lease is taken.
--   paused / paused_reason / paused_at
--       The breaker (or an admin) paused the automatic sweep. Only the cron
--       reads it; the manual routes still run. Resuming clears it.
--   strikes   { "<card id>": { "n", "error", "at" } } — failed attempts, one
--             per cron invocation; a card that is re-baked loses its entry.
--   poison    [ { "id", "error", "failures", "at" } ] — cards that failed
--             3 invocations in a row. The cron skips them until an admin
--             retries them. Kept short (the breaker trips past 50).
--   last_run  the last cron invocation's summary (counts, stop reason).
--   idle      { layoutVersion, candidates, at } — the "nothing to do" pre-check
--             fingerprint (lib/cards/auto-rebake.ts explains).
--   last_checked_at, revalidate_pending — bookkeeping.
--
-- Card ids of UNLISTED cards are in strikes/poison, so the table is NOT
-- readable by anon/authenticated (site_settings is public, hence not there):
-- RLS on with no policies, and only service_role has grants. The admin page
-- and its actions check is_admin themselves and use the service-role client,
-- like the other is_admin-gated tooling.
--
-- Lease functions (service_role only):
--   acquire_render_sweep_lease(holder, token, ttl_seconds)
--       One conditional UPDATE on the single row. It takes the lease when it
--       is free or expired, when the caller already holds it (same token),
--       or when it is parked for the same holder. Two concurrent callers
--       serialize on the row lock; the second re-checks the WHERE against
--       the first one's write and loses. Returns (acquired, holder,
--       expires_at) — the current holder when it lost.
--   release_render_sweep_lease(token, park_seconds)
--       Only the holder's token releases. park_seconds > 0 parks it (keeps
--       the holder, drops the token, expires after park_seconds).
--   request_render_sweep_yield()
--       Stamps yield_requested_at while the CRON holds a live lease.
--
-- notifications.type gains 'render_sweep_paused': one row per admin when the
-- breaker pauses the sweep (lib/notifications/describe.ts), delivered in real
-- time by the existing Realtime publication (0075).
--
-- Grants: stated below (new projects don't auto-grant; prod's anon/
-- authenticated grants are revoked explicitly).
--
-- Ships through a PR; never applied ad-hoc.

create table if not exists public.render_sweep_state (
  id smallint primary key default 1 check (id = 1),
  lease_holder text check (lease_holder in ('cron', 'manual')),
  lease_token uuid,
  lease_expires_at timestamptz,
  lease_acquired_at timestamptz,
  yield_requested_at timestamptz,
  paused boolean not null default false,
  paused_reason text check (paused_reason is null or char_length(paused_reason) <= 500),
  paused_at timestamptz,
  strikes jsonb not null default '{}'::jsonb check (jsonb_typeof(strikes) = 'object'),
  poison jsonb not null default '[]'::jsonb check (jsonb_typeof(poison) = 'array'),
  last_run jsonb,
  idle jsonb,
  last_checked_at timestamptz,
  revalidate_pending boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.render_sweep_state (id) values (1) on conflict (id) do nothing;

alter table public.render_sweep_state enable row level security;

create or replace function public.acquire_render_sweep_lease(
  p_holder text,
  p_token uuid,
  p_ttl_seconds integer
)
returns table (acquired boolean, holder text, expires_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_holder text;
  v_expires timestamptz;
begin
  if p_holder is null or p_holder not in ('cron', 'manual') then
    raise exception 'unknown sweep lease holder: %', p_holder;
  end if;
  if p_token is null then
    raise exception 'a sweep lease needs a token';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 900 then
    raise exception 'sweep lease ttl out of range: %', p_ttl_seconds;
  end if;

  insert into public.render_sweep_state (id) values (1) on conflict (id) do nothing;

  update public.render_sweep_state as s
     set lease_holder = p_holder,
         lease_token = p_token,
         lease_expires_at = now() + make_interval(secs => p_ttl_seconds),
         lease_acquired_at = now(),
         yield_requested_at = null,
         updated_at = now()
   where s.id = 1
     and (
       s.lease_expires_at is null
       or s.lease_expires_at <= now()
       or s.lease_token = p_token
       or (s.lease_token is null and s.lease_holder = p_holder)
     )
  returning s.lease_holder, s.lease_expires_at into v_holder, v_expires;

  if found then
    return query select true, v_holder, v_expires;
    return;
  end if;

  return query
  select false, s.lease_holder, s.lease_expires_at
    from public.render_sweep_state as s
   where s.id = 1;
end;
$$;

create or replace function public.release_render_sweep_lease(
  p_token uuid,
  p_park_seconds integer default 0
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.render_sweep_state as s
     set lease_token = null,
         lease_holder = case when coalesce(p_park_seconds, 0) > 0 then s.lease_holder else null end,
         lease_expires_at = case
           when coalesce(p_park_seconds, 0) > 0
             then now() + make_interval(secs => least(p_park_seconds, 900))
           else null
         end,
         updated_at = now()
   where s.id = 1
     and s.lease_token = p_token;
  return found;
end;
$$;

create or replace function public.request_render_sweep_yield()
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.render_sweep_state as s
     set yield_requested_at = now(),
         updated_at = now()
   where s.id = 1
     and s.lease_holder = 'cron'
     and s.lease_token is not null
     and s.lease_expires_at > now();
  return found;
end;
$$;

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'like', 'comment', 'remix', 'follow', 'feedback', 'moderation', 'message',
      'credit_grant', 'comp_plan', 'card_limit', 'render_update', 'site_update',
      'deck_generated', 'trial_ending', 'payment_received', 'checkout_reminder',
      'trial_lapsed', 'render_sweep_paused'
    )
  );

-- Grants -----------------------------------------------------------------------
revoke all on table public.render_sweep_state from public, anon, authenticated;
grant select, insert, update, delete on table public.render_sweep_state to service_role;

revoke all on function public.acquire_render_sweep_lease(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.acquire_render_sweep_lease(text, uuid, integer) to service_role;
revoke all on function public.release_render_sweep_lease(uuid, integer) from public, anon, authenticated;
grant execute on function public.release_render_sweep_lease(uuid, integer) to service_role;
revoke all on function public.request_render_sweep_yield() from public, anon, authenticated;
grant execute on function public.request_render_sweep_yield() to service_role;

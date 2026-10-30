-- 0153_referrals.sql — a double-sided referral program (2026-10-30).
-- Ships through a PR; never applied ad-hoc. (Placeholder number: the
-- orchestrator renumbers it at merge time.)
--
-- Every user gets a referral link (`/?ref=<code>`). A NEW account that signs
-- up through it — first-touch attribution, sessionStorage → hidden fields →
-- the signup action (no cookie) — and then SAVES ITS FIRST CARD earns one
-- free month for itself and one for the referrer (lib/referrals/*: the rules,
-- the fraud checks and the reward live in the app; this file holds the rows,
-- who may read them, and the one step that must be atomic: the caps).
--
-- 1. referral_codes — one code per user, minted on first ask by
--    my_referral_code() (the owner's own session; 8 lowercase hex chars from
--    gen_random_uuid, retried on the unique index). Read: the owner, admins.
--
-- 2. referrals — one row per REFEREE (unique): who referred them, and where
--    it stands:
--      signed_up   the account was created through the link
--      first_card  it saved its first card (the activation the reward waits for)
--      rewarded    both sides got their month
--      capped      the referrer was at a cap — the referee still got theirs
--      blocked     a fraud rule (block_reason) — see lib/referrals/fraud.ts
--      expired     the first card came more than 30 days after signup
--    Users read their own rows (as referrer or referee) through a COLUMN
--    grant that leaves out block_reason and the reward details (Stripe ids,
--    amounts): the dashboard shows a status, never a fraud signal. Admins
--    read every column through RLS + admin_referral_stats(). Writes: the
--    service role only (the app's signup / first-card / reward paths).
--
-- 3. claim_referral_reward(id, monthly_cap, lifetime_cap) — service role.
--    Moves ONE first_card row to rewarded or capped under a per-referrer
--    advisory lock, so two friends activating at once can't both slip under
--    the monthly cap. The caps are the app's numbers (REFERRAL_MONTHLY_CAP,
--    REFERRAL_LIFETIME_CAP), passed in — one source.
--
-- 4. Two notification kinds: referral_signup (to the referrer: someone
--    joined with your link) and referral_reward (either side: a free month).
--    Copy: lib/notifications/describe.ts.
--
-- Grants are stated (every migration states its grants — CLAUDE.md).

-- ---------------------------------------------------------------------------
-- 1. Codes
-- ---------------------------------------------------------------------------
create table if not exists public.referral_codes (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  code text not null unique check (code ~ '^[a-f0-9]{8}$'),
  created_at timestamptz not null default now()
);

alter table public.referral_codes enable row level security;

drop policy if exists "Referral codes: own or admin read" on public.referral_codes;
create policy "Referral codes: own or admin read"
  on public.referral_codes for select
  using (user_id = auth.uid() or public.viewer_is_admin());

grant select on public.referral_codes to authenticated;
grant select, insert, update, delete on public.referral_codes to service_role;

create or replace function public.my_referral_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_try int := 0;
begin
  if v_uid is null then
    return null;
  end if;
  select code into v_code from public.referral_codes where user_id = v_uid;
  if v_code is not null then
    return v_code;
  end if;
  loop
    v_try := v_try + 1;
    begin
      insert into public.referral_codes (user_id, code)
      values (v_uid, substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
      on conflict (user_id) do nothing;
      exit;
    exception when unique_violation then
      -- The CODE collided (one in four billion): mint another.
      if v_try >= 5 then
        raise;
      end if;
    end;
  end loop;
  select code into v_code from public.referral_codes where user_id = v_uid;
  return v_code;
end;
$$;

revoke all on function public.my_referral_code() from public, anon;
grant execute on function public.my_referral_code() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Referrals
-- ---------------------------------------------------------------------------
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  referee_id uuid not null unique references public.profiles (id) on delete cascade,
  code text not null,
  status text not null default 'signed_up'
    check (status in ('signed_up', 'first_card', 'rewarded', 'capped', 'blocked', 'expired')),
  block_reason text
    check (block_reason is null or block_reason in (
      'same_email', 'same_card', 'same_domain', 'disposable_email', 'not_new'
    )),
  signed_up_at timestamptz not null default now(),
  first_card_at timestamptz,
  rewarded_at timestamptz,
  -- What each side got: 'comp_month' (a month of Plus on the profile),
  -- 'balance_credit' (one month's price on the Stripe customer), 'none'.
  referrer_reward text check (referrer_reward is null or referrer_reward in ('comp_month', 'balance_credit', 'none')),
  referee_reward text check (referee_reward is null or referee_reward in ('comp_month', 'balance_credit', 'none')),
  referrer_reward_detail jsonb not null default '{}'::jsonb,
  referee_reward_detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (referrer_id <> referee_id)
);

create index if not exists referrals_referrer_idx
  on public.referrals (referrer_id, signed_up_at desc);
create index if not exists referrals_rewarded_idx
  on public.referrals (referrer_id, rewarded_at)
  where status = 'rewarded';
create index if not exists referrals_signed_up_idx
  on public.referrals (signed_up_at desc);

alter table public.referrals enable row level security;

drop policy if exists "Referrals: own or admin read" on public.referrals;
create policy "Referrals: own or admin read"
  on public.referrals for select
  using (referrer_id = auth.uid() or referee_id = auth.uid() or public.viewer_is_admin());

-- Column grant: a signed-in user reads the status columns, never
-- block_reason or the reward details (admins read those through
-- admin_referral_stats(), SECURITY DEFINER). The app selects explicit
-- columns (lib/referrals/queries.ts) — `select *` is refused by design.
revoke all on public.referrals from anon, authenticated;
grant select (id, referrer_id, referee_id, status, signed_up_at, first_card_at,
              rewarded_at, referrer_reward, referee_reward)
  on public.referrals to authenticated;
grant select, insert, update, delete on public.referrals to service_role;

-- ---------------------------------------------------------------------------
-- 3. The atomic step: caps
-- ---------------------------------------------------------------------------
create or replace function public.claim_referral_reward(
  p_referral_id uuid,
  p_monthly_cap int,
  p_lifetime_cap int
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.referrals%rowtype;
  v_month int;
  v_life int;
  v_outcome text;
begin
  if p_monthly_cap is null or p_monthly_cap < 0 or p_lifetime_cap is null or p_lifetime_cap < 0 then
    raise exception 'claim_referral_reward: caps must be non-negative';
  end if;
  select * into v_row from public.referrals where id = p_referral_id;
  if not found then
    return null;
  end if;
  -- One referrer at a time (hashtext of the id; 0153's lock namespace 153).
  perform pg_advisory_xact_lock(153, hashtext(v_row.referrer_id::text));
  -- Re-read under the lock: only a first_card row moves, once.
  select * into v_row from public.referrals where id = p_referral_id for update;
  if v_row.status <> 'first_card' then
    return null;
  end if;

  select
    count(*) filter (where rewarded_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'),
    count(*)
  into v_month, v_life
  from public.referrals
  where referrer_id = v_row.referrer_id
    and status = 'rewarded';

  v_outcome := case
    when v_month >= p_monthly_cap or v_life >= p_lifetime_cap then 'capped'
    else 'rewarded'
  end;

  update public.referrals
  set status = v_outcome,
      rewarded_at = now()
  where id = p_referral_id;
  return v_outcome;
end;
$$;

revoke all on function public.claim_referral_reward(uuid, int, int) from public, anon, authenticated;
grant execute on function public.claim_referral_reward(uuid, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Admin stats (next to the Funnel panel): conversions in the window, months
-- granted, top referrers. SECURITY DEFINER, admins only.
-- ---------------------------------------------------------------------------
create or replace function public.admin_referral_stats(p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not public.viewer_is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin_referral_stats: admins only' using errcode = '42501';
  end if;
  with w as (
    select * from public.referrals where signed_up_at >= p_since
  ),
  months as (
    select
      count(*) filter (where referrer_reward in ('comp_month', 'balance_credit'))
      + count(*) filter (where referee_reward in ('comp_month', 'balance_credit')) as n
    from public.referrals
    where rewarded_at >= p_since
  ),
  top as (
    select
      r.referrer_id,
      p.username,
      count(*) as referrals,
      count(*) filter (where r.first_card_at is not null) as activated,
      count(*) filter (where r.status = 'rewarded') as rewarded,
      count(*) filter (where r.referrer_reward in ('comp_month', 'balance_credit')) as months
    from public.referrals r
    left join public.profiles p on p.id = r.referrer_id
    where r.signed_up_at >= p_since
    group by r.referrer_id, p.username
    order by count(*) filter (where r.status = 'rewarded') desc, count(*) desc
    limit 10
  )
  select jsonb_build_object(
    'signedUp', (select count(*) from w),
    'firstCard', (select count(*) from w where first_card_at is not null),
    'rewarded', (select count(*) from w where status = 'rewarded'),
    'capped', (select count(*) from w where status = 'capped'),
    'blocked', (select count(*) from w where status = 'blocked'),
    'expired', (select count(*) from w where status = 'expired'),
    'blockReasons', coalesce((
      select jsonb_object_agg(block_reason, n)
      from (select block_reason, count(*) as n from w where status = 'blocked' group by block_reason) b
    ), '{}'::jsonb),
    'monthsGranted', (select n from months),
    'topReferrers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', referrer_id, 'username', username, 'referrals', referrals,
        'activated', activated, 'rewarded', rewarded, 'months', months))
      from top
    ), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.admin_referral_stats(timestamptz) from public, anon;
grant execute on function public.admin_referral_stats(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Notification kinds (the list as of 0149 + the two new ones)
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
      'deck_like', 'deck_card_added',
      'referral_signup', 'referral_reward'
    )
  );

-- One reward notification per referral and side (a retried reward step
-- must not toast twice).
create unique index if not exists notifications_referral_reward_once_idx
  on public.notifications (recipient_id, (payload ->> 'referralId'))
  where type = 'referral_reward';
create unique index if not exists notifications_referral_signup_once_idx
  on public.notifications (recipient_id, (payload ->> 'referralId'))
  where type = 'referral_signup';

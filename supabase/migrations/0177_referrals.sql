-- 0177_referrals.sql — a double-sided referral program (2026-10-30; reworked
-- 2026-11-02 after the independent check, and 2026-11-06 onto the free-days
-- mechanism — owner decisions 2026-11-05; docs/BILLING.md "Referrals").
--
-- A friend who joins through a referral link and saves a FIRST card rewards
-- both sides. WHAT each side gets is a SETTING (site_settings key
-- `referrals`, lib/referrals/settings.ts): free 30 days of a tier through
-- lib/billing/free-days.ts — the ONE mechanism comps use (0176: added to a
-- paying plan's time, the perks overlay otherwise), or AI credits, or
-- nothing; an admin switch pauses the program. Nothing here moves money.
--
-- 1. referral_codes — one code per user, minted on first ask by
--    my_referral_code() (8 hex characters; the link is /?ref=<code>).
-- 2. referrals — one row per REFEREE: who referred them, and where it stands:
--    signed_up → first_card → rewarded | capped | blocked | expired. The
--    reward each side got is `referrer_reward` / `referee_reward`
--    ('free_days', 'credits', 'none'; NULL = still owed — the hourly sweep
--    retries) with its detail. The friend's account going away SETS NULL:
--    the row is the referrer's cap evidence.
-- 2b. One email, one referral reward — ever: a KEYED hash of each referred
--    email (no address, no user id) that outlives the account.
-- 3. claim_referral_reward(id, monthly_cap, lifetime_cap, friends_cap,
--    block_reason) — the caps, atomic under the referrer's lock; the friends
--    cap caps the FRIEND's reward too (N confirmable inboxes must not mint
--    N rewards), and a referrer-only block (same_domain) goes through it as
--    well, so those friends count toward the cap.
-- 4. plan_grants.reference — a caller's own key per grant (the referral's
--    `referral:<id>:<side>`), unique, so a retried reward never grants twice.
-- 5. The referral settings row (defaults; an admin edits it in /admin/users).
-- 6. The notification kinds 'referral_signup' / 'referral_reward' (0174's
--    list plus those two), once per referral and side.
--
-- Grants are explicit (0097). Idempotent. Ships through a PR; never
-- applied ad-hoc.

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

-- Revoke first (an old project auto-grants new tables to the API roles),
-- then exactly what is used: a user reads their own code (RLS); only
-- my_referral_code() (security definer) and the service role write.
revoke all on public.referral_codes from public, anon, authenticated;
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

revoke all on function public.my_referral_code() from public, anon, authenticated;
grant execute on function public.my_referral_code() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Referrals
-- ---------------------------------------------------------------------------
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  -- SET NULL, never cascade: the row is the referrer's cap evidence.
  referee_id uuid unique references public.profiles (id) on delete set null,
  code text not null,
  status text not null default 'signed_up'
    check (status in ('signed_up', 'first_card', 'rewarded', 'capped', 'blocked', 'expired')),
  block_reason text
    check (block_reason is null or block_reason in (
      'same_email', 'same_card', 'same_domain', 'disposable_email', 'not_new', 'account_deleted',
      'email_reused'
    )),
  signed_up_at timestamptz not null default now(),
  first_card_at timestamptz,
  rewarded_at timestamptz,
  -- What each side got: 'free_days' (a plan_grants row, lib/billing/free-days.ts),
  -- 'credits' (one grant_credits call), 'none'. NULL = not decided yet (the
  -- sweep retries).
  referrer_reward text check (referrer_reward is null or referrer_reward in ('free_days', 'credits', 'none')),
  referee_reward text check (referee_reward is null or referee_reward in ('free_days', 'credits', 'none')),
  referrer_reward_detail jsonb not null default '{}'::jsonb,
  referee_reward_detail jsonb not null default '{}'::jsonb,
  -- Failed grant attempts (the retry sweep gives up past the app's limit
  -- and records 'none' with the reason, for an admin to see).
  grant_attempts int not null default 0 check (grant_attempts >= 0),
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
-- The retry sweep's two reads: qualified rows not yet claimed, and claimed
-- rows with a side still owed.
create index if not exists referrals_sweep_idx
  on public.referrals (first_card_at)
  where status = 'first_card'
     or (status in ('rewarded', 'capped', 'blocked')
         and (referrer_reward is null or referee_reward is null));

alter table public.referrals enable row level security;

drop policy if exists "Referrals: own or admin read" on public.referrals;
create policy "Referrals: own or admin read"
  on public.referrals for select
  using (referrer_id = auth.uid() or referee_id = auth.uid() or public.viewer_is_admin());

-- Column grant: a signed-in user reads the status columns, never
-- block_reason or the reward details (admins read those through
-- admin_referral_stats(), SECURITY DEFINER). The app selects explicit
-- columns (lib/referrals/queries.ts) — `select *` is refused by design.
revoke all on public.referrals from public, anon, authenticated;
grant select (id, referrer_id, referee_id, status, signed_up_at, first_card_at,
              rewarded_at, referrer_reward, referee_reward)
  on public.referrals to authenticated;
grant select, insert, update, delete on public.referrals to service_role;

-- ---------------------------------------------------------------------------
-- 2b. One email, one referral reward
-- ---------------------------------------------------------------------------
-- A keyed hash of each referred account's normalized email, written when the
-- referral signup is recorded (and again at the reward step if the email
-- changed). The FIRST referral that saw a fingerprint keeps it
-- (referral_id; SET NULL if that row goes, the fingerprint stays). No user
-- id, no address.
create table if not exists public.referral_email_fingerprints (
  fingerprint text primary key check (fingerprint ~ '^[0-9a-f]{64}$'),
  referral_id uuid references public.referrals (id) on delete set null,
  first_seen_at timestamptz not null default now()
);

alter table public.referral_email_fingerprints enable row level security;
-- No policy: no API role reads or writes it.
revoke all on public.referral_email_fingerprints from public, anon, authenticated;
grant select, insert, update, delete on public.referral_email_fingerprints to service_role;

-- The SQL twin of lib/referrals/fraud.ts normalizeReferralEmail — the same
-- table of cases holds both (tests/unit/referrals/email-normalization-cases.json:
-- the unit test runs the TypeScript, tests/e2e/referral-email-normalization
-- .spec.ts this function on the local stack).
create or replace function public.normalize_referral_email(p_email text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := lower(btrim(coalesce(p_email, ''), E' \t\r\n'));
  v_at int;
  v_local text;
  v_domain text;
begin
  -- The LAST "@" splits local part and domain.
  v_at := length(v) - position('@' in reverse(v)) + 1;
  if position('@' in v) = 0 or v_at < 2 then
    return null;
  end if;
  v_local := substr(v, 1, v_at - 1);
  v_domain := substr(v, v_at + 1);
  -- Everything from the first "+" to the "@" goes (every domain).
  v_local := split_part(v_local, '+', 1);
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  if v_local = '' then
    return null;
  end if;
  return v_local || '@' || v_domain;
end;
$$;

revoke all on function public.normalize_referral_email(text) from public, anon, authenticated;
grant execute on function public.normalize_referral_email(text) to service_role;

-- (a) Is this normalized email any OTHER live account's? auth.users is read
-- here (security definer) so the app never lists addresses. A soft-deleted
-- account (deleted_at) is not live.
create or replace function public.referral_email_in_use(p_user_id uuid, p_normalized text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_normalized is not null and exists (
    select 1
    from auth.users u
    where u.id <> p_user_id
      and u.deleted_at is null
      and public.normalize_referral_email(u.email) = p_normalized
  );
$$;

revoke all on function public.referral_email_in_use(uuid, text) from public, anon, authenticated;
grant execute on function public.referral_email_in_use(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The caps (atomic)
-- ---------------------------------------------------------------------------
-- Returns 'rewarded', 'capped_month', 'capped_lifetime', 'capped_friends',
-- 'blocked', or NULL when the row isn't a first_card row (already claimed,
-- or unknown). The status written is 'rewarded', 'capped' or (with
-- p_block_reason — a referrer-only block such as same_domain) 'blocked'.
-- capped_friends (the referrer brought p_friends_cap friends a reward this
-- month already): the FRIEND's side is 'none' too — the other outcomes
-- leave the friend theirs.
create or replace function public.claim_referral_reward(
  p_referral_id uuid,
  p_monthly_cap int,
  p_lifetime_cap int,
  p_friends_cap int default null,
  p_block_reason text default null
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
  v_friends int;
  v_outcome text;
begin
  if p_monthly_cap is null or p_monthly_cap < 0 or p_lifetime_cap is null or p_lifetime_cap < 0
     or (p_friends_cap is not null and p_friends_cap < 0) then
    raise exception 'claim_referral_reward: caps must be non-negative';
  end if;
  select * into v_row from public.referrals where id = p_referral_id;
  if not found then
    return null;
  end if;
  -- One referrer at a time (the named namespace, the referrer's id).
  perform pg_advisory_xact_lock(hashtext('pipglyph.referrals'), hashtext(v_row.referrer_id::text));
  -- Re-read under the lock: only a first_card row moves, once.
  select * into v_row from public.referrals where id = p_referral_id for update;
  if v_row.status <> 'first_card' then
    return null;
  end if;

  -- Every rewarded row of this referrer counts — whether or not its friend's
  -- account still exists (referee_id is SET NULL on delete, never cascaded).
  select
    count(*) filter (where rewarded_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'),
    count(*)
  into v_month, v_life
  from public.referrals
  where referrer_id = v_row.referrer_id
    and status = 'rewarded';

  -- Friends this referrer brought a reward to this month (rewarded, capped
  -- or referrer-blocked rows alike — each still rewarded the friend).
  select count(*) into v_friends
  from public.referrals
  where referrer_id = v_row.referrer_id
    and status in ('rewarded', 'capped', 'blocked')
    and referee_reward is distinct from 'none'
    and rewarded_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';

  v_outcome := case
    when p_friends_cap is not null and v_friends >= p_friends_cap then 'capped_friends'
    when p_block_reason is not null then 'blocked'
    when v_life >= p_lifetime_cap then 'capped_lifetime'
    when v_month >= p_monthly_cap then 'capped_month'
    else 'rewarded'
  end;

  update public.referrals
  set status = case when v_outcome = 'rewarded' then 'rewarded' when v_outcome = 'blocked' then 'blocked' else 'capped' end,
      block_reason = case when v_outcome = 'blocked' then p_block_reason else block_reason end,
      rewarded_at = now(),
      referrer_reward = case when v_outcome = 'rewarded' then null else 'none' end,
      referrer_reward_detail = case
        when v_outcome = 'rewarded' then referrer_reward_detail
        when v_outcome = 'blocked' then jsonb_build_object('kind', 'none', 'reason', p_block_reason)
        else jsonb_build_object('kind', 'none', 'reason', v_outcome)
      end,
      referee_reward = case when v_outcome = 'capped_friends' then 'none' else referee_reward end,
      referee_reward_detail = case
        when v_outcome = 'capped_friends' then jsonb_build_object('kind', 'none', 'reason', v_outcome)
        else referee_reward_detail
      end
  where id = p_referral_id;
  return v_outcome;
end;
$$;

drop function if exists public.claim_referral_reward(uuid, int, int);
drop function if exists public.claim_referral_reward(uuid, int, int, int);
revoke all on function public.claim_referral_reward(uuid, int, int, int, text) from public, anon, authenticated;
grant execute on function public.claim_referral_reward(uuid, int, int, int, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. A caller's own key on a free-days grant (0176's plan_grants)
-- ---------------------------------------------------------------------------
-- `referral:<id>:<side>` — unique, so a reward retried after a crash finds
-- the grant it already made (lib/billing/free-days-apply.ts answers
-- duplicate_reference) instead of adding the days twice.
alter table public.plan_grants add column if not exists reference text check (reference is null or char_length(reference) <= 120);
create unique index if not exists plan_grants_reference_idx on public.plan_grants (reference) where reference is not null;

-- ---------------------------------------------------------------------------
-- 5. The settings row (lib/referrals/settings.ts holds the shape and the defaults)
-- ---------------------------------------------------------------------------
insert into public.site_settings (key, value)
  values ('referrals', '{"enabled": true, "friend": {"kind": "free_days", "tier": "plus", "units": 1}, "referrer": {"kind": "free_days", "tier": "own", "units": 1}, "caps": {"perMonth": 3, "lifetime": 12, "friendsPerMonth": 5}}'::jsonb)
  on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Admin stats (next to the Funnel panel): conversions in the window, rewards
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
  rewards as (
    select
      count(*) filter (where referrer_reward in ('free_days', 'credits'))
      + count(*) filter (where referee_reward in ('free_days', 'credits')) as n
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
      count(*) filter (where r.referrer_reward in ('free_days', 'credits')) as rewards
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
    -- Qualified but not yet claimed (an email not confirmed yet), and
    -- claimed with a side still owed (a grant to retry).
    'waiting', (select count(*) from w where status = 'first_card'),
    'grantsOwed', (
      select count(*) from public.referrals
      where status in ('rewarded', 'capped', 'blocked')
        and (referrer_reward is null or referee_reward is null)
    ),
    'blockReasons', coalesce((
      select jsonb_object_agg(block_reason, n)
      from (select block_reason, count(*) as n from w where status = 'blocked' group by block_reason) b
    ), '{}'::jsonb),
    'rewardsGranted', (select n from rewards),
    'topReferrers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', referrer_id, 'username', username, 'referrals', referrals,
        'activated', activated, 'rewarded', rewarded, 'rewards', rewards))
      from top
    ), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.admin_referral_stats(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_referral_stats(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Notification kinds
-- ---------------------------------------------------------------------------
-- REFERRAL KINDS (added by this migration): 'referral_signup',
-- 'referral_reward'. The list below is 0174's (the last to redefine it) plus
-- those two. A migration merged after this one that redefines
-- notifications_type_check must keep them:
-- tests/unit/db/referrals-migration.test.ts names them.
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
      -- REFERRAL KINDS
      'referral_signup', 'referral_reward'
    )
  );

-- One notification per referral and side (a retried step must not toast
-- twice). referral_signup goes to the referrer only when the friend
-- qualified and the referrer earned NO reward (a cap, not eligible).
create unique index if not exists notifications_referral_reward_once_idx
  on public.notifications (recipient_id, (payload ->> 'referralId'))
  where type = 'referral_reward';
create unique index if not exists notifications_referral_signup_once_idx
  on public.notifications (recipient_id, (payload ->> 'referralId'))
  where type = 'referral_signup';

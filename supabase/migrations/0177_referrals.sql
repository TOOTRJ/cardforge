-- 0164_referrals.sql — a double-sided referral program (2026-10-30; reworked
-- 2026-11-02 after the independent check and the owner's decisions).
-- Ships through a PR; never applied ad-hoc. The number may move at merge:
-- nothing in here (lock keys, names) and nothing in the app or its tests is
-- derived from it.
--
-- Every user gets a referral link (`/?ref=<code>`). A NEW account that signs
-- up through it — first-touch attribution, sessionStorage → hidden fields →
-- the signup action (no cookie) — and then SAVES ITS FIRST CARD with a
-- CONFIRMED email earns one free month for itself and one for the referrer
-- (lib/referrals/*: the rules, the fraud checks and the decision of HOW each
-- side gets its month live in the app; this file holds the rows, who may read
-- them, and every step that must be atomic: the caps and the Plus month).
--
-- 1. referral_codes — one code per user, minted on first ask by
--    my_referral_code() (the owner's own session; 8 lowercase hex chars from
--    gen_random_uuid, retried on the unique index). Read: the owner, admins.
--
-- 2. referrals — one row per REFEREE: who referred them, and where it stands:
--      signed_up   the account was created through the link
--      first_card  it saved its first card (qualified) and waits for the
--                  reward step — both emails confirmed (auth.users
--                  .email_confirmed_at), then the caps
--      rewarded    the referrer earned a month (each side's grant is
--                  recorded in referrer_reward / referee_reward; NULL = not
--                  granted yet — the retry sweep finishes it)
--      capped      the referrer was at a cap — the referee still gets theirs
--      blocked     a fraud rule or a deleted account (block_reason)
--      expired     no first card within 30 days of signup, or an email never
--                  confirmed within 30 days of the first card
--    referee_id is ON DELETE SET NULL (P1-a of the check): a deleted friend
--    must not take the evidence with it — the caps count the REFERRER's
--    rewarded rows, whoever they were for, so deleting a rewarded friend can
--    never open a fourth month in the same month.
--    Users read their own rows through a COLUMN grant that leaves out
--    block_reason and the reward details (Stripe amounts): the dashboard
--    shows a status, never a fraud signal. Admins read everything through
--    RLS + admin_referral_stats(). Writes: the service role only.
--
-- 3. profiles.referral_plus_until — a referral's free month of PLUS, kept
--    APART from the admin comp (comp_tier / comp_expires_at): an admin comp
--    edit can't wipe it (P3), it never moves a Stripe trial or posts a
--    balance credit, and the monthly refill never reads it — the month's AI
--    credits are granted ONCE, with the month (owner 2026-11-02: one Plus
--    allotment per referral month, never a second refill because the month
--    crosses a calendar month). Private and pinned like every billing column
--    (protect_billing_columns, get_my_billing below); the plan readers take
--    it as a Plus overlay: lib/billing/entitlements.ts and card_capacity_for.
--
-- 4. claim_referral_reward(id, monthly_cap, lifetime_cap) — service role.
--    Moves ONE first_card row to rewarded or capped under a per-referrer
--    advisory lock, so two friends activating at once can't both slip under
--    the monthly cap.
--
-- 5. grant_referral_plus_month(id, side, days, credits) — service role. The
--    Plus month and its credits in ONE transaction under a per-user lock
--    (P2: two rewards no longer read-modify-write the end date from the
--    app), idempotent per referral and side (a retry grants nothing twice).
--
-- 6. One email, one referral month — ever (owner 2026-11-02). A referral is
--    NOT eligible (block_reason 'email_reused', neither side rewarded, the
--    friend never told why) when the friend's NORMALIZED email
--    (normalize_referral_email: lowercase, no "+tag", Gmail's dots off and
--    googlemail.com as gmail.com — the twin of lib/referrals/fraud.ts
--    normalizeReferralEmail) is
--      (a) the normalized email of ANY OTHER live account
--          (referral_email_in_use, reads auth.users), or
--      (b) already in referral_email_fingerprints from an EARLIER referral
--          signup. That table keeps a KEYED HASH (HMAC-SHA256 under the
--          server-only REFERRAL_EMAIL_HASH_KEY, computed by the app) — never
--          the address — and no user id: deleting a referred account leaves
--          its fingerprint, so the same inbox can't earn a month again
--          through a new account. Service role only.
--
-- 7. Notification kinds — see the REFERRAL KINDS block at the end.
--
-- Grants are stated, revoke first (every migration states its grants —
-- CLAUDE.md; 0097).

-- Advisory-lock namespace: a NAME, hashed — never the migration number.
-- Every function below locks with hashtext('pipglyph.referrals').

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
  -- What each side got: 'plus_month' (profiles.referral_plus_until + one
  -- Plus allotment of credits), 'balance_credit' (one month's price on the
  -- Stripe customer), 'none'. NULL = not decided yet (the sweep retries).
  referrer_reward text check (referrer_reward is null or referrer_reward in ('plus_month', 'balance_credit', 'none')),
  referee_reward text check (referee_reward is null or referee_reward in ('plus_month', 'balance_credit', 'none')),
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
-- 2b. One email, one referral month
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
-- 3. The referral month of Plus on the profile
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists referral_plus_until timestamptz;

comment on column public.profiles.referral_plus_until is
  'End of the free month(s) of Plus earned through referrals (0164). A Plus overlay apart from the admin comp: the higher of subscription, comp and this applies. Never read by the monthly credit refill — each referral month grants its credits once (grant_referral_plus_month). Written only by grant_referral_plus_month (service role).';

-- No column grant: like every billing column it is private (0074's column
-- list doesn't name it); the owner reads it through get_my_billing().

-- The column-pinning trigger, with the new column. Body carried forward from
-- 0135 (the latest definition).
create or replace function public.protect_billing_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.stripe_customer_id := null;
    new.subscription_tier := 'free';
    new.subscription_status := null;
    new.stripe_subscription_id := null;
    new.current_period_end := null;
    new.cancel_at_period_end := false;
    new.subscription_ends_at := null;
    new.subscription_canceled_at := null;
    new.credits := 5;
    new.is_admin := false;
    new.featured_at := null;
    new.comp_tier := null;
    new.comp_expires_at := null;
    new.card_limit_override := null;
    new.referral_plus_until := null;
  else
    new.stripe_customer_id := old.stripe_customer_id;
    new.subscription_tier := old.subscription_tier;
    new.subscription_status := old.subscription_status;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.current_period_end := old.current_period_end;
    new.cancel_at_period_end := old.cancel_at_period_end;
    new.subscription_ends_at := old.subscription_ends_at;
    new.subscription_canceled_at := old.subscription_canceled_at;
    new.credits := old.credits;
    new.is_admin := old.is_admin;
    new.featured_at := old.featured_at;
    new.comp_tier := old.comp_tier;
    new.comp_expires_at := old.comp_expires_at;
    new.card_limit_override := old.card_limit_override;
    new.referral_plus_until := old.referral_plus_until;
  end if;
  return new;
end;
$function$;

-- Grants: unchanged. `create or replace` keeps the function's existing ACL
-- (0097 states it), and a trigger function is not called through the API.

-- The user's own billing slice, with the new column (0135's body + one
-- column). The return type changes, so the function is dropped and
-- re-created (the migration runs in one transaction).
drop function if exists public.get_my_billing();

create function public.get_my_billing()
returns table (
  subscription_tier text,
  subscription_status text,
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  credits integer,
  comp_tier text,
  comp_expires_at timestamptz,
  card_limit_override integer,
  is_admin boolean,
  subscription_ends_at timestamptz,
  subscription_canceled_at timestamptz,
  referral_plus_until timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.subscription_tier, p.subscription_status, p.stripe_customer_id,
    p.stripe_subscription_id, p.current_period_end, p.cancel_at_period_end,
    p.credits, p.comp_tier, p.comp_expires_at, p.card_limit_override,
    p.is_admin, p.subscription_ends_at, p.subscription_canceled_at,
    p.referral_plus_until
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke all on function public.get_my_billing() from public, anon, authenticated;
grant execute on function public.get_my_billing() to authenticated, service_role;

-- The saved-card cap: 0104's body with the referral month as one more Plus
-- source (the higher of subscription, comp and referral month). Mirrors
-- lib/billing/entitlements.ts effectiveTierForProfile.
create or replace function public.card_capacity_for(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select
      is_admin,
      card_limit_override,
      case
        when subscription_tier in ('plus', 'pro')
         and subscription_status in ('active', 'trialing') then subscription_tier
        else 'free'
      end as subscribed,
      case
        when comp_tier = 'pro'
         and (comp_expires_at is null or comp_expires_at > now()) then 'pro'
        when (comp_tier = 'plus' and (comp_expires_at is null or comp_expires_at > now()))
          or referral_plus_until > now() then 'plus'
        else null
      end as overlay
    from public.profiles
    where id = p_user_id
  ),
  ranked as (
    select
      is_admin,
      card_limit_override,
      case
        when overlay is not null
         and (case overlay when 'pro' then 2 when 'plus' then 1 else 0 end)
           > (case subscribed when 'pro' then 2 when 'plus' then 1 else 0 end)
        then overlay
        else subscribed
      end as tier
    from p
  )
  select case
    when is_admin then -1
    when tier = 'pro' then -1
    when tier = 'plus' then greatest(500, coalesce(card_limit_override, 0))
    else greatest(50, coalesce(card_limit_override, 0))
  end
  from ranked;
$$;

comment on function public.card_capacity_for(uuid) is
  'Saved-card cap for a user (-1 = unlimited). Mirrors lib/billing/entitlements.ts (subscription, admin comp, referral month of Plus — the higher); keep in sync.';

revoke all on function public.card_capacity_for(uuid) from public, anon, authenticated;
grant execute on function public.card_capacity_for(uuid) to service_role;

-- The owner's paid stamp on a DOWNLOAD (the custom footer text): 0074's body
-- with the referral month as one more paid source.
create or replace function public.owner_export_stamp(p_owner_id uuid)
returns table (paid boolean, footer_text text)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(p.is_admin, false)
      or (p.subscription_tier in ('plus', 'pro')
          and p.subscription_status in ('active', 'trialing'))
      or (p.comp_tier in ('plus', 'pro')
          and (p.comp_expires_at is null or p.comp_expires_at > now()))
      or coalesce(p.referral_plus_until > now(), false)
      as paid,
    nullif(btrim(p.export_watermark_text), '') as footer_text
  from public.profiles p
  where p.id = p_owner_id;
$$;

revoke all on function public.owner_export_stamp(uuid) from public, anon, authenticated;
grant execute on function public.owner_export_stamp(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The caps (atomic)
-- ---------------------------------------------------------------------------
-- Returns 'rewarded', 'capped_month', 'capped_lifetime', or NULL when the row
-- isn't a first_card row (already claimed, or unknown). The status written is
-- 'rewarded' or 'capped'.
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

  v_outcome := case
    when v_life >= p_lifetime_cap then 'capped_lifetime'
    when v_month >= p_monthly_cap then 'capped_month'
    else 'rewarded'
  end;

  update public.referrals
  set status = case when v_outcome = 'rewarded' then 'rewarded' else 'capped' end,
      rewarded_at = now(),
      referrer_reward = case when v_outcome = 'rewarded' then null else 'none' end,
      referrer_reward_detail = case
        when v_outcome = 'rewarded' then referrer_reward_detail
        else jsonb_build_object('kind', 'none', 'reason', v_outcome)
      end
  where id = p_referral_id;
  return v_outcome;
end;
$$;

revoke all on function public.claim_referral_reward(uuid, int, int) from public, anon, authenticated;
grant execute on function public.claim_referral_reward(uuid, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. One side's month of Plus + its credits (atomic, idempotent)
-- ---------------------------------------------------------------------------
-- The month starts where what the user already has ends: the later of now,
-- a running referral month, an unexpired admin comp with an end date, and a
-- live plan that is set to stop. p_credits is the Plus allotment
-- (lib/billing/plans.ts MONTHLY_CREDITS.plus — the app passes it, one
-- source), granted through grant_credits under the key
-- 'referral:<id>:<side>' in the same transaction. Returns the side's detail,
-- or NULL when the row has no such user (a deleted friend). A side already
-- decided returns its stored detail untouched.
create or replace function public.grant_referral_plus_month(
  p_referral_id uuid,
  p_side text,
  p_days int,
  p_credits int
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.referrals%rowtype;
  v_user uuid;
  v_profile public.profiles%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_detail jsonb;
begin
  if p_side not in ('referrer', 'referee') then
    raise exception 'grant_referral_plus_month: side must be referrer or referee';
  end if;
  if p_days is null or p_days <= 0 or p_credits is null or p_credits < 0 then
    raise exception 'grant_referral_plus_month: days must be positive, credits non-negative';
  end if;
  select * into v_row from public.referrals where id = p_referral_id;
  if not found then
    return null;
  end if;
  v_user := case p_side when 'referrer' then v_row.referrer_id else v_row.referee_id end;
  if v_user is null then
    return null;
  end if;
  -- One user at a time: two rewards for the same person (two friends, or a
  -- user who is a referrer and a referee) never read the same end date.
  perform pg_advisory_xact_lock(hashtext('pipglyph.referrals'), hashtext(v_user::text));
  select * into v_row from public.referrals where id = p_referral_id for update;
  if (p_side = 'referrer' and v_row.referrer_reward is not null)
     or (p_side = 'referee' and v_row.referee_reward is not null) then
    return case p_side when 'referrer' then v_row.referrer_reward_detail else v_row.referee_reward_detail end;
  end if;

  select * into v_profile from public.profiles where id = v_user for update;
  if not found then
    return null;
  end if;

  v_start := greatest(
    now(),
    coalesce(v_profile.referral_plus_until, now()),
    case
      when v_profile.comp_tier in ('plus', 'pro') and v_profile.comp_expires_at > now()
        then v_profile.comp_expires_at
      else now()
    end,
    case
      when v_profile.subscription_tier in ('plus', 'pro')
       and v_profile.subscription_status in ('active', 'trialing')
       and v_profile.subscription_ends_at > now()
        then v_profile.subscription_ends_at
      else now()
    end
  );
  v_end := v_start + make_interval(days => p_days);

  update public.profiles set referral_plus_until = v_end where id = v_user;

  if p_credits > 0 then
    perform public.grant_credits(
      v_user, p_credits, 'referral_month', 'referral:' || p_referral_id::text || ':' || p_side
    );
  end if;

  v_detail := jsonb_build_object(
    'kind', 'plus_month', 'tier', 'plus',
    'startsAt', v_start, 'expiresAt', v_end, 'credits', p_credits
  );
  if p_side = 'referrer' then
    update public.referrals
    set referrer_reward = 'plus_month', referrer_reward_detail = v_detail
    where id = p_referral_id;
  else
    update public.referrals
    set referee_reward = 'plus_month', referee_reward_detail = v_detail
    where id = p_referral_id;
  end if;
  return v_detail;
end;
$$;

revoke all on function public.grant_referral_plus_month(uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.grant_referral_plus_month(uuid, text, int, int) to service_role;

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
      count(*) filter (where referrer_reward in ('plus_month', 'balance_credit'))
      + count(*) filter (where referee_reward in ('plus_month', 'balance_credit')) as n
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
      count(*) filter (where r.referrer_reward in ('plus_month', 'balance_credit')) as months
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

revoke all on function public.admin_referral_stats(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_referral_stats(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Notification kinds
-- ---------------------------------------------------------------------------
-- REFERRAL KINDS (added by this migration): 'referral_signup',
-- 'referral_reward'. The list below is 0161's plus those two. A migration
-- merged after this one that redefines notifications_type_check must keep
-- them (and this one, renumbered after another, must take that one's kinds):
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
      -- REFERRAL KINDS
      'referral_signup', 'referral_reward'
    )
  );

-- One notification per referral and side (a retried step must not toast
-- twice). referral_signup goes to the referrer only when the friend
-- qualified and the referrer earned NO month (a cap, not eligible).
create unique index if not exists notifications_referral_reward_once_idx
  on public.notifications (recipient_id, (payload ->> 'referralId'))
  where type = 'referral_reward';
create unique index if not exists notifications_referral_signup_once_idx
  on public.notifications (recipient_id, (payload ->> 'referralId'))
  where type = 'referral_signup';

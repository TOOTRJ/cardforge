-- 0181_billing_leftovers.sql — the three small leftovers of the billing audit
-- (owner 2026-11-06, after the one-time credits shipped in #773):
--
-- 1. `profiles.subscription_held_from` ('active' | 'trialing' | NULL): what a
--    free-days HOLD was added to, copied from the subscription's
--    `pipglyph_hold_from` metadata by the Stripe sync. A PAYING plan under a
--    hold reads `trialing` on Stripe, so every page that names the plan from
--    the profile row alone (the dashboard notice, Settings, the header menu,
--    /api/me, the admin directory — lib/billing/plan-ending.ts) called its
--    cancellation "a cancelled trial … you won't be charged". The column lets
--    those readers tell a held payer from a trial without a Stripe call.
--    Written only by the sync (service role); pinned by the billing trigger;
--    returned to its owner by get_my_billing() and to admins by
--    admin_list_users(). Not on 0074's public column list.
--
-- 2. grant_plan_credits_once() — the one-time plan credits (#773,
--    lib/billing/credit-refill.ts) judged and granted in ONE statement under
--    the user's row lock. The app did it in two: read the account's
--    `plan-once:<user>:%` rows, then grant the difference — so two DIFFERENT
--    tiers' paid invoices handled in the same second (a Pro upgrade seconds
--    after the first Plus payment, delivered concurrently) could each read an
--    empty set and grant 60 + 120 instead of 120. The lock is the one
--    grant_credits() takes (0175), so the second caller waits and then sees
--    the first's row. Same key, same reason, same ledger row as before.
--
-- 3. admin_credit_grant_stats() — the admin "Credits granted" panel's totals
--    by reason, summed in SQL (the app paged every positive ledger row past
--    PostgREST's 1000-row cap and summed in JavaScript — fine today, a full
--    table read every admin page view as the ledger grows). The reason's
--    HEAD is the same the app grouped by: the text before the first ':',
--    trimmed and lower-cased ('admin_grant: <note>' → 'admin_grant'), empty
--    or NULL → 'other'. Service role only.

-- 1. subscription_held_from ---------------------------------------------------
alter table public.profiles
  add column if not exists subscription_held_from text
    check (subscription_held_from is null or subscription_held_from in ('active', 'trialing'));

comment on column public.profiles.subscription_held_from is
  'What the live subscription''s free-days hold was added to (its pipglyph_hold_from metadata): ''active'' = a PAYING plan that reads trialing on Stripe until the days end, ''trialing'' = a real trial the days were added to; NULL = no hold. Written only by the Stripe sync (service role). Read by lib/billing/plan-ending.ts.';

-- The pinning trigger, re-stated with the new column (body from 0175; the
-- earlier columns are repeated so no order of application drops a pin).
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
    new.payment_failed_at := null;
    new.billing_interval := null;
    new.subscription_held_from := null;
    new.credits := 5;
    new.is_admin := false;
    new.featured_at := null;
    new.comp_tier := null;
    new.comp_expires_at := null;
    new.card_limit_override := null;
  else
    new.stripe_customer_id := old.stripe_customer_id;
    new.subscription_tier := old.subscription_tier;
    new.subscription_status := old.subscription_status;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.current_period_end := old.current_period_end;
    new.cancel_at_period_end := old.cancel_at_period_end;
    new.subscription_ends_at := old.subscription_ends_at;
    new.subscription_canceled_at := old.subscription_canceled_at;
    new.payment_failed_at := old.payment_failed_at;
    new.billing_interval := old.billing_interval;
    new.subscription_held_from := old.subscription_held_from;
    new.credits := old.credits;
    new.is_admin := old.is_admin;
    new.featured_at := old.featured_at;
    new.comp_tier := old.comp_tier;
    new.comp_expires_at := old.comp_expires_at;
    new.card_limit_override := old.card_limit_override;
  end if;
  return new;
end;
$function$;
-- Grants unchanged: `create or replace` keeps the ACL (0097); a trigger
-- function is never called through the API.

-- 1b. get_my_billing — 0174's columns plus subscription_held_from.
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
  payment_failed_at timestamptz,
  subscription_held_from text
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
    p.payment_failed_at, p.subscription_held_from
  from public.profiles p
  where p.id = auth.uid();
$$;
revoke all on function public.get_my_billing() from public, anon, authenticated;
grant execute on function public.get_my_billing() to authenticated, service_role;

-- 1c. admin_list_users — 0135's body with subscription_held_from on the row,
-- so the directory's "cancelled, ends …" label can tell a held payer too.
drop function if exists public.admin_list_users(text, text, text, text, text, integer, integer);

create function public.admin_list_users(
  p_q text default null,
  p_tier text default null,
  p_status text default null,
  p_flag text default null,
  p_sort text default 'newest',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  email text,
  subscription_tier text,
  subscription_status text,
  comp_tier text,
  comp_expires_at timestamptz,
  credits integer,
  is_admin boolean,
  card_count bigint,
  deck_count bigint,
  created_at timestamptz,
  last_active_at timestamptz,
  total_count bigint,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  subscription_ends_at timestamptz,
  subscription_canceled_at timestamptz,
  subscription_held_from text
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      p.id,
      p.username,
      p.display_name,
      p.avatar_url,
      u.email::text as email,
      p.subscription_tier,
      p.subscription_status,
      p.comp_tier,
      p.comp_expires_at,
      p.credits,
      p.is_admin,
      p.created_at,
      p.current_period_end,
      p.cancel_at_period_end,
      p.subscription_ends_at,
      p.subscription_canceled_at,
      p.subscription_held_from,
      (select count(*) from public.cards c where c.owner_id = p.id) as card_count,
      (select count(*) from public.decks d where d.owner_id = p.id) as deck_count,
      greatest(
        p.updated_at,
        (select max(c.updated_at) from public.cards c where c.owner_id = p.id),
        (select max(d.updated_at) from public.decks d where d.owner_id = p.id),
        u.last_sign_in_at
      ) as last_active_at
    from public.profiles p
    left join auth.users u on u.id = p.id
    where
      (p_q is null or btrim(p_q) = '' or (
        p.username ilike '%' || btrim(p_q) || '%'
        or p.display_name ilike '%' || btrim(p_q) || '%'
        or u.email ilike btrim(p_q) || '%'
      ))
      and (p_tier is null or p_tier = '' or p.subscription_tier = p_tier)
      and (p_status is null or p_status = '' or coalesce(p.subscription_status, 'none') = p_status)
      and (
        p_flag is null or p_flag = ''
        or (p_flag = 'admins' and p.is_admin)
        or (p_flag = 'paid' and p.subscription_tier <> 'free'
            and p.subscription_status in ('active', 'trialing'))
        or (p_flag = 'comped' and p.comp_tier is not null
            and (p.comp_expires_at is null or p.comp_expires_at > now()))
        or (p_flag = 'mismatch' and p.subscription_tier = 'free'
            and p.subscription_status in ('active', 'trialing'))
        or (p_flag = 'ending' and p.subscription_status in ('active', 'trialing')
            and (p.subscription_ends_at is not null or p.cancel_at_period_end))
      )
  )
  select
    b.id, b.username, b.display_name, b.avatar_url, b.email,
    b.subscription_tier, b.subscription_status, b.comp_tier, b.comp_expires_at,
    b.credits, b.is_admin, b.card_count, b.deck_count, b.created_at,
    b.last_active_at,
    count(*) over () as total_count,
    b.current_period_end, b.cancel_at_period_end,
    b.subscription_ends_at, b.subscription_canceled_at,
    b.subscription_held_from
  from base b
  order by
    case when p_sort = 'oldest' then b.created_at end asc,
    case when p_sort = 'active' then b.last_active_at end desc nulls last,
    case when p_sort = 'cards' then b.card_count end desc,
    case when p_sort = 'credits' then b.credits end desc,
    b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.admin_list_users(text, text, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_list_users(text, text, text, text, text, integer, integer)
  to service_role;


-- 2. grant_plan_credits_once ----------------------------------------------------
-- The tier's one-time stock (p_target: PLAN_CREDITS_ONCE[tier] — the app's
-- number, never stored here) minus what the account's plan keys already
-- granted, any tier; the account+tier key itself present → 0. Judged under
-- the profile row's lock (the lock grant_credits() takes, 0175: NO KEY
-- UPDATE), so two tiers' invoices in the same second serialize and the
-- second sees the first's row. Returns the credits granted (0 = nothing).
create or replace function public.grant_plan_credits_once(
  p_user_id uuid,
  p_tier text,
  p_target integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := 'plan-once:' || p_user_id::text || ':' || p_tier;
  v_already integer;
  v_amount integer;
begin
  if p_tier is null or p_tier not in ('plus', 'pro') then
    raise exception 'grant_plan_credits_once: unknown tier %', p_tier
      using errcode = 'invalid_parameter_value';
  end if;
  if p_target is null or p_target <= 0 then
    return 0;
  end if;

  -- The lock first: the read below and grant_credits' own check both happen
  -- under it. A missing profile grants nothing.
  perform 1 from public.profiles where id = p_user_id for no key update;
  if not found then
    return 0;
  end if;

  if exists (select 1 from public.credit_ledger where idempotency_key = v_key) then
    return 0; -- this tier's stock was granted already (a retry, a resubscribe)
  end if;

  select coalesce(sum(l.delta), 0)
    into v_already
  from public.credit_ledger l
  where l.user_id = p_user_id
    and l.idempotency_key like 'plan-once:' || p_user_id::text || ':%';

  v_amount := p_target - v_already;
  if v_amount <= 0 then
    return 0; -- the account already holds this tier's stock (a downgrade)
  end if;

  perform public.grant_credits(p_user_id, v_amount, 'plan_credits_once', v_key);
  return v_amount;
end;
$$;
revoke all on function public.grant_plan_credits_once(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.grant_plan_credits_once(uuid, text, integer) to service_role;

-- 3. admin_credit_grant_stats --------------------------------------------------
-- Credits GRANTED (positive ledger rows) by the reason's head, largest
-- first, since p_since (NULL = all time). Service role only: the admin
-- page reads it through the admin client after its own is_admin check.
create or replace function public.admin_credit_grant_stats(p_since timestamptz default null)
returns table (reason text, credits bigint, grants bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(lower(btrim(split_part(l.reason, ':', 1))), ''), 'other') as reason,
    sum(l.delta)::bigint as credits,
    count(*)::bigint as grants
  from public.credit_ledger l
  where l.delta > 0
    and (p_since is null or l.created_at >= p_since)
  group by 1
  order by 2 desc, 1 asc;
$$;
revoke all on function public.admin_credit_grant_stats(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_credit_grant_stats(timestamptz) to service_role;

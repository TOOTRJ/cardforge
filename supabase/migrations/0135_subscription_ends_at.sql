-- 0135_subscription_ends_at.sql — when a cancelled subscription stops.
--
-- A subscriber who cancels keeps the plan until a date. The profile stored
-- only `cancel_at_period_end` (a boolean) + `current_period_end`, which says
-- nothing when the end date is NOT the stored period end (a cancellation
-- dated in a later period, a schedule that ends in a cancellation) — and the
-- pages that read the profile alone (the dashboard, Settings, the header, the
-- admin directory) had no date to show. Two columns, written by the ONE sync
-- (lib/stripe/subscription-sync.ts), both NULL for a plan that renews:
--
--   subscription_ends_at      the date the live subscription stops
--   subscription_canceled_at  when the cancellation was requested
--
-- Both are billing columns: private (not in 0074's column-level SELECT
-- grant, so anon / authenticated cannot read them from the table), pinned by
-- protect_billing_columns, returned to their owner by get_my_billing() and
-- to admins by admin_list_users() (service role only).
--
-- Existing ending subscribers get the values from the next Stripe event for
-- their subscription, or at once from /admin/users → "Resync from Stripe".
-- Until then the app falls back to `cancel_at_period_end` + the period end.
--
-- Idempotent. Grants are stated below (new projects do not auto-grant).

-- 1. Columns ---------------------------------------------------------------
alter table public.profiles
  add column if not exists subscription_ends_at timestamptz,
  add column if not exists subscription_canceled_at timestamptz;

comment on column public.profiles.subscription_ends_at is
  'When the live subscription is set to stop (Stripe cancel_at, the period or trial end under cancel_at_period_end, or a schedule ending in a cancellation). NULL = it renews, or there is no live subscription. Written only by the Stripe sync (service role).';
comment on column public.profiles.subscription_canceled_at is
  'When the pending cancellation was requested (Stripe canceled_at). NULL when the subscription is not set to stop.';

-- No table grant: 0074 replaced the blanket SELECT on profiles with a list
-- of public columns, and these two are deliberately not on it. The service
-- role keeps its table-level access (0097).

-- 2. The column-pinning trigger, with the two new columns ---------------------
-- Body carried forward from 0060 (the latest definition).
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
  end if;
  return new;
end;
$function$;

-- Grants: unchanged. `create or replace` keeps the function's existing ACL
-- (0097 states it), and a trigger function is not called through the API.

-- 3. The user's own billing slice, with the two new columns -------------------
-- The return type changes, so the function is dropped and re-created (the
-- migration runs in one transaction; callers never see it missing).
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
  subscription_canceled_at timestamptz
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
    p.is_admin, p.subscription_ends_at, p.subscription_canceled_at
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke all on function public.get_my_billing() from public, anon, authenticated;
grant execute on function public.get_my_billing() to authenticated, service_role;

-- 4. The admin directory: an ending plan is visible in the list ----------------
-- New return columns (period end, the flag, the end date) and one more
-- segment, `ending`: a live subscription that is set to stop. Body carried
-- forward from 0071.
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
  subscription_canceled_at timestamptz
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
    b.subscription_ends_at, b.subscription_canceled_at
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

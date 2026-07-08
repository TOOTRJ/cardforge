-- 0052_featured_profiles.sql — admin-curated featured creators.
--
-- featured_at doubles as the flag (null = not featured) and the ordering
-- (most recently featured leads the gallery/challenges banners). Writes go
-- through the service-role client gated on profiles.is_admin in app code.
-- Profiles stay world-readable; the column is PINNED in the same BEFORE
-- trigger that guards billing + is_admin (protect_billing_columns), so the
-- row-level self-update policy can't be used to self-feature via REST.

alter table public.profiles
  add column if not exists featured_at timestamptz;

create index if not exists profiles_featured_idx
  on public.profiles (featured_at desc)
  where featured_at is not null;

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
    new.credits := 5;
    new.is_admin := false;
    new.featured_at := null;
  else
    new.stripe_customer_id := old.stripe_customer_id;
    new.subscription_tier := old.subscription_tier;
    new.subscription_status := old.subscription_status;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.current_period_end := old.current_period_end;
    new.cancel_at_period_end := old.cancel_at_period_end;
    new.credits := old.credits;
    new.is_admin := old.is_admin;
    new.featured_at := old.featured_at;
  end if;
  return new;
end;
$function$;

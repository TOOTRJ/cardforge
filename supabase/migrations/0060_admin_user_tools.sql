-- 0060_admin_user_tools.sql — per-user admin overrides (comp tier, card cap).
--
-- The /admin/users page lets an admin grant credits (existing service-role
-- grant_credits RPC), comp a paid tier, and raise a user's saved-card limit.
-- The comp/override state lives on profiles so getEntitlements() reads it in
-- the same (React-cached) profile fetch it already makes — no extra query.
--
-- All three columns are billing state, so they join the protect_billing_columns
-- trigger: only the service role may write them; client writes are silently
-- reverted, same as subscription_tier/credits.

alter table public.profiles
  add column if not exists comp_tier text
    check (comp_tier in ('plus', 'pro')),
  add column if not exists comp_expires_at timestamptz,
  add column if not exists card_limit_override integer
    check (card_limit_override is null or card_limit_override > 0);

comment on column public.profiles.comp_tier is
  'Admin-granted complimentary tier. Entitlements use the HIGHER of this and the Stripe tier while unexpired. Written only via the admin users page (service role).';
comment on column public.profiles.comp_expires_at is
  'When the comp lapses. NULL = no expiry. Checked at read time by getEntitlements(); no cron needed.';
comment on column public.profiles.card_limit_override is
  'Admin-raised saved-card cap. Entitlements use the HIGHER of this and the tier cap (so it can never lower a paid tier''s cap). NULL = tier default.';

-- Extend the column-pinning trigger with the new columns. Body carried
-- forward from 0052 (the latest definition — it added is_admin/featured_at
-- on top of 0028); CREATE OR REPLACE swaps it atomically.
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

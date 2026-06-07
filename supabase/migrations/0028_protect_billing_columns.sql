-- 0028_protect_billing_columns.sql — prevent client tampering with billing state.
--
-- The "Users can update their own profile" RLS policy (0001) is column-blind:
-- it lets a signed-in user update ANY column on their own row. Since
-- entitlements + credits are READ from profiles, that policy alone would let a
-- user do `update profiles set subscription_tier='pro', credits=999999` via the
-- anon client and bypass the entire paywall.
--
-- This trigger closes that hole at the column level: any write to a billing
-- column by a NON-privileged role is silently reverted (INSERT → defaults,
-- UPDATE → prior values), so normal profile edits (username, bio, …) still work
-- but billing columns can only be changed by the service role (Stripe webhook +
-- cron) and by the SECURITY DEFINER credit RPCs (which run as the function
-- owner). Verified on a Supabase branch.

create or replace function public.protect_billing_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Privileged writers: the service role (webhook + cron), the migration/owner
  -- role, and SECURITY DEFINER credit functions (consume_credits/grant_credits/
  -- record_signup_credit_grant run as their owner). They may set billing columns.
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  -- Everyone else (anon / authenticated direct writes): force billing columns to
  -- safe values so client tampering is a no-op.
  if tg_op = 'INSERT' then
    new.stripe_customer_id := null;
    new.subscription_tier := 'free';
    new.subscription_status := null;
    new.stripe_subscription_id := null;
    new.current_period_end := null;
    new.cancel_at_period_end := false;
    new.credits := 25;
  else
    new.stripe_customer_id := old.stripe_customer_id;
    new.subscription_tier := old.subscription_tier;
    new.subscription_status := old.subscription_status;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.current_period_end := old.current_period_end;
    new.cancel_at_period_end := old.cancel_at_period_end;
    new.credits := old.credits;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_billing on public.profiles;
create trigger profiles_protect_billing
  before insert or update on public.profiles
  for each row execute function public.protect_billing_columns();

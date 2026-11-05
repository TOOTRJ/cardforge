-- 0175_billing_interval_grant_lock.sql — the refill cron knows a plan's
-- interval, and a credit grant takes the user's row lock first (billing audit
-- 2026-11-05, findings P2-1 and P2-6; owner approved 2026-11-05).
--
-- 1. `profiles.billing_interval` ('month' | 'year'; NULL = no live
--    subscription or not yet synced) — written by the Stripe sync from the
--    live subscription's price. The monthly refill keyed on the CALENDAR month
--    handed out two allotments for one payment when a monthly plan paid on
--    the 31st and the daily cron ran on the 1st; with the interval known the
--    cron grants a MONTHLY plan's base allotment only as a backstop (the
--    invoice that pays is what grants it — lib/billing/credit-refill.ts) and
--    keeps granting an ANNUAL plan every calendar month, backfilling a month
--    it missed. A private billing column: pinned by protect_billing_columns
--    (body carried forward from 0174), never in the public column grant, not
--    returned by get_my_billing() (nothing on the user's pages reads it).
--
-- 2. grant_credits() — body from 0027 — now locks the profile row BEFORE the
--    idempotency check. Two concurrent calls with one key (the webhook and the
--    cron, or two webhook deliveries) both passed the `exists` check, both
--    updated the balance, and the second INSERT then hit the unique index:
--    its whole call rolled back (no double grant) but the caller saw a 23505,
--    the webhook answered 500 and the cron alerted every admin for nothing.
--    Under the lock the second call waits for the first and reads its row.
--
-- Idempotent. Grants: the column needs none; the function keeps 0027's ACL
-- (`create or replace`). Ships through a PR; never applied ad-hoc.

-- 1. billing_interval ---------------------------------------------------------
-- 0174 (the dunning grace) is expected BEFORE this file and adds
-- payment_failed_at, which the trigger body below pins; a plpgsql body that
-- names a missing `new.` field is accepted at CREATE and fails at the first
-- profile write, so the column is added here too (idempotent) and this file
-- never depends on the order. Merge 0174's PR first all the same: applied
-- AFTER this one, its older trigger body would drop the billing_interval pin
-- — and `authenticated` holds table-level UPDATE on profiles (0097), so a
-- user could then write it (a monthly subscriber setting 'year' turns the
-- cron's backstop off until the next sync). The guard is the merge order
-- (#758 → #759 → #760); the pins are re-stated here either way.
alter table public.profiles
  add column if not exists payment_failed_at timestamptz;

alter table public.profiles
  add column if not exists billing_interval text
    check (billing_interval is null or billing_interval in ('month', 'year'));

comment on column public.profiles.billing_interval is
  'The live subscription''s billing interval (its price''s recurring.interval: month | year); NULL when none. Written only by the Stripe sync (service role). Read by the refill cron (lib/billing/credit-refill.ts).';

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

-- 2. grant_credits takes the user's row lock first ----------------------------
create or replace function public.grant_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_idempotency_key text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  -- Serialize every grant for this user: a concurrent call with the same
  -- key waits here and then finds the ledger row (no 23505, no 500). NO KEY
  -- UPDATE is the lock the old UPDATE took (never blocks a FK key share).
  select credits into v_balance
  from public.profiles
  where id = p_user_id
  for no key update;

  if v_balance is null then
    return 0; -- no such profile; nothing granted
  end if;

  if p_idempotency_key is not null and exists (
    select 1 from public.credit_ledger where idempotency_key = p_idempotency_key
  ) then
    return v_balance;
  end if;

  update public.profiles
    set credits = credits + p_amount
    where id = p_user_id
    returning credits into v_balance;

  insert into public.credit_ledger
    (user_id, delta, reason, balance_after, idempotency_key)
    values (p_user_id, p_amount, p_reason, v_balance, p_idempotency_key);

  return v_balance;
end;
$$;

-- ACL unchanged from 0027: service role only.
revoke all on function public.grant_credits(uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.grant_credits(uuid, integer, text, text) to service_role;

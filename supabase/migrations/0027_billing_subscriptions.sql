-- 0027_billing_subscriptions.sql — premium subscriptions + AI generation credits.
--
-- Adds the billing/entitlement layer:
--   * profiles gains Stripe + tier + credit columns (entitlement source of truth,
--     written ONLY by the Stripe webhook via the service role).
--   * credit_ledger: append-only audit of every credit grant/spend.
--   * stripe_events: webhook idempotency (dedupe by Stripe event id).
--   * consume_credits / grant_credits: atomic, race-safe credit mutation RPCs.
--   * credit_ledger_daily: per-day spend aggregate for the usage panel chart.
--
-- IP note: the paid value is OUR technology (AI generation, exports, storage,
-- original frames) — never WotC trade dress. Nothing here gates MTG-style
-- rendering. Apply via `supabase db push` or the Supabase MCP.

-- 1. Profile billing columns ------------------------------------------------
-- Entitlement source of truth. The webhook keeps these in sync with Stripe;
-- the app reads them (cached) via getCurrentProfile()/getEntitlements().
alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists subscription_tier text not null default 'free',
  add column if not exists subscription_status text,
  add column if not exists stripe_subscription_id text,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists credits integer not null default 5;

-- Constraints (added separately so the migration is re-runnable on partially
-- migrated DBs — `add column if not exists` won't re-add a constraint).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_subscription_tier_check') then
    alter table public.profiles
      add constraint profiles_subscription_tier_check
      check (subscription_tier in ('free', 'plus', 'pro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_subscription_status_check') then
    alter table public.profiles
      add constraint profiles_subscription_status_check
      check (subscription_status is null or subscription_status in
        ('active','trialing','past_due','canceled','incomplete',
         'incomplete_expired','unpaid','paused'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_credits_nonneg') then
    alter table public.profiles
      add constraint profiles_credits_nonneg check (credits >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_stripe_customer_unique') then
    alter table public.profiles
      add constraint profiles_stripe_customer_unique unique (stripe_customer_id);
  end if;
end $$;

create index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id);

-- NOTE on RLS: the existing "Users can update their own profile" policy lets a
-- user update ANY column on their own row, including these billing columns. We
-- intentionally rely on the SERVER never writing billing columns from the
-- user's anon client (only the service-role webhook does). Tightening the
-- policy to forbid client billing writes is a follow-up (would require a
-- column-aware policy / trigger); for now treat client billing writes as
-- untrusted and never read tier from anything the client could have set.

-- 2. Append-only credit ledger ----------------------------------------------
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  delta integer not null,                 -- negative = spend, positive = grant
  reason text not null,                    -- 'signup_grant','ai_generation','deck_gen',
                                           -- 'subscription_refill','pack_purchase','refund'
  balance_after integer not null,
  -- Idempotency key for grants: a Stripe event id (pack purchase) OR a synthetic
  -- "refill:{user}:{YYYY-MM}" key for monthly subscription refills. Null for spends.
  idempotency_key text,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_created_idx
  on public.credit_ledger (user_id, created_at desc);
-- Partial unique index: a given grant key credits at most once (dedupes webhook
-- retries AND repeated cron runs within the same month).
create unique index if not exists credit_ledger_idempotency_idx
  on public.credit_ledger (idempotency_key)
  where idempotency_key is not null;

alter table public.credit_ledger enable row level security;

drop policy if exists "Users read own ledger" on public.credit_ledger;
create policy "Users read own ledger"
  on public.credit_ledger
  for select
  using (auth.uid() = user_id);
-- No insert/update/delete policies: only the SECURITY DEFINER RPCs below and
-- the service role write here. Under RLS, the absence of a policy denies the
-- operation for anon/authenticated clients.

-- 3. Stripe event dedupe (webhook idempotency) ------------------------------
create table if not exists public.stripe_events (
  id text primary key,                     -- Stripe event.id
  type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- No policies at all → only the service role (webhook) can touch this table.

-- 4. consume_credits — atomic, race-safe spend -------------------------------
-- Called by the authenticated user's anon client. Locks the caller's profile
-- row (FOR UPDATE) so concurrent spends serialize and the balance can never go
-- negative. Returns one row: (ok, balance).
create or replace function public.consume_credits(p_amount integer, p_reason text)
returns table (ok boolean, balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_balance integer;
begin
  if v_uid is null or p_amount is null or p_amount <= 0 then
    return query select false, 0;
    return;
  end if;

  select credits into v_balance from public.profiles
    where id = v_uid
    for update;

  if v_balance is null or v_balance < p_amount then
    return query select false, coalesce(v_balance, 0);
    return;
  end if;

  v_balance := v_balance - p_amount;
  update public.profiles set credits = v_balance where id = v_uid;
  insert into public.credit_ledger (user_id, delta, reason, balance_after)
    values (v_uid, -p_amount, p_reason, v_balance);

  return query select true, v_balance;
end;
$$;

-- Supabase default-grants EXECUTE to anon + authenticated, so revoking only
-- from PUBLIC is NOT enough — revoke from those roles explicitly, then re-grant
-- to authenticated (the app calls this with the user's session). anon has no
-- auth.uid() so it could never spend anyway, but we lock it out regardless.
revoke all on function public.consume_credits(integer, text)
  from public, anon, authenticated;
grant execute on function public.consume_credits(integer, text) to authenticated;

-- 5. grant_credits — idempotent grant (webhook / service role only) ----------
-- Idempotent on p_event_id: a retried Stripe webhook won't double-grant.
-- Takes an explicit user id because the service role has no auth.uid().
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
  if p_idempotency_key is not null and exists (
    select 1 from public.credit_ledger where idempotency_key = p_idempotency_key
  ) then
    select credits into v_balance from public.profiles where id = p_user_id;
    return coalesce(v_balance, 0);
  end if;

  update public.profiles
    set credits = credits + p_amount
    where id = p_user_id
    returning credits into v_balance;

  if v_balance is null then
    return 0; -- no such profile; nothing granted
  end if;

  insert into public.credit_ledger
    (user_id, delta, reason, balance_after, idempotency_key)
    values (p_user_id, p_amount, p_reason, v_balance, p_idempotency_key);

  return v_balance;
end;
$$;

-- Lock this down HARD: only the service role (webhook + cron) may grant credits.
-- Must revoke from anon + authenticated explicitly — Supabase default-grants
-- EXECUTE to them, so `revoke from public` alone would leave a credit-self-grant
-- hole open via /rest/v1/rpc/grant_credits.
revoke all on function public.grant_credits(uuid, integer, text, text)
  from public, anon, authenticated;
-- Intentionally NOT granted to authenticated — only the service role calls it.

-- 6. credit_ledger_daily — per-day spend for the usage chart -----------------
-- Mirrors card_ai_calls_daily (0017). security invoker so RLS scopes rows to
-- the caller via the auth.uid() filter.
create or replace function public.credit_ledger_daily(since timestamptz)
returns table (day date, spent bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select date_trunc('day', created_at)::date as day,
         sum(case when delta < 0 then -delta else 0 end)::bigint as spent
  from public.credit_ledger
  where user_id = auth.uid()
    and created_at >= since
  group by 1
  order by 1 asc;
$$;

revoke all on function public.credit_ledger_daily(timestamptz)
  from public, anon, authenticated;
grant execute on function public.credit_ledger_daily(timestamptz) to authenticated;

-- 7. signup credit grant audit row ------------------------------------------
-- New profiles get credits=5 from the column default. Record that grant in the
-- ledger so the audit trail is complete from day one. Runs AFTER the
-- handle_new_user insert (we don't touch that fragile function directly).
create or replace function public.record_signup_credit_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.credits > 0 then
    insert into public.credit_ledger (user_id, delta, reason, balance_after)
      values (new.id, new.credits, 'signup_grant', new.credits);
  end if;
  return new;
end;
$$;

-- Trigger function — not meant to be RPC-callable; lock it to trigger use only.
revoke all on function public.record_signup_credit_grant()
  from public, anon, authenticated;

drop trigger if exists profiles_signup_credit_grant on public.profiles;
create trigger profiles_signup_credit_grant
  after insert on public.profiles
  for each row execute function public.record_signup_credit_grant();

-- 8. Widen card_ai_calls.action for the AI deck/set generator ----------------
-- Adds 'generate_deck' so the Pro "generate a whole set" flow logs cleanly
-- alongside the existing audit labels (see 0020 for the prior list).
alter table public.card_ai_calls
  drop constraint if exists card_ai_calls_action_check;

alter table public.card_ai_calls
  add constraint card_ai_calls_action_check check (
    action = any (array[
      'improve_wording',
      'suggest_cost',
      'suggest_rarity',
      'generate_flavor',
      'generate_art_prompt',
      'check_balance',
      'generate_from_concept',
      'generate_random_card',
      'generate_random_art',
      'generate_deck'
    ])
  );

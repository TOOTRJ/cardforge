-- 0174_dunning_grace_refunds_disputes.sql — a failed renewal keeps its perks
-- through Stripe's retries, and refunds / disputes reach the app (billing
-- audit 2026-11-05, findings P1-3 and P2-2; owner approved 2026-11-05).
--
-- 1. Dunning grace. `profiles.payment_failed_at` = when the Stripe sync first
--    saw the subscription's payment broken (past_due / unpaid); NULL while it
--    pays or once it ends. A `past_due` subscription keeps its paid perks for
--    14 days from that moment (Stripe's Smart Retries window) — ONE rule,
--    public.subscription_perks_on(status, failed_at), mirrored by
--    lib/billing/dunning.ts, and read by the three functions that decide
--    perks in SQL: card_capacity_for (0104), owner_export_stamp (0074) and
--    viewer_is_pro (0151). Bodies carried forward from those migrations with
--    only the status test changed. The column is a private billing column:
--    pinned by protect_billing_columns (body from 0135) and returned by
--    get_my_billing() (return type changes → drop + create, one transaction).
--    `deck_history_owner_is_pro` (0165) is left as it is: its stamp only
--    starts the 30-day history grace, which recovery clears.
--
-- 2. Two notification kinds: `payment_failed` (the user: once per invoice —
--    Stripe retries the SAME invoice — unique on payload.invoiceId) and
--    `billing_alert` (every admin, once per payload.dedupeKey — the 0140
--    pattern — for a refund, a dispute, a dispute's outcome and a Radar early
--    fraud warning). The CHECK is 0172's list plus the two.
--
-- 3. Refunds and disputes on the revenue logs. `billing_payments` gains the
--    invoice's payment_intent_id (written from invoice.payments by the
--    webhook from now on; older rows stay NULL and a refund of one is
--    alerted as unmatched) and both logs gain refunded_cents / refunded_at /
--    dispute_id / dispute_status / disputed_at. A pack's credits follow the
--    money: reconcile_pack_withdrawal(session, withdrawn_cents) — service
--    role only, one row lock — claws back the share of the pack's credits
--    the refunded or disputed amount represents (never below a zero balance;
--    what was really taken is `clawed_credits`) and gives them back when a
--    dispute is won. Ledger reasons `pack_refund` / `pack_refund_reversed`,
--    keyed `refund:pack:<session>:<clawed total>` so a retried event posts
--    nothing twice.
--
-- Idempotent. Grants are stated explicitly (0097). Ships through a PR; never
-- applied ad-hoc.

-- ===========================================================================
-- 1. Dunning grace
-- ===========================================================================

alter table public.profiles
  add column if not exists payment_failed_at timestamptz;

comment on column public.profiles.payment_failed_at is
  'When the Stripe sync first saw the live subscription''s payment broken (past_due / unpaid). NULL while it pays or once it has ended. A past_due subscription keeps its paid perks for 14 days from here (subscription_perks_on). Written only by the sync (service role).';

create or replace function public.subscription_perks_on(p_status text, p_failed_at timestamptz)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    p_status in ('active', 'trialing')
    or (p_status = 'past_due'
        and p_failed_at is not null
        and p_failed_at > now() - interval '14 days'),
    false
  );
$$;

comment on function public.subscription_perks_on(text, timestamptz) is
  'Whether a subscription in this status still carries its paid perks: active / trialing, or past_due within 14 days of payment_failed_at (the dunning grace). Mirrors lib/billing/dunning.ts; change both together.';

revoke all on function public.subscription_perks_on(text, timestamptz) from public, anon, authenticated;
grant execute on function public.subscription_perks_on(text, timestamptz) to service_role;

-- 1a. protect_billing_columns — body from 0135, plus the new column.
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

-- 1b. get_my_billing — 0135's columns plus payment_failed_at.
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
  payment_failed_at timestamptz
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
    p.payment_failed_at
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke all on function public.get_my_billing() from public, anon, authenticated;
grant execute on function public.get_my_billing() to authenticated, service_role;

-- 1c. card_capacity_for — body from 0104, the status test through the rule.
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
         and public.subscription_perks_on(subscription_status, payment_failed_at) then subscription_tier
        else 'free'
      end as subscribed,
      case
        when comp_tier in ('plus', 'pro')
         and (comp_expires_at is null or comp_expires_at > now()) then comp_tier
        else null
      end as comp
    from public.profiles
    where id = p_user_id
  ),
  ranked as (
    select
      is_admin,
      card_limit_override,
      case
        when comp is not null
         and (case comp when 'pro' then 2 when 'plus' then 1 else 0 end)
           > (case subscribed when 'pro' then 2 when 'plus' then 1 else 0 end)
        then comp
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
  'Saved-card cap for a user (-1 = unlimited). Mirrors lib/billing/entitlements.ts (the dunning grace included, 0174); keep in sync.';

revoke all on function public.card_capacity_for(uuid) from public, anon, authenticated;
grant execute on function public.card_capacity_for(uuid) to service_role;

-- 1d. owner_export_stamp — body from 0074, the status test through the rule.
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
          and public.subscription_perks_on(p.subscription_status, p.payment_failed_at))
      or (p.comp_tier in ('plus', 'pro')
          and (p.comp_expires_at is null or p.comp_expires_at > now()))
      as paid,
    nullif(btrim(p.export_watermark_text), '') as footer_text
  from public.profiles p
  where p.id = p_owner_id;
$$;

revoke all on function public.owner_export_stamp(uuid) from public, anon, authenticated;
grant execute on function public.owner_export_stamp(uuid) to anon, authenticated;

-- 1e. viewer_is_pro — body from 0151, the status test through the rule.
create or replace function public.viewer_is_pro()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.is_admin
        or (p.subscription_tier = 'pro' and public.subscription_perks_on(p.subscription_status, p.payment_failed_at))
        or (p.comp_tier = 'pro' and (p.comp_expires_at is null or p.comp_expires_at > now()))
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;

comment on function public.viewer_is_pro() is
  'Whether the caller gets Pro perks: an admin, a Pro subscription that carries its perks (active / trialing, or past_due inside the 14-day dunning grace — 0174) or an unexpired Pro comp. Mirrors lib/billing/entitlements.ts effectiveTierForProfile.';

-- Grants unchanged from 0151 (`create or replace` keeps the ACL).

-- ===========================================================================
-- 2. Notification kinds
-- ===========================================================================

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
      'payment_failed', 'billing_alert'
    )
  );

create unique index if not exists notifications_payment_failed_once_idx
  on public.notifications ((payload ->> 'invoiceId'), recipient_id)
  where type = 'payment_failed';

create unique index if not exists notifications_billing_alert_once_idx
  on public.notifications ((payload ->> 'dedupeKey'), recipient_id)
  where type = 'billing_alert';

-- ===========================================================================
-- 3. Refunds and disputes on the revenue logs
-- ===========================================================================

alter table public.billing_payments
  add column if not exists payment_intent_id text,
  add column if not exists refunded_cents integer not null default 0 check (refunded_cents >= 0),
  add column if not exists refunded_at timestamptz,
  add column if not exists dispute_id text,
  add column if not exists dispute_status text,
  add column if not exists disputed_cents integer not null default 0 check (disputed_cents >= 0),
  add column if not exists disputed_at timestamptz;

create index if not exists billing_payments_payment_intent_idx
  on public.billing_payments (payment_intent_id)
  where payment_intent_id is not null;

alter table public.billing_pack_payments
  add column if not exists refunded_cents integer not null default 0 check (refunded_cents >= 0),
  add column if not exists refunded_at timestamptz,
  add column if not exists clawed_credits integer not null default 0 check (clawed_credits >= 0),
  add column if not exists dispute_id text,
  add column if not exists dispute_status text,
  add column if not exists disputed_cents integer not null default 0 check (disputed_cents >= 0),
  add column if not exists disputed_at timestamptz;

create index if not exists billing_pack_payments_payment_intent_idx
  on public.billing_pack_payments (payment_intent_id)
  where payment_intent_id is not null;

comment on column public.billing_pack_payments.clawed_credits is
  'Credits really taken back for the refunded / disputed share of this pack (reconcile_pack_withdrawal): capped at the balance the user had, so it can be less than the share.';

-- The pack's credits follow the money. p_withdrawn_cents = what the customer
-- got back or the network took (refunded + an open or lost dispute). Target =
-- the pack's credits × withdrawn ÷ paid (a pack sold for $0 with anything
-- withdrawn counts as whole). Claws back the shortfall against what was
-- taken before, never below a zero balance; gives back the surplus when the
-- target drops (a dispute won). Returns what moved this call. Reconciles to
-- the TARGET, so a call that found the balance short of it (the user had
-- spent the credits) takes the rest from credits earned later, on any later
-- event for the session — the shortfall stays owed. The claw-back rows are
-- keyed `refund:pack:<session>:<clawed total>`, the give-backs
-- `refund:pack:<session>:back:<target>` (distinct namespaces: a claw to 15,
-- then to 30, then a give-back to 15 must not collide).
create or replace function public.reconcile_pack_withdrawal(
  p_session text,
  p_withdrawn_cents integer
)
returns table (user_id uuid, credits_delta integer, clawed_total integer, target integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.billing_pack_payments%rowtype;
  v_target integer;
  v_delta integer;
  v_balance integer;
  v_take integer;
  v_after integer;
begin
  select * into v_row
  from public.billing_pack_payments
  where checkout_session_id = p_session
  for update;
  if not found then
    return;
  end if;

  v_target := case
    when coalesce(p_withdrawn_cents, 0) <= 0 then 0
    when v_row.amount_cents <= 0 then v_row.credits
    else least(v_row.credits, round(v_row.credits::numeric * least(p_withdrawn_cents, v_row.amount_cents) / v_row.amount_cents)::integer)
  end;
  v_delta := v_target - v_row.clawed_credits;

  if v_delta > 0 then
    -- Take back, but never below zero: the user may have spent them.
    select credits into v_balance from public.profiles where id = v_row.user_id for update;
    if v_balance is null then
      -- The account is gone: nothing to take; record the target as reached.
      update public.billing_pack_payments
        set clawed_credits = v_target
        where checkout_session_id = p_session;
      return query select v_row.user_id, 0, v_target, v_target;
      return;
    end if;
    v_take := least(v_delta, greatest(v_balance, 0));
    if v_take > 0 then
      update public.profiles set credits = credits - v_take where id = v_row.user_id
        returning credits into v_after;
      insert into public.credit_ledger (user_id, delta, reason, balance_after, idempotency_key)
      values (v_row.user_id, -v_take, 'pack_refund', v_after,
              'refund:pack:' || p_session || ':' || (v_row.clawed_credits + v_take))
      on conflict do nothing;
    end if;
    update public.billing_pack_payments
      set clawed_credits = clawed_credits + v_take
      where checkout_session_id = p_session;
    return query select v_row.user_id, -v_take, v_row.clawed_credits + v_take, v_target;
    return;
  elsif v_delta < 0 then
    -- Give back what was taken beyond the new target (a dispute won).
    v_take := -v_delta;
    if v_row.user_id is not null then
      update public.profiles set credits = credits + v_take where id = v_row.user_id
        returning credits into v_after;
      if v_after is not null then
        insert into public.credit_ledger (user_id, delta, reason, balance_after, idempotency_key)
        values (v_row.user_id, v_take, 'pack_refund_reversed', v_after,
                'refund:pack:' || p_session || ':back:' || v_target)
        on conflict do nothing;
      end if;
    end if;
    update public.billing_pack_payments
      set clawed_credits = v_target
      where checkout_session_id = p_session;
    return query select v_row.user_id, v_take, v_target, v_target;
    return;
  end if;

  return query select v_row.user_id, 0, v_row.clawed_credits, v_target;
end;
$$;

comment on function public.reconcile_pack_withdrawal(text, integer) is
  'Claws back (or gives back) the share of a credit pack''s credits that a refund or dispute withdrew — see 0174. Service role only; reconciles to the target (a shortfall the balance could not cover stays owed to later events).';

revoke all on function public.reconcile_pack_withdrawal(text, integer) from public, anon, authenticated;
grant execute on function public.reconcile_pack_withdrawal(text, integer) to service_role;

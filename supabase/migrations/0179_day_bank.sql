-- 0179_day_bank.sql — the DAYS BANK (owner 2026-11-06, docs/BILLING.md
-- "The days bank").
--
-- A free trial is no longer a thing of its own: every new account gets
-- SIGNUP days (7) in a bank; the referral program banks more
-- (lib/referrals, the ladder). The FIRST checkout applies the whole bank as
-- the free period before the first charge (card required — Stripe
-- `trial_end`; the plan bills by itself when it ends); days earned later
-- wait in the bank and the user applies them by hand (lib/billing/day-bank.ts
-- `applyBankToPlan`: on a live plan the days are added to its time through
-- the free-days mechanism — a plan_grants row of `source` 'day_bank', an
-- exact number of DAYS, no credits of its own).
--
--   day_bank_entries   one row per thing banked (signup, a referral step…):
--                      `banked` → `reserved` (a Checkout in flight, keyed by
--                      its batch) → `applied` (the session completed, or the
--                      live plan took them) — or back to `banked` when the
--                      session expires; `revoked` when the signup days turn
--                      out not to be owed (an account whose email already
--                      had a free period, lib/stripe/actions.ts).
--   plan_grants        gains `days` (an exact length beside `units`) and
--                      `grants_credits` (false for a bank application: the
--                      ladder's credits are their own) and the source
--                      'day_bank'.
--
-- Users read their own bank (the billing page); every write is the service
-- role's. Grants stated (every migration states them).

create table if not exists public.day_bank_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  days integer not null check (days >= 1 and days <= 730),
  source text not null check (source in ('signup', 'referral_friend', 'referral_step', 'admin', 'promo')),
  -- The caller's own key (`signup:<user>`, `referral-step:<user>:<n>`):
  -- unique, so a retried write finds the entry it already made.
  reference text unique,
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'banked' check (status in ('banked', 'reserved', 'applied', 'revoked')),
  -- A reservation: the Checkout batch (session metadata `bank_batch`) or the
  -- plan application that holds it.
  batch_id uuid,
  reserved_at timestamptz,
  applied_at timestamptz,
  applied_via text check (applied_via is null or applied_via in ('checkout', 'plan_hold')),
  -- The Checkout session id or the plan_grants row that used the days.
  applied_ref text,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or char_length(revoke_reason) <= 200),
  created_at timestamptz not null default now(),
  constraint day_bank_entries_applied_stamped check (status <> 'applied' or applied_at is not null),
  constraint day_bank_entries_reserved_batch check (status <> 'reserved' or batch_id is not null),
  constraint day_bank_entries_revoked_stamped check (status <> 'revoked' or revoked_at is not null)
);

comment on table public.day_bank_entries is
  'The days bank: free days an account holds (signup days, referral rewards) until a checkout or the user applies them to a live plan. lib/billing/day-bank.ts.';

create index if not exists day_bank_entries_user_status_idx on public.day_bank_entries (user_id, status);
create index if not exists day_bank_entries_batch_idx on public.day_bank_entries (batch_id) where status = 'reserved';

alter table public.day_bank_entries enable row level security;

drop policy if exists "day_bank_entries_select_own" on public.day_bank_entries;
create policy "day_bank_entries_select_own" on public.day_bank_entries
  for select using (user_id = auth.uid());

revoke all on table public.day_bank_entries from public, anon, authenticated;
grant select (id, user_id, days, source, status, batch_id, applied_at, applied_via, created_at)
  on table public.day_bank_entries to authenticated;
grant select, insert, update, delete on table public.day_bank_entries to service_role;

-- plan_grants: an exact number of days, and whether the grant carries credits.
alter table public.plan_grants
  add column if not exists days integer check (days is null or (days >= 1 and days <= 730)),
  add column if not exists grants_credits boolean not null default true;

alter table public.plan_grants drop constraint if exists plan_grants_end_matches_units;
alter table public.plan_grants
  add constraint plan_grants_end_matches_units check ((units is null and days is null) = (ends_at is null));
alter table public.plan_grants drop constraint if exists plan_grants_units_or_days;
alter table public.plan_grants
  add constraint plan_grants_units_or_days check (units is null or days is null);

alter table public.plan_grants drop constraint if exists plan_grants_source_check;
alter table public.plan_grants
  add constraint plan_grants_source_check
  check (source in ('comp', 'referral_friend', 'referral_referrer', 'promo', 'day_bank'));

comment on column public.plan_grants.days is
  'An exact length in days (a bank application) — beside units (30-day comps); never both.';
comment on column public.plan_grants.grants_credits is
  'False: the grant carries no credit allotments (lib/billing/free-days-credits.ts skips it).';

-- ---------------------------------------------------------------------------
-- The `banked_days` notification: an admin banked free days for the user
-- (the comp since owner 2026-11-06), or took banked days back. The kinds
-- 0177 added are kept (tests/unit/db/referrals-migration.test.ts).
-- ---------------------------------------------------------------------------
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
      'referral_signup', 'referral_reward',
      -- THE DAYS BANK
      'banked_days'
    )
  );

-- 0138 — billing_pack_payments: credit-pack sales in the revenue log.
--
-- Ships through a PR; never applied ad-hoc.
--
-- The admin Revenue panel read only billing_payments (0110), which only
-- invoice.paid writes — and a pack is a one-time Checkout session
-- (mode "payment") that creates NO invoice, so every pack sale was missing
-- from the panel's totals.
--
-- One row per PAID pack Checkout session, written by the Stripe webhook
-- (service role) in the same handler that grants the pack's credits
-- (handleCheckoutPaid, lib/stripe/webhook-handlers.ts — on
-- checkout.session.completed when it arrives paid, else on
-- checkout.session.async_payment_succeeded). Keyed by the SESSION id, the
-- same key as the credit grant (`pack:<session id>` in credit_ledger), and
-- written `on conflict do nothing`: a repeated delivery, or both events of
-- one purchase in any order, leave exactly one row. An unpaid `completed`
-- writes nothing. Amount and currency are Stripe's `amount_total` /
-- `currency` for the session (after any subscriber coupon).
--
-- No backfill: the rows that exist today cannot price an old pack sale.
-- credit_ledger's `pack:<session id>` grants carry the credits, not the
-- amount paid (the subscriber coupon and the 2026-09-24 price change make
-- the price per pack ambiguous), and funnel_events' `pack_purchased` rows
-- carry `amountCents` but NOT the session id (a Checkout session id is
-- 66 characters, past the funnel's 48-character prop limit, so the
-- sanitizer drops it) — so neither can be tied to one sale without
-- guessing. The panel counts ledger pack grants with no row here and says
-- so ("N earlier pack sales not priced here — see Stripe").
--
-- Admins read it; nobody else can see or write it.

create table if not exists public.billing_pack_payments (
  checkout_session_id text primary key,
  user_id uuid references auth.users (id) on delete set null,
  stripe_customer_id text,
  payment_intent_id text,
  pack text,
  credits integer not null check (credits > 0),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  discount text,
  paid_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists billing_pack_payments_paid_at_idx
  on public.billing_pack_payments (paid_at desc);
create index if not exists billing_pack_payments_user_idx
  on public.billing_pack_payments (user_id, paid_at desc);

alter table public.billing_pack_payments enable row level security;

drop policy if exists "Billing pack payments: admin read" on public.billing_pack_payments;
create policy "Billing pack payments: admin read"
  on public.billing_pack_payments for select
  using (public.viewer_is_admin());

-- Grants (every migration states them — new projects don't auto-grant).
-- Reads by signed-in admins through RLS; every write is the webhook's
-- service role. anon gets nothing.
revoke all on public.billing_pack_payments from anon;
grant select on public.billing_pack_payments to authenticated;
grant select, insert, update, delete on public.billing_pack_payments to service_role;

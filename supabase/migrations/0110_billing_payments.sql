-- 0110 — invoice.paid → a revenue log; two more notification kinds.
--
-- billing_payments is written by the Stripe webhook (service role) on every
-- invoice.paid — Stripe's canonical "money arrived" signal — one row per
-- invoice (upsert, so retries and duplicate deliveries are harmless). It
-- backs the admin Revenue panel (/admin/users) so income is visible without
-- opening Stripe. Admins read it; nobody else can see or write it.
--
-- Notification kinds:
--   payment_received  — one per PAID invoice with money taken ($0 trial
--                       invoices say nothing); payload { invoiceId, … }
--   checkout_reminder — a Checkout session expired unfinished; one per user
--                       per 30 days (the index backs that guard)

create table if not exists public.billing_payments (
  invoice_id text primary key,
  user_id uuid references auth.users (id) on delete set null,
  stripe_customer_id text not null,
  stripe_subscription_id text,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  billing_reason text,
  tier text check (tier is null or tier in ('plus', 'pro')),
  billing_interval text check (billing_interval is null or billing_interval in ('month', 'year')),
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz not null,
  invoice_number text,
  hosted_invoice_url text,
  created_at timestamptz not null default now()
);

create index if not exists billing_payments_paid_at_idx
  on public.billing_payments (paid_at desc);
create index if not exists billing_payments_user_idx
  on public.billing_payments (user_id, paid_at desc);

alter table public.billing_payments enable row level security;

drop policy if exists "Billing payments: admin read" on public.billing_payments;
create policy "Billing payments: admin read"
  on public.billing_payments for select
  using (public.viewer_is_admin());

-- Grants (every migration states them — new projects don't auto-grant).
-- Reads by signed-in admins through RLS; every write is the webhook's
-- service role. anon gets nothing.
grant select on public.billing_payments to authenticated;
grant select, insert, update, delete on public.billing_payments to service_role;

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'like', 'comment', 'remix', 'follow', 'feedback', 'moderation', 'message',
      'credit_grant', 'comp_plan', 'card_limit', 'render_update', 'site_update',
      'deck_generated', 'trial_ending', 'payment_received', 'checkout_reminder'
    )
  );

create index if not exists notifications_payment_received_idx
  on public.notifications ((payload ->> 'invoiceId'))
  where type = 'payment_received';

create index if not exists notifications_checkout_reminder_idx
  on public.notifications (recipient_id, created_at desc)
  where type = 'checkout_reminder';

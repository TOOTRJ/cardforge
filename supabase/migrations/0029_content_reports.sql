-- 0029_content_reports.sql — user reporting + admin moderation for the public
-- gallery (user-uploaded art + AI-generated images/text need an abuse path).
--
--   * card_reports: one row per (card, reporter); the abuse intake.
--   * profiles.is_admin: gates the moderation dashboard + admin actions.
--
-- Reports are INSERTed by the reporting user (RLS). Admin reads + moderation
-- actions go through the service-role client (gated by is_admin in app code),
-- so there are no admin RLS policies to maintain here.

-- 1. Admin flag -------------------------------------------------------------
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- 2. Reports table ----------------------------------------------------------
create table if not exists public.card_reports (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id),
  -- One report per user per card (re-reporting updates nothing; keeps counts honest).
  constraint card_reports_unique_reporter unique (card_id, reporter_id),
  constraint card_reports_reason_check
    check (reason in ('nsfw', 'ip', 'spam', 'hateful', 'other')),
  constraint card_reports_details_length
    check (details is null or char_length(details) <= 1000),
  constraint card_reports_status_check
    check (status in ('pending', 'dismissed', 'actioned'))
);

create index if not exists card_reports_status_created_idx
  on public.card_reports (status, created_at desc);
create index if not exists card_reports_card_idx
  on public.card_reports (card_id);

-- 3. RLS --------------------------------------------------------------------
alter table public.card_reports enable row level security;

drop policy if exists "Users can file reports" on public.card_reports;
drop policy if exists "Users read own reports" on public.card_reports;

-- Signed-in users can file a report as themselves.
create policy "Users can file reports"
  on public.card_reports
  for insert
  with check (auth.uid() = reporter_id);

-- A user may see the reports they filed (e.g. to avoid double-reporting).
create policy "Users read own reports"
  on public.card_reports
  for select
  using (auth.uid() = reporter_id);

-- No update/delete policies: resolving a report + hiding a card is done by the
-- service role (admin actions), which bypasses RLS.

-- 4. Extend the billing-column guard to also protect is_admin ----------------
-- The profiles UPDATE policy is column-blind, so without this a user could
-- `update profiles set is_admin = true` on their own row and self-promote. Fold
-- is_admin into the existing protect trigger (0028): non-privileged writes to it
-- are reverted; only the service role / migrations can grant admin.
create or replace function public.protect_billing_columns()
returns trigger
language plpgsql
set search_path = public
as $$
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
  else
    new.stripe_customer_id := old.stripe_customer_id;
    new.subscription_tier := old.subscription_tier;
    new.subscription_status := old.subscription_status;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.current_period_end := old.current_period_end;
    new.cancel_at_period_end := old.cancel_at_period_end;
    new.credits := old.credits;
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;
-- Trigger profiles_protect_billing (0028) already calls this function.

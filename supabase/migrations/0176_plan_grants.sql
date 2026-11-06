-- 0176_plan_grants.sql — free 30 days: ONE mechanism for comps and (next)
-- referral rewards (owner decisions 2026-11-05; design:
-- docs/research/free-months-design-2026-11.md §6).
--
-- A grant is N units of 30 days (exactly 30 × 86 400 seconds, counted from
-- the moment it is given) of a paid tier, with that tier's normal AI credits
-- — one allotment per 30 days of the grant, at the start of each
-- (`credit_ledger.idempotency_key` = `grant:<id>:<k>`, reason `plan_grant`;
-- lib/billing/free-days-credits.ts). The row is the record; HOW it was
-- applied is `applied_as` (lib/billing/free-days.ts decides):
--   overlay            no live Stripe plan (or one that is ending / past
--                      due): profiles.comp_tier / comp_expires_at extended
--                      by the days — the perks overlay 0060 introduced;
--   subscription_hold  a live, renewing plan or trial: the days are ADDED
--                      to the time paid for — Stripe `trial_end` = the
--                      period's end (or the trial's) + the days, with
--                      `proration_behavior: none`; the overlay is written
--                      too, to the same instant (the reminders read it);
--   below_plan         a grant below the tier the user pays for: recorded,
--                      nothing changes, no credits.
-- `units` NULL = no end (STAFF only — an account with no Stripe plan;
-- owner 2026-11-05): the overlay with no expiry, an allotment every 30 days.
--
-- Existing comps are CONVERTED into grants below (idempotent — only users
-- with no grant row yet): a dated comp keeps its end date, an undated one
-- becomes an open-ended (staff) grant. Their first 30-day allotment is due
-- on the FIRST OF NEXT MONTH (`credits_from`): the calendar-month refill
-- this migration retires (lib/billing/credit-refill.ts no longer counts a
-- comp) has already granted the current month.
--
-- Grants (CLAUDE.md "Every migration states its grants"): the service role
-- owns the table; a signed-in user reads their OWN rows (RLS) and only the
-- columns a user may see (a column-level grant — never the admin's note or
-- who granted it); anon nothing. Idempotent. Ships through a PR; never
-- applied ad-hoc.

create table if not exists public.plan_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  tier text not null check (tier in ('plus', 'pro')),
  -- 30-day units; NULL = no end (staff).
  units integer check (units is null or units >= 1),
  source text not null check (source in ('comp', 'referral_friend', 'referral_referrer', 'promo')),
  granted_by uuid references public.profiles (id) on delete set null,
  note text check (note is null or char_length(note) <= 500),
  applied_as text not null check (applied_as in ('overlay', 'subscription_hold', 'below_plan')),
  stripe_subscription_id text,
  -- The free days run from starts_at to ends_at (NULL = no end).
  starts_at timestamptz not null,
  ends_at timestamptz,
  -- The first credit allotment's instant; the next every 30 days after it.
  credits_from timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'applied', 'failed', 'revoked')),
  stripe_error text,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint plan_grants_end_matches_units check ((units is null) = (ends_at is null)),
  constraint plan_grants_revoked_stamped check (status <> 'revoked' or revoked_at is not null)
);

comment on table public.plan_grants is
  'Free 30 days of a paid tier (comps, referral rewards): one row per grant, N units of 30 days each. lib/billing/free-days.ts decides how a grant applies; lib/billing/free-days-credits.ts grants its credits (key grant:<id>:<k>).';

create index if not exists plan_grants_user_idx on public.plan_grants (user_id, created_at desc);
create index if not exists plan_grants_applied_idx on public.plan_grants (ends_at) where status = 'applied';

alter table public.plan_grants enable row level security;

drop policy if exists "Users read their own plan grants" on public.plan_grants;
create policy "Users read their own plan grants"
  on public.plan_grants for select
  using (auth.uid() = user_id);

revoke all on table public.plan_grants from public, anon, authenticated, service_role;
grant select (id, tier, units, source, applied_as, starts_at, ends_at, status, created_at)
  on table public.plan_grants to authenticated;
grant select, insert, update, delete on table public.plan_grants to service_role;

-- Convert the comps in place today (0060's overlay) into grants. Runs once:
-- a user who already has a grant row is left alone.
insert into public.plan_grants
  (user_id, tier, units, source, note, applied_as, starts_at, ends_at, credits_from, status)
select
  p.id,
  p.comp_tier,
  case
    when p.comp_expires_at is null then null
    else greatest(1, ceil(extract(epoch from (p.comp_expires_at - now())) / (30 * 86400))::integer)
  end,
  'comp',
  'Converted from the comp in place before migration 0176',
  'overlay',
  now(),
  p.comp_expires_at,
  -- The calendar-month refill already granted this month: the first 30-day
  -- allotment lands on the first of next month (UTC).
  (date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc',
  'applied'
from public.profiles p
where p.comp_tier in ('plus', 'pro')
  and (p.comp_expires_at is null or p.comp_expires_at > now())
  -- An admin has every perk and unlimited credits: no grant to convert.
  and coalesce(p.is_admin, false) = false
  and not exists (select 1 from public.plan_grants g where g.user_id = p.id);

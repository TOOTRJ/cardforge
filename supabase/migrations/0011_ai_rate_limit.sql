-- Phase 9 hardening — per-user rate limit for the AI assistant.
-- Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP.
--
-- One row = one AI call by a user. We don't store the request body — only
-- the bare timestamp + user id + action label is needed for windowed counts.
-- The two indexes target the two windows the route handler enforces:
--   - last 60 seconds  (per-minute cap)
--   - last 24 hours    (per-day cap)
--
-- A scheduled cron (out of scope for this migration) can periodically prune
-- rows older than 24h to keep the table small; for now, growth is bounded
-- by the daily-per-user cap.

create table if not exists public.card_ai_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (
    action in (
      'improve_wording',
      'suggest_cost',
      'suggest_rarity',
      'generate_flavor',
      'generate_art_prompt',
      'check_balance',
      'generate_from_concept'
    )
  ),
  created_at timestamptz not null default now()
);

create index if not exists card_ai_calls_user_created_idx
  on public.card_ai_calls (user_id, created_at desc);

alter table public.card_ai_calls enable row level security;

drop policy if exists "Users can see their own AI calls" on public.card_ai_calls;
drop policy if exists "Users can log their own AI calls" on public.card_ai_calls;

-- Users can read only their own usage history. This isn't surfaced in the
-- UI today, but a future "AI usage" pane is easier with this in place, and
-- it scopes the audit trail to the owner.
create policy "Users can see their own AI calls"
  on public.card_ai_calls
  for select
  using (auth.uid() = user_id);

-- Inserts are owner-only. The route handler runs with the user's session
-- (anon key + cookies), so this policy is the real enforcer — a logged-in
-- attacker can't log a call against someone else's quota.
create policy "Users can log their own AI calls"
  on public.card_ai_calls
  for insert
  with check (auth.uid() = user_id);

-- No update/delete policies — once logged, calls are immutable history.
-- (Lack of policy = no access under RLS.)

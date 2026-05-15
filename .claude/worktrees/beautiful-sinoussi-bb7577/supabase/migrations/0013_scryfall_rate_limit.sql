-- Phase 10 — per-user rate limit for the Scryfall proxy.
-- Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP.
--
-- Mirrors `card_ai_calls` from migration 0011. Separate table because:
--   - the action enum is different (search/named/import_art vs. AI actions)
--   - the per-window caps are different (search is cheap, AI is expensive)
--   - keeping them apart makes future audit / "AI usage vs Scryfall usage"
--     panes easier to read

create table if not exists public.scryfall_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (action in ('search', 'named', 'import_art')),
  created_at timestamptz not null default now()
);

create index if not exists scryfall_calls_user_created_idx
  on public.scryfall_calls (user_id, created_at desc);

alter table public.scryfall_calls enable row level security;

drop policy if exists "Users can see their own Scryfall calls" on public.scryfall_calls;
drop policy if exists "Users can log their own Scryfall calls" on public.scryfall_calls;

-- Users can read only their own usage history. Not surfaced today, but a
-- future "Scryfall usage" pane is easier with this in place.
create policy "Users can see their own Scryfall calls"
  on public.scryfall_calls
  for select
  using (auth.uid() = user_id);

-- Inserts are owner-only. The route handler runs with the user's session
-- (anon key + cookies), so this policy is the real enforcer.
create policy "Users can log their own Scryfall calls"
  on public.scryfall_calls
  for insert
  with check (auth.uid() = user_id);

-- No update/delete policies — immutable audit history.

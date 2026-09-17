-- 0093_deck_idea_batches.sql — "Get theme ideas" batches for decks are kept
-- (owner decision 2026-09-17), the deck twin of card_idea_batches (0092):
-- one credit buys three deck concepts, and a closed tab used to lose them.
-- Owner-only rows; the app inserts them right after generation.

create table if not exists public.deck_idea_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  request jsonb not null default '{}'::jsonb,
  ideas jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists deck_idea_batches_owner_created_idx
  on public.deck_idea_batches (owner_id, created_at desc);

alter table public.deck_idea_batches enable row level security;

drop policy if exists "Deck idea batches: owner read" on public.deck_idea_batches;
create policy "Deck idea batches: owner read"
  on public.deck_idea_batches for select
  using (auth.uid() = owner_id);

drop policy if exists "Deck idea batches: owner insert" on public.deck_idea_batches;
create policy "Deck idea batches: owner insert"
  on public.deck_idea_batches for insert
  with check (auth.uid() = owner_id);

grant select, insert on public.deck_idea_batches to authenticated;

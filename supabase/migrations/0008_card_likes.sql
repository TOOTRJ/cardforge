-- Phase 6 — card_likes: per-user heart/favorite on a card.
-- Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP.
--
-- One row = one user liking one card. The unique constraint on
-- (user_id, card_id) lets us treat insert/delete as a toggle without
-- worrying about races (the client retries on a conflict by deleting
-- instead). RLS is permissive on SELECT (anyone can see who liked what,
-- and counts work for anonymous viewers) but write access is owner-only.

create table if not exists public.card_likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, card_id)
);

create index if not exists card_likes_card_id_idx
  on public.card_likes (card_id);
create index if not exists card_likes_user_id_idx
  on public.card_likes (user_id);

alter table public.card_likes enable row level security;

drop policy if exists "Card likes are publicly readable" on public.card_likes;
drop policy if exists "Users can like cards" on public.card_likes;
drop policy if exists "Users can unlike their own likes" on public.card_likes;

-- Reads are public so anonymous viewers can see like counts on the
-- gallery. Only readable cards' likes matter (cards table RLS still
-- filters which cards are visible).
create policy "Card likes are publicly readable"
  on public.card_likes
  for select
  using (true);

-- Authenticated users can like any card they can read. The cards-table
-- RLS already filters out private cards belonging to others, so a user
-- can't like a card they can't see (the cited card_id won't exist for
-- them in the cards relation, and the policy's existence check fails).
create policy "Users can like cards"
  on public.card_likes
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.cards c
      where c.id = card_id
    )
  );

create policy "Users can unlike their own likes"
  on public.card_likes
  for delete
  using (auth.uid() = user_id);

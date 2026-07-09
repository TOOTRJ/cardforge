-- 0055_decks.sql — decks + deck_cards + deck_likes.
--
-- A deck is an ordered, quantity-aware list of MTG cards in a chosen play
-- format. Unlike card_sets (1× membership of the owner's own cards), a deck
-- entry can reference a REAL card (Scryfall data denormalized onto the row)
-- and/or one of the owner's custom cards (card_id = the "remixed proxy").
-- Entry states are derived, no status column:
--   * scryfall_id set, card_id null  → real card, needs remix
--   * scryfall_id set, card_id set   → remixed
--   * card_id set, scryfall_id null  → custom-only entry
--   * both null                      → unresolved import placeholder (name only)
-- Deleting a custom card SET NULLs card_id, cleanly reverting the entry to
-- "needs remix" with its Scryfall data intact.
--
-- Structure mirrors 0009_card_sets (visibility model + RLS shape),
-- 0023_set_likes (likes), 0042/0043 (view counter RPC + likes_count trigger).
-- Ships through a PR; never applied ad-hoc.

-- ===========================================================================
-- decks
-- ===========================================================================

create table if not exists public.decks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  -- Globally unique (unlike card_sets' per-owner slugs) so /deck/[slug] can
  -- never be ambiguous across owners. Collisions are resolved app-side with
  -- a numeric-suffix retry on the unique violation.
  slug text not null unique,
  description text,
  format text not null default 'commander',
  visibility text not null default 'private',
  cover_url text,
  likes_count integer not null default 0,
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint decks_title_length
    check (char_length(title) between 1 and 120),
  constraint decks_slug_format
    check (
      char_length(slug) between 1 and 80
      and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),
  constraint decks_description_length
    check (description is null or char_length(description) <= 2000),
  constraint decks_format_valid
    check (format in (
      'commander', 'standard', 'pioneer', 'modern', 'legacy', 'vintage',
      'pauper', 'brawl', 'standard_brawl', 'oathbreaker', 'limited', 'casual'
    )),
  constraint decks_visibility_valid
    check (visibility in ('private', 'unlisted', 'public')),
  constraint decks_cover_url_length
    check (cover_url is null or char_length(cover_url) <= 2048)
);

comment on table public.decks is
  'MTG decks: quantity-aware card lists in a play format. Entries live in deck_cards.';
comment on column public.decks.likes_count is
  'Materialized like tally, synced by the deck_likes AFTER INSERT/DELETE triggers (see below).';
comment on column public.decks.view_count is
  'Lifetime detail-page view tally, bumped by increment_deck_view (excludes owner views, best-effort).';

create index if not exists decks_owner_id_idx
  on public.decks (owner_id, updated_at desc);

create index if not exists decks_public_idx
  on public.decks (visibility, updated_at desc)
  where visibility = 'public';

create index if not exists decks_likes_count_idx
  on public.decks (likes_count desc);

create or replace function public.set_decks_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists decks_set_updated_at on public.decks;
create trigger decks_set_updated_at
  before update on public.decks
  for each row execute function public.set_decks_updated_at();

alter table public.decks enable row level security;

drop policy if exists "Decks: public + unlisted readable, private by owner" on public.decks;
drop policy if exists "Decks: owners can insert" on public.decks;
drop policy if exists "Decks: owners can update" on public.decks;
drop policy if exists "Decks: owners can delete" on public.decks;

create policy "Decks: public + unlisted readable, private by owner"
  on public.decks
  for select
  using (
    visibility in ('public', 'unlisted')
    or auth.uid() = owner_id
  );

create policy "Decks: owners can insert"
  on public.decks
  for insert
  with check (auth.uid() = owner_id);

create policy "Decks: owners can update"
  on public.decks
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Decks: owners can delete"
  on public.decks
  for delete
  using (auth.uid() = owner_id);

-- ===========================================================================
-- deck_cards: one row = one (card, board) entry with a quantity.
-- ===========================================================================

create table if not exists public.deck_cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks (id) on delete cascade,
  board text not null default 'main',
  quantity integer not null default 1,
  position integer not null default 0,
  -- The owner's custom card standing in for this entry (nullable; SET NULL
  -- on card deletion reverts the entry to "needs remix").
  card_id uuid references public.cards (id) on delete set null,
  -- Denormalized Scryfall identity + display fields, captured at import time
  -- so lists and analytics never re-fetch. name is always present — it's the
  -- one field even an unresolved placeholder line has.
  scryfall_id text,
  name text not null,
  set_code text,
  collector_number text,
  type_line text,
  mana_cost text,
  mana_value numeric(6, 2),
  color_identity text[] not null default '{}',
  rarity text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deck_cards_board_valid
    check (board in ('main', 'side', 'maybe', 'commander', 'companion')),
  constraint deck_cards_quantity_range
    check (quantity between 1 and 250),
  constraint deck_cards_name_length
    check (char_length(name) between 1 and 200),
  constraint deck_cards_scryfall_id_length
    check (scryfall_id is null or char_length(scryfall_id) <= 64),
  constraint deck_cards_set_code_length
    check (set_code is null or char_length(set_code) <= 10),
  constraint deck_cards_collector_number_length
    check (collector_number is null or char_length(collector_number) <= 20),
  constraint deck_cards_type_line_length
    check (type_line is null or char_length(type_line) <= 300),
  constraint deck_cards_mana_cost_length
    check (mana_cost is null or char_length(mana_cost) <= 100),
  constraint deck_cards_color_identity_valid
    check (color_identity <@ array['W', 'U', 'B', 'R', 'G']::text[]),
  constraint deck_cards_image_url_length
    check (image_url is null or char_length(image_url) <= 2048)
);

comment on table public.deck_cards is
  'Deck entries. scryfall_id = the real card (WUBRG-letter color_identity, Scryfall conventions); card_id = the owner''s custom proxy. See 0055 header for the derived entry states.';

create index if not exists deck_cards_deck_id_idx
  on public.deck_cards (deck_id, board, position);

create index if not exists deck_cards_card_id_idx
  on public.deck_cards (card_id)
  where card_id is not null;

drop trigger if exists deck_cards_set_updated_at on public.deck_cards;
create trigger deck_cards_set_updated_at
  before update on public.deck_cards
  for each row execute function public.set_decks_updated_at();

alter table public.deck_cards enable row level security;

drop policy if exists "Deck cards: visible when parent deck is readable" on public.deck_cards;
drop policy if exists "Deck cards: owners can insert" on public.deck_cards;
drop policy if exists "Deck cards: owners can update" on public.deck_cards;
drop policy if exists "Deck cards: owners can delete" on public.deck_cards;

-- Visibility piggybacks on the parent deck's RLS — anyone who can read the
-- deck can see what's inside it. (Also satisfies the SELECT policy an
-- .upsert() needs to read back conflict rows.)
create policy "Deck cards: visible when parent deck is readable"
  on public.deck_cards
  for select
  using (
    exists (
      select 1
      from public.decks d
      where d.id = deck_id
        and (d.visibility in ('public', 'unlisted') or d.owner_id = auth.uid())
    )
  );

-- Writes require owning the deck; linking a custom card additionally
-- requires owning that card (real-card entries have card_id null, so the
-- second clause no-ops for them).
create policy "Deck cards: owners can insert"
  on public.deck_cards
  for insert
  with check (
    exists (
      select 1
      from public.decks d
      where d.id = deck_id
        and d.owner_id = auth.uid()
    )
    and (
      card_id is null
      or exists (
        select 1
        from public.cards c
        where c.id = card_id
          and c.owner_id = auth.uid()
      )
    )
  );

create policy "Deck cards: owners can update"
  on public.deck_cards
  for update
  using (
    exists (
      select 1
      from public.decks d
      where d.id = deck_id
        and d.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.decks d
      where d.id = deck_id
        and d.owner_id = auth.uid()
    )
    and (
      card_id is null
      or exists (
        select 1
        from public.cards c
        where c.id = card_id
          and c.owner_id = auth.uid()
      )
    )
  );

create policy "Deck cards: owners can delete"
  on public.deck_cards
  for delete
  using (
    exists (
      select 1
      from public.decks d
      where d.id = deck_id
        and d.owner_id = auth.uid()
    )
  );

-- ===========================================================================
-- deck_likes: per-user heart on a deck (mirrors 0023_set_likes).
-- ===========================================================================

create table if not exists public.deck_likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  deck_id uuid not null references public.decks (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, deck_id)
);

create index if not exists deck_likes_deck_id_idx on public.deck_likes (deck_id);
create index if not exists deck_likes_user_id_idx on public.deck_likes (user_id);

alter table public.deck_likes enable row level security;

drop policy if exists "Deck likes are publicly readable" on public.deck_likes;
drop policy if exists "Users can like decks" on public.deck_likes;
drop policy if exists "Users can unlike their own deck likes" on public.deck_likes;

create policy "Deck likes are publicly readable"
  on public.deck_likes
  for select
  using (true);

-- Authenticated users may like any deck they can read. The decks RLS already
-- filters private decks belonging to others; this `exists` check enforces
-- that gating at write time as well.
create policy "Users can like decks"
  on public.deck_likes
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.decks d
      where d.id = deck_id
    )
  );

create policy "Users can unlike their own deck likes"
  on public.deck_likes
  for delete
  using (auth.uid() = user_id);

-- Keep decks.likes_count in exact sync (same posture as 0043: SECURITY
-- DEFINER so a liker who isn't the deck owner can bump the counter past the
-- decks UPDATE RLS policy).
create or replace function public.sync_deck_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.decks
      set likes_count = likes_count + 1
      where id = new.deck_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.decks
      set likes_count = greatest(likes_count - 1, 0)
      where id = old.deck_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists deck_likes_count_insert on public.deck_likes;
create trigger deck_likes_count_insert
  after insert on public.deck_likes
  for each row execute function public.sync_deck_likes_count();

drop trigger if exists deck_likes_count_delete on public.deck_likes;
create trigger deck_likes_count_delete
  after delete on public.deck_likes
  for each row execute function public.sync_deck_likes_count();

-- ===========================================================================
-- View counter RPC (mirrors 0042's increment_card_view).
-- ===========================================================================

create or replace function public.increment_deck_view(p_deck_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.decks set view_count = view_count + 1 where id = p_deck_id;
$$;

revoke all on function public.increment_deck_view(uuid) from public;
grant execute on function public.increment_deck_view(uuid) to anon, authenticated;

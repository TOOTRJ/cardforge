-- Migration: 0019_v2_compat
--
-- Additive only. Three Scryfall-parity columns on `cards` and a new
-- `card_comments` table for the public gallery social feature.
--
-- Why these columns:
--   oracle_text  — mirror of rules_text using Scryfall's canonical name.
--                  Kept in sync via app code (NO trigger — server actions
--                  write both columns). Length matches rules_text (4000).
--   mana_value   — Scryfall's `cmc` (converted mana cost) for filter/sort.
--   layout       — normal, split, flip, transform, modal_dfc, saga, planar,
--                  etc. Defaults to 'normal' so existing rows stay valid.
--
-- We deliberately do NOT add a separate `scryfall_id` column — the existing
-- `source_scryfall_id text` (added in 0016_scryfall_source) already records
-- the source card id when imported. Adding a UUID-typed sibling would just
-- create two columns for the same fact.

-- ===========================================================================
-- cards — additive columns + index
-- ===========================================================================

alter table public.cards
  add column if not exists oracle_text text,
  add column if not exists mana_value numeric(4,2),
  add column if not exists layout text not null default 'normal';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cards_oracle_text_length'
  ) then
    alter table public.cards
      add constraint cards_oracle_text_length check (
        oracle_text is null or char_length(oracle_text) <= 4000
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cards_layout_valid'
  ) then
    alter table public.cards
      add constraint cards_layout_valid check (
        layout in (
          'normal', 'split', 'flip', 'transform', 'modal_dfc',
          'meld', 'leveler', 'saga', 'adventure', 'planar', 'scheme',
          'vanguard', 'token', 'double_faced_token', 'emblem',
          'augment', 'host', 'art_series', 'reversible_card', 'class',
          'case', 'mutate', 'prototype'
        )
      );
  end if;
end $$;

create index if not exists cards_visibility_created_at_idx
  on public.cards (visibility, created_at desc);

-- ===========================================================================
-- card_comments — public gallery comments
-- ===========================================================================

create table if not exists public.card_comments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_comments_body_length check (
    char_length(body) between 1 and 2000
  )
);

create index if not exists card_comments_card_id_created_at_idx
  on public.card_comments (card_id, created_at desc);

create index if not exists card_comments_author_id_idx
  on public.card_comments (author_id);

-- updated_at trigger (same hardened pattern as cards/profiles).
create or replace function public.set_card_comments_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists card_comments_set_updated_at on public.card_comments;
create trigger card_comments_set_updated_at
  before update on public.card_comments
  for each row execute function public.set_card_comments_updated_at();

-- ===========================================================================
-- RLS — card_comments
-- ===========================================================================

alter table public.card_comments enable row level security;

drop policy if exists "Comments: readable on public cards or by author"
  on public.card_comments;
drop policy if exists "Comments: authors insert their own"
  on public.card_comments;
drop policy if exists "Comments: authors update their own"
  on public.card_comments;
drop policy if exists "Comments: authors delete their own"
  on public.card_comments;

-- Anyone may read comments on a public card; private/unlisted card
-- comments are only readable by the comment author. (Cards RLS still
-- filters which cards exist for any given viewer.)
create policy "Comments: readable on public cards or by author"
  on public.card_comments
  for select
  using (
    exists (
      select 1
      from public.cards c
      where c.id = card_id and c.visibility = 'public'
    )
    or author_id = auth.uid()
  );

create policy "Comments: authors insert their own"
  on public.card_comments
  for insert
  with check (author_id = auth.uid());

create policy "Comments: authors update their own"
  on public.card_comments
  for update
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy "Comments: authors delete their own"
  on public.card_comments
  for delete
  using (author_id = auth.uid());

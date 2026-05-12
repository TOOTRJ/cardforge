-- Phase 7 — card_sets + card_set_items.
-- Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP.
--
-- Cards organized into curated collections (worlds, decks, fan sets).
-- Same visibility model as cards: private (owner-only), unlisted (link-
-- shareable, not in listings), public (in listings).

-- ===========================================================================
-- card_sets
-- ===========================================================================

create table if not exists public.card_sets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  slug text not null,
  description text,
  cover_url text,
  visibility text not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_sets_title_length
    check (char_length(title) between 1 and 120),
  constraint card_sets_slug_format
    check (
      char_length(slug) between 1 and 80
      and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),
  constraint card_sets_description_length
    check (description is null or char_length(description) <= 1000),
  constraint card_sets_cover_url_length
    check (cover_url is null or char_length(cover_url) <= 2048),
  constraint card_sets_visibility_valid
    check (visibility in ('private', 'unlisted', 'public')),
  unique (owner_id, slug)
);

create index if not exists card_sets_owner_id_idx
  on public.card_sets (owner_id, updated_at desc);

create index if not exists card_sets_public_idx
  on public.card_sets (visibility, updated_at desc)
  where visibility = 'public';

-- updated_at trigger (hardened pattern from earlier migrations)
create or replace function public.set_card_sets_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists card_sets_set_updated_at on public.card_sets;
create trigger card_sets_set_updated_at
  before update on public.card_sets
  for each row execute function public.set_card_sets_updated_at();

alter table public.card_sets enable row level security;

drop policy if exists "Card sets: public + unlisted readable, private by owner" on public.card_sets;
drop policy if exists "Card sets: owners can insert" on public.card_sets;
drop policy if exists "Card sets: owners can update" on public.card_sets;
drop policy if exists "Card sets: owners can delete" on public.card_sets;

create policy "Card sets: public + unlisted readable, private by owner"
  on public.card_sets
  for select
  using (
    visibility in ('public', 'unlisted')
    or auth.uid() = owner_id
  );

create policy "Card sets: owners can insert"
  on public.card_sets
  for insert
  with check (auth.uid() = owner_id);

create policy "Card sets: owners can update"
  on public.card_sets
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Card sets: owners can delete"
  on public.card_sets
  for delete
  using (auth.uid() = owner_id);

-- ===========================================================================
-- card_set_items: join table; one row = one card in one set.
-- ===========================================================================

create table if not exists public.card_set_items (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.card_sets (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (set_id, card_id)
);

create index if not exists card_set_items_set_id_idx
  on public.card_set_items (set_id, position);

create index if not exists card_set_items_card_id_idx
  on public.card_set_items (card_id);

alter table public.card_set_items enable row level security;

drop policy if exists "Card set items: visible when parent set is readable" on public.card_set_items;
drop policy if exists "Card set items: owners can insert" on public.card_set_items;
drop policy if exists "Card set items: owners can update" on public.card_set_items;
drop policy if exists "Card set items: owners can delete" on public.card_set_items;

-- Visibility piggybacks on the parent set's RLS — anyone who can read the
-- set can see what's inside it.
create policy "Card set items: visible when parent set is readable"
  on public.card_set_items
  for select
  using (
    exists (
      select 1
      from public.card_sets s
      where s.id = set_id
        and (s.visibility in ('public', 'unlisted') or s.owner_id = auth.uid())
    )
  );

-- A user can add a card to one of their sets only when they own BOTH the
-- set and the card. (Cards table RLS additionally restricts which cards
-- the user can read, but the explicit owner check here makes intent
-- obvious.)
create policy "Card set items: owners can insert"
  on public.card_set_items
  for insert
  with check (
    exists (
      select 1
      from public.card_sets s
      where s.id = set_id
        and s.owner_id = auth.uid()
    )
    and exists (
      select 1
      from public.cards c
      where c.id = card_id
        and c.owner_id = auth.uid()
    )
  );

create policy "Card set items: owners can update"
  on public.card_set_items
  for update
  using (
    exists (
      select 1
      from public.card_sets s
      where s.id = set_id
        and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.card_sets s
      where s.id = set_id
        and s.owner_id = auth.uid()
    )
  );

create policy "Card set items: owners can delete"
  on public.card_set_items
  for delete
  using (
    exists (
      select 1
      from public.card_sets s
      where s.id = set_id
        and s.owner_id = auth.uid()
    )
  );

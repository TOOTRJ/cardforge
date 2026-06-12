-- Community Phase 1 — design challenges (lean v1).
--
-- A challenge is a brief + a submission TAG. Entering = publishing a card
-- that wears the tag (no new join table); voting = the existing card likes;
-- the entries grid is the existing public-cards query filtered by tag. This
-- keeps the whole system riding tables that already exist.
--
-- Writes are admin-only for v1 (profiles.is_admin) — challenges are
-- authored by the team; an admin UI can come later.

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  title text not null check (char_length(title) between 3 and 120),
  -- The design brief shown on the challenge page.
  description text not null check (char_length(description) between 10 and 2000),
  -- Cards wearing this tag (cards.tags) count as entries. Tag charset
  -- mirrors the card-tag normalization (lowercase alnum + hyphens).
  tag text not null check (tag ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$'),
  hero_image_url text check (char_length(hero_image_url) <= 2048),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  -- Featured = surfaced on the gallery banner + challenges page hero.
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists challenges_featured_window_idx
  on public.challenges (featured, starts_at, ends_at);

-- ===========================================================================
-- RLS — public read, admin-only writes
-- ===========================================================================

alter table public.challenges enable row level security;

drop policy if exists "Challenges are readable by everyone" on public.challenges;
drop policy if exists "Admins can insert challenges" on public.challenges;
drop policy if exists "Admins can update challenges" on public.challenges;
drop policy if exists "Admins can delete challenges" on public.challenges;

create policy "Challenges are readable by everyone"
  on public.challenges
  for select
  using (true);

create policy "Admins can insert challenges"
  on public.challenges
  for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin
    )
  );

create policy "Admins can update challenges"
  on public.challenges
  for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin
    )
  );

create policy "Admins can delete challenges"
  on public.challenges
  for delete
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin
    )
  );

-- ===========================================================================
-- Seed — the launch challenge (from the PipGlyph design mockups)
-- ===========================================================================

insert into public.challenges (slug, title, description, tag, starts_at, ends_at, featured)
values (
  'arcane-frontiers',
  'Arcane Frontiers',
  'Explore the unknown. Design a card that pushes the boundaries of magic and technology — an artifact creature, a spell that bends the rules, a place where ley lines meet circuitry. Show us what lies beyond. Publish your card with the challenge tag to enter; the community''s likes decide the spotlight.',
  'arcane-frontiers',
  now(),
  now() + interval '14 days',
  true
)
on conflict (slug) do nothing;

-- Phase 3 — Card Data Model
-- game_systems, card_templates, cards + RLS + indexes + seeds.
-- Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP.

-- ===========================================================================
-- game_systems: pluggable rule/theme systems. MVP ships one (fantasy).
-- ===========================================================================

create table if not exists public.game_systems (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint game_systems_key_format
    check (key ~ '^[a-z0-9_]+$' and char_length(key) between 2 and 64)
);

alter table public.game_systems enable row level security;

drop policy if exists "Game systems are publicly readable" on public.game_systems;
create policy "Game systems are publicly readable"
  on public.game_systems
  for select
  using (is_active);

-- ===========================================================================
-- card_templates: visual layouts within a game system.
-- ===========================================================================

create table if not exists public.card_templates (
  id uuid primary key default gen_random_uuid(),
  game_system_id uuid not null references public.game_systems (id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint card_templates_key_format
    check (key ~ '^[a-z0-9_]+$' and char_length(key) between 2 and 64),
  unique (game_system_id, key)
);

create index if not exists card_templates_game_system_id_idx
  on public.card_templates (game_system_id);

alter table public.card_templates enable row level security;

drop policy if exists "Card templates are publicly readable" on public.card_templates;
create policy "Card templates are publicly readable"
  on public.card_templates
  for select
  using (is_active);

-- ===========================================================================
-- cards: structured card records (MVP fields per Phase 0 spec).
-- ===========================================================================

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  slug text not null,
  game_system_id uuid not null references public.game_systems (id) on delete restrict,
  template_id uuid references public.card_templates (id) on delete set null,

  -- Core MVP fields
  cost text,
  color_identity text[] not null default '{}',
  supertype text,
  card_type text,
  subtypes text[] not null default '{}',
  rarity text,
  rules_text text,
  flavor_text text,
  power text,
  toughness text,
  loyalty text,
  defense text,

  -- Art + render
  artist_credit text,
  art_url text,
  art_position jsonb not null default '{}'::jsonb,
  frame_style jsonb not null default '{}'::jsonb,

  -- Sharing + remix lineage
  visibility text not null default 'private',
  parent_card_id uuid references public.cards (id) on delete set null,

  -- Forward-compatible blob for template-specific extras
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Validation constraints
  constraint cards_title_length
    check (char_length(title) between 1 and 120),
  constraint cards_slug_format
    check (
      char_length(slug) between 1 and 80
      and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),
  constraint cards_visibility_valid
    check (visibility in ('private', 'unlisted', 'public')),
  constraint cards_rarity_valid
    check (rarity is null or rarity in ('common', 'uncommon', 'rare', 'mythic')),
  constraint cards_card_type_valid
    check (
      card_type is null
      or card_type in ('creature', 'spell', 'artifact', 'enchantment', 'land', 'token')
    ),
  constraint cards_color_identity_values_valid
    check (
      color_identity <@ array['white', 'blue', 'black', 'red', 'green', 'colorless', 'multicolor']::text[]
    ),
  constraint cards_cost_length check (cost is null or char_length(cost) <= 64),
  constraint cards_rules_text_length check (rules_text is null or char_length(rules_text) <= 4000),
  constraint cards_flavor_text_length check (flavor_text is null or char_length(flavor_text) <= 1000),
  constraint cards_power_length check (power is null or char_length(power) <= 16),
  constraint cards_toughness_length check (toughness is null or char_length(toughness) <= 16),
  constraint cards_loyalty_length check (loyalty is null or char_length(loyalty) <= 16),
  constraint cards_defense_length check (defense is null or char_length(defense) <= 16),
  constraint cards_artist_credit_length check (artist_credit is null or char_length(artist_credit) <= 120),
  constraint cards_art_url_length check (art_url is null or char_length(art_url) <= 2048),
  constraint cards_supertype_length check (supertype is null or char_length(supertype) <= 64),
  constraint cards_subtypes_count check (array_length(subtypes, 1) is null or array_length(subtypes, 1) <= 10),

  -- Slug is unique per owner (so two users can each have "/card/lich-king").
  unique (owner_id, slug)
);

create index if not exists cards_owner_id_idx
  on public.cards (owner_id);

create index if not exists cards_visibility_updated_at_idx
  on public.cards (visibility, updated_at desc)
  where visibility = 'public';

create index if not exists cards_parent_card_id_idx
  on public.cards (parent_card_id)
  where parent_card_id is not null;

create index if not exists cards_game_system_id_idx
  on public.cards (game_system_id);

create index if not exists cards_template_id_idx
  on public.cards (template_id)
  where template_id is not null;

-- updated_at trigger (same hardened pattern as profiles)
create or replace function public.set_cards_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at
  before update on public.cards
  for each row execute function public.set_cards_updated_at();

-- ===========================================================================
-- RLS — cards
-- ===========================================================================

alter table public.cards enable row level security;

drop policy if exists "Cards: public + unlisted readable, private only by owner" on public.cards;
drop policy if exists "Cards: owners can insert their own cards" on public.cards;
drop policy if exists "Cards: owners can update their own cards" on public.cards;
drop policy if exists "Cards: owners can delete their own cards" on public.cards;

-- Public + unlisted are world-readable (unlisted is "public via direct link").
-- Private cards are visible only to their owner.
create policy "Cards: public + unlisted readable, private only by owner"
  on public.cards
  for select
  using (
    visibility in ('public', 'unlisted')
    or auth.uid() = owner_id
  );

create policy "Cards: owners can insert their own cards"
  on public.cards
  for insert
  with check (auth.uid() = owner_id);

create policy "Cards: owners can update their own cards"
  on public.cards
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Cards: owners can delete their own cards"
  on public.cards
  for delete
  using (auth.uid() = owner_id);

-- ===========================================================================
-- Seed data
-- ===========================================================================

insert into public.game_systems (key, name, description)
values (
  'fantasy',
  'Fantasy Cards',
  'The MVP fantasy-card system. Original generic frames inspired by classic tabletop card games — no proprietary symbols, fonts, or set marks.'
)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description;

insert into public.card_templates (game_system_id, key, name, description, config)
select gs.id, t.key, t.name, t.description, t.config::jsonb
from public.game_systems gs
cross join (
  values
    (
      'fantasy_creature',
      'Fantasy Creature',
      'Creature card with cost, type line, rules text, and power/toughness.',
      '{"showsPower": true, "showsToughness": true, "showsLoyalty": false, "showsDefense": false}'
    ),
    (
      'fantasy_spell',
      'Fantasy Spell',
      'Instant or sorcery-style spell card with cost and rules text.',
      '{"showsPower": false, "showsToughness": false, "showsLoyalty": false, "showsDefense": false}'
    ),
    (
      'fantasy_artifact',
      'Fantasy Artifact',
      'Permanent artifact card with cost, type line, and abilities.',
      '{"showsPower": false, "showsToughness": false, "showsLoyalty": false, "showsDefense": false}'
    ),
    (
      'fantasy_land',
      'Fantasy Land',
      'Land card representing a place. No cost; produces resources via rules text.',
      '{"showsPower": false, "showsToughness": false, "showsLoyalty": false, "showsDefense": false, "hidesCost": true}'
    )
) as t(key, name, description, config)
where gs.key = 'fantasy'
on conflict (game_system_id, key) do update
set name = excluded.name,
    description = excluded.description,
    config = excluded.config;

# Phase 3 — Card Data Model

## Goal

Create the structured database model for cards, templates, game systems, and storage buckets.

## Scope

Build:

- card database tables
- game systems table
- card templates table
- card art storage bucket
- TypeScript card types
- Zod schemas
- server actions for create/read/update/delete cards
- ownership and visibility rules

## Database Tables

### game_systems

- id uuid primary key
- key text unique
- name text
- description text
- is_active boolean
- created_at timestamptz

Seed MVP system:

- key: `fantasy`
- name: `Fantasy Cards`

### card_templates

- id uuid primary key
- game_system_id uuid
- key text
- name text
- description text
- config jsonb
- is_active boolean
- created_at timestamptz

Seed MVP templates:

- `fantasy_creature`
- `fantasy_spell`
- `fantasy_artifact`
- `fantasy_land`

### cards

- id uuid primary key
- owner_id uuid references auth.users(id)
- title text
- slug text
- game_system_id uuid references game_systems(id)
- template_id uuid references card_templates(id)
- cost text
- color_identity text[]
- supertype text
- card_type text
- subtypes text[]
- rarity text
- rules_text text
- flavor_text text
- power text
- toughness text
- loyalty text
- defense text
- artist_credit text
- art_url text
- art_position jsonb
- frame_style jsonb
- visibility text check in ('private', 'public', 'unlisted')
- parent_card_id uuid references cards(id)
- metadata jsonb
- created_at timestamptz
- updated_at timestamptz

Unique recommended:

- owner_id + slug

## RLS

Cards:

- Public cards readable by everyone.
- Unlisted cards readable by direct link if implemented later.
- Private cards readable only by owner.
- Users can insert/update/delete only their own cards.

## TypeScript

Create:

- `types/card.ts`
- `lib/validation/card.ts`
- `lib/cards/queries.ts`
- `lib/cards/actions.ts`

## Acceptance Criteria

- Migrations exist.
- Seed data exists.
- RLS exists.
- TypeScript types exist.
- Zod schemas exist.
- Server actions can create/update/delete card records.
- No UI editor yet beyond basic test/dev form if needed.
- Build passes.

## Claude Instruction

Implement Phase 3 only. Focus on durable schema and safe server actions. Do not build full editor UI yet.

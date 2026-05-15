# Phase 7 — Custom Sets MVP

## Goal

Allow users to organize cards into custom sets and publish those sets.

## Scope

Build:

- create set
- edit set
- add/remove cards from set
- public set page
- set cover image
- basic set analytics

## Database Tables

### card_sets

- id uuid primary key
- owner_id uuid references auth.users(id)
- title text
- slug text
- description text
- cover_url text
- visibility text check in ('private', 'public', 'unlisted')
- created_at timestamptz
- updated_at timestamptz

### card_set_items

- id uuid primary key
- set_id uuid references card_sets(id)
- card_id uuid references cards(id)
- position int
- created_at timestamptz

Unique:

- set_id + card_id

## Pages

Create/update:

- `/sets`
- `/sets/new`
- `/set/[slug]`
- `/set/[slug]/edit`

## Analytics

Show simple stats:

- total cards
- color identity counts
- type counts
- rarity counts
- average cost if parseable

## Acceptance Criteria

- User can create a set.
- User can add their own cards to a set.
- User can remove cards from a set.
- Public set pages work.
- Private set protection works.
- Basic analytics display.
- Build passes.

## Claude Instruction

Implement Phase 7 only. Do not build collaboration, comments, or draft simulator.

-- Phase 11 chunk 13 — Scryfall source tracking.
--
-- Adds an optional `source_scryfall_id` column to `cards` that records
-- the Scryfall UUID a card was imported from. Set when the user pulls a
-- card via /api/scryfall/named (the import dialog) and persists across
-- saves. Cards forged from scratch (no Scryfall seed) keep this column
-- as `null`.
--
-- The partial index speeds up the two queries this column powers:
--   - `count(*) WHERE source_scryfall_id = $1` for "also remixed by N"
--   - `WHERE source_scryfall_id = $1` for the gallery's ?source filter
-- Filtering by `IS NOT NULL` keeps the index small (it skips every
-- forged-from-scratch row).

alter table public.cards
  add column if not exists source_scryfall_id text;

create index if not exists cards_source_scryfall_id_idx
  on public.cards (source_scryfall_id)
  where source_scryfall_id is not null;

comment on column public.cards.source_scryfall_id is
  'Scryfall UUID this card was imported from. Null for cards forged from scratch.';

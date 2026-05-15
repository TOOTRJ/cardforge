-- Migration: 0011_card_types_mtg
--
-- Expands the card_type check constraint to include all canonical MTG card
-- types that Spellwright now supports:
--   instant, sorcery, planeswalker, battle
--
-- The legacy value 'spell' is kept for backward compatibility with any rows
-- that were saved before the type-line refactor. New cards should use
-- 'instant' or 'sorcery' directly.
--
-- The approach: drop the existing named constraint and recreate it.
-- Supabase/Postgres requires this pattern when altering CHECK constraints.

alter table cards
  drop constraint if exists cards_card_type_valid;

alter table cards
  add constraint cards_card_type_valid check (
    card_type is null
    or card_type in (
      'creature',
      'instant',
      'sorcery',
      'artifact',
      'enchantment',
      'land',
      'planeswalker',
      'battle',
      'token',
      -- Legacy value — kept for backward compatibility
      'spell'
    )
  );

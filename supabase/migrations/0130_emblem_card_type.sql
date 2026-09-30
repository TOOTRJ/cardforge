-- 0130 — the emblem card type (TODO 6.23, with the emblem frame, 4.52).
--
-- CR 114: an emblem is a marker a planeswalker leaves behind. It has no
-- colour, mana cost, power / toughness, loyalty or rarity, and it prints
-- "Emblem" on a silver frame with the source planeswalker's name in the
-- title bar. The creator reaches it from the token kind's picker (owner
-- decision 2026-09-29: Emblem sits next to Creature / Artifact /
-- Enchantment there, not as its own kind chip), and an emblem is still
-- stored as its own card type: cards.card_type = 'emblem'. The app mirrors
-- the list in CARD_TYPE_VALUES (types/card.ts), which the zod enum in
-- lib/validation/card.ts reads; a unit test holds this CHECK to it.
--
-- cards_card_type_valid (0018) is dropped and added again with 'emblem'.
-- Widening a CHECK can't fail on existing rows: every stored card_type is
-- already in the old list, which is inside the new one. Adding the
-- constraint re-checks them under a brief lock on public.cards; the table is
-- small. The order of the list is 0018's, with 'emblem' after 'token'.
--
-- cards.layout already admits 'emblem' (0019 cards_layout_valid). The app
-- never writes that column (a token keeps 'normal' too): card_type is what
-- every reader — the kind, the frame gate, the type line, the hubs — goes
-- by, so an emblem leaves layout at its default.
--
-- Nothing else here reads the value: the gallery's card-type filter
-- (list_gallery_cards, 0086 / 0091) and the type hub counts (0108) take any
-- card_type as data, and card_capacity_for() (0104) counts every card.
--
-- NUMBERING: 0129 is the token text-box release's (round 11, merged in
-- #420). If a higher version merges first, this file is renumbered past it
-- before merge — Supabase's branching refuses a migration older than one
-- already applied.
--
-- Grants: none. This migration only replaces a CHECK constraint. It creates
-- no table or function and changes no grant, so the API roles keep exactly
-- the privileges they have on public.cards (0097).
--
-- Idempotent: the constraint is dropped if present and added again, so a
-- second run ends in the same state.
--
-- Ships through a PR; never applied ad-hoc.

alter table public.cards
  drop constraint if exists cards_card_type_valid;

alter table public.cards
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
      'emblem',
      -- Legacy value — kept for backward compatibility
      'spell'
    )
  );

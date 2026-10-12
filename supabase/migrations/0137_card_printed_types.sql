-- 0137_card_printed_types.sql — the words a card prints left of its type
-- line's dash, as its maker typed them (TODO 3b.16, owner 2026-10-09).
--
-- Until now a card's type line was BUILT at every render: `supertype` (every
-- type word but the card type's own) + the card type's word, put in printed
-- order (TODO 1.20, layout v50). The maker could not remove the card type's
-- word, nor set the words in an order of their own ("goblin Creature —
-- wizard" with no way to drop "Creature").
--
-- The creator's Types field is now ONE text pre-filled with the card type's
-- word. `printed_types` holds that text ONLY when it differs from the built
-- line (lib/cards/type-line-field.ts resolvePrintedTypes):
--
--   NULL   the line is built as before — every row that exists today, every
--          card whose maker left the field as it was filled, AI cards, an
--          import whose printing reads as the built line;
--   text   the words printed, in the maker's order ('' = the maker emptied
--          the field: the subtypes print alone). A token's fixed "Token" is
--          never part of it; an emblem never stores one.
--
-- Why a column and not a rule over `supertype`: no rule can tell "Goblin"
-- typed as a creature's WHOLE line from "Goblin" stored as the words beside
-- "Creature" (today's meaning, which every stored row keeps), and
-- `supertype` is what the P/T, the token frame, the crown and the DFC gates
-- read — it keeps that one meaning. What a card IS never reads this column.
--
-- No stored row changes: the column is added NULL and nothing is backfilled,
-- so every existing card prints exactly what it printed. No layout bump.
--
-- Not in search_vector (0086): a new card's typed words are in `supertype`
-- too, which is; only a line RE-WORDED on an edit is not searchable by its
-- new words.
--
-- Grants: none needed. `cards` is granted at TABLE level (0097: select to
-- anon, select / insert / update / delete to authenticated, all to
-- service_role), which covers a new column on every project, old or new;
-- RLS is unchanged (row-level). list_gallery_cards() returns `setof
-- public.cards`, so the column rides along with no new definition.
--
-- Ships through a PR; never applied ad-hoc. Idempotent.

alter table public.cards
  add column if not exists printed_types text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cards_printed_types_length'
      and conrelid = 'public.cards'::regclass
  ) then
    alter table public.cards
      add constraint cards_printed_types_length
      check (printed_types is null or char_length(printed_types) <= 80);
  end if;
end $$;

comment on column public.cards.printed_types is
  'The words printed left of the type line''s dash, as the maker typed them (TODO 3b.16): their order, with or without the card type''s word; '''' = emptied. NULL = the line is built from supertype + card_type in printed order (every card saved before 0137). A token''s "Token" prefix is not part of it. Display only: what the card IS reads card_type + supertype.';

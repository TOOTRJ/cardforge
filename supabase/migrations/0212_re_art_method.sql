-- 0212_re_art_method.sql — Re-art deck (beta tool `re-art-deck`, 0191): HOW a
-- card's picture was made.
--
-- A run can now start each picture from the card's own ART instead of from
-- the prompt alone (lib/tools/re-art/model.ts ReartMethod "restyle"; for
-- testing, like the model picker of 0211): the real card's art on Scryfall,
-- or — for a card of the maker's own with no printing — the art it had
-- before Re-art, repainted in the deck's style. A tester comparing the two
-- has to see, on each card, which one made its picture.
--
-- deck_reart_cards gains `method`: 'paint' (from the prompt alone) or
-- 'restyle' (from the card's art). NULL: painted before this migration —
-- every one of those was painted from the prompt — or not known. Written by
-- the server with the rest of the row; the table's grants are table-level
-- (0191), so they cover the column.
--
-- No stored card changes and nothing is charged for. Idempotent. Ships
-- through a PR; never applied ad-hoc.

alter table public.deck_reart_cards
  add column if not exists method text;

alter table public.deck_reart_cards
  drop constraint if exists deck_reart_cards_method_check;
alter table public.deck_reart_cards
  add constraint deck_reart_cards_method_check
  check (method is null or method in ('paint', 'restyle'));

comment on column public.deck_reart_cards.method is
  'Re-art deck (0212): how the picture Re-art put on the card last was made — ''paint'' (from the prompt alone) or ''restyle'' (the card''s own art, repainted). NULL: painted before 0212 (from the prompt), or not known.';

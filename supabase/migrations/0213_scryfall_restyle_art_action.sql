-- 0213_scryfall_restyle_art_action.sql — scryfall_calls takes the restyle's
-- own action, 'restyle_art'.
--
-- Re-art deck (beta tool `re-art-deck`, 0191) can start a picture from the
-- real card's ART (0212's `method` 'restyle'): the art crop is read from
-- Scryfall for a model to repaint, and never stored
-- (lib/scryfall/art-crop.ts). That read is counted per user like every
-- other Scryfall call — under its OWN action, not 'import_art': that one's
-- 100 a day is sized for pictures a maker keeps in their folder, and a run
-- restyles up to 150 cards (two pictures for a two-faced one). Counted
-- there, a big deck's run stopped near its hundredth card with nothing said
-- first, and spent the creator's own art import for the day.
--
-- The list is 0185's plus 'restyle_art' — exactly the app's labels
-- (lib/scryfall/rate-limit.ts SCRYFALL_LIMITS: 30 a minute, 500 a day).
--
-- No row changes; the table's grants and policies are untouched. Idempotent.
-- Ships through a PR; never applied ad-hoc.

alter table public.scryfall_calls
  drop constraint if exists scryfall_calls_action_check;

alter table public.scryfall_calls
  add constraint scryfall_calls_action_check
  check (action in ('search', 'named', 'import_art', 'deck_import', 'deck_import_commit', 'deck_tokens', 'collection_import', 'restyle_art'));

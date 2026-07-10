-- 0056_scryfall_deck_import_action.sql — allow 'deck_import' in the
-- scryfall_calls action enum.
--
-- Decklist import (decks series PR 3) resolves pasted lists through
-- Scryfall's POST /cards/collection endpoint. Each import RUN logs one
-- audit row (not one per API call) under the new 'deck_import' action so
-- the per-user quota in lib/scryfall/rate-limit.ts and the /admin/scryfall
-- dashboard can see it. The CHECK from 0013 whitelisted the original three
-- actions; extend it.

alter table public.scryfall_calls
  drop constraint if exists scryfall_calls_action_check;

alter table public.scryfall_calls
  add constraint scryfall_calls_action_check
  check (action in ('search', 'named', 'import_art', 'deck_import'));

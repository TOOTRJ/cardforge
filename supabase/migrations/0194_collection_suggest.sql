-- 0194_collection_suggest.sql — the Collection Deck Builder's "Suggest a
-- commander" (tool `collection-builder`, migration 0185; owner decision
-- 2026-11-09, the collection refinements report, change 4).
--
-- One AI call (1 credit, reserved before the call, settled once the answer
-- is delivered, refunded if it fails — the AI build's path) ranks the
-- commanders a user OWNS by how well their own cards support a deck, from a
-- shortlist the server scores first (lib/tools/collection/commander-scores.ts).
-- Nothing is stored: the answer goes back to the page, which keeps it in the
-- browser for a week.
--
-- The AI label `suggest_collection_commander` joins card_ai_calls' list —
-- rewritten WHOLE from 0192's, the latest that defines it (0193 does not).
--
-- No table, no grant change, no tool_releases row: the tool stays admin-only
-- on production plus the testers an admin grants, until an admin releases it.
--
-- Idempotent. Ships through a PR; never applied ad-hoc.

alter table public.card_ai_calls
  drop constraint if exists card_ai_calls_action_check;

alter table public.card_ai_calls
  add constraint card_ai_calls_action_check check (
    action = any (array[
      'improve_wording',
      'suggest_cost',
      'suggest_rarity',
      'generate_flavor',
      'generate_art_prompt',
      'check_balance',
      'generate_from_concept',
      'generate_random_card',
      'generate_random_art',
      'fill_card',
      'generate_deck',
      'remix_card',
      'remix_art',
      'generate_set_icon',
      'generate_deck_cards',
      'generate_card_ideas',
      'generate_deck_ideas',
      'analyze_deck',
      'build_collection_deck',
      'bulk_customize_art',
      'draft_table_sheet',
      'deck_reart_art',
      'forge_pip',
      'suggest_collection_commander'
    ])
  );

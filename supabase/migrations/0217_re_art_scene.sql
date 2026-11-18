-- 0217_re_art_scene.sql — Re-art deck (beta tool `re-art-deck`, 0191): an
-- AI-WRITTEN SCENE for a card (owner 2026-11-18: one credit each).
--
-- A card of a deck is painted from its name and type unless it has words of
-- its own (0209 deck_reart_prompts: what its picture shows). "Write a scene
-- with AI" has a text model write those words for one card — from its name,
-- type, rules and flavour text and the deck's world — so each picture shows
-- a scene of its own. One AI call, ONE CREDIT: reserved before the call,
-- the scene SAVED as the card's own words, then settled; refunded when the
-- call fails or the scene can't be saved. Nothing is painted: the card is
-- painted with the scene the next time it is painted, at a picture's own
-- price.
--
-- The AI label `deck_reart_scene` joins card_ai_calls' list — rewritten
-- WHOLE from 0194's, the latest that defines it (0195–0216 do not).
--
-- No table, no column, no grant change, no tool_releases row: the scene is
-- stored where a card's own words always were, and the tool stays open to
-- admins and the testers an admin grants until an admin releases it.
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
      'suggest_collection_commander',
      'deck_reart_scene'
    ])
  );

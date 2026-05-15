-- Migration: 0020_random_card_actions
--
-- Extends the `card_ai_calls.action` check constraint to accept two new
-- labels used by the random-card generator:
--
--   "generate_random_card" — GPT-4o text generation (Phase v2 Phase 4)
--   "generate_random_art"  — DALL-E 3 image generation that follows it
--
-- Counting them separately lets the usage panel distinguish text-only
-- usage from the more expensive image-generating flow, and the route
-- handler can cap each independently.

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
      'generate_random_art'
    ])
  );

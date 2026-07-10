-- Migration: 0058_ai_remix_actions
--
-- Widens the `card_ai_calls.action` check constraint for the AI generation
-- v2 series (see 0020 and 0027 §8 for the prior widenings):
--
--   "remix_card"          — AI remix: new name/flavor in a chosen style
--   "remix_art"           — the image-to-image art restyle that follows it
--   "generate_set_icon"   — set icon generation (set generation v2)
--   "generate_deck_cards" — whole-deck card generation
--
-- Additive only — every existing label stays valid. The full v2 label set
-- lands in one migration so the follow-up feature PRs don't each rewrite
-- the constraint.

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
      'generate_deck',
      'remix_card',
      'remix_art',
      'generate_set_icon',
      'generate_deck_cards'
    ])
  );

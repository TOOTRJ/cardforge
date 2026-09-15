-- 0083 — the AI deck builder's starting point + power level, and the
-- "deck theme ideas" AI action.
--
--   decks.deck_type  the tribe/archetype the deck was built around
--                    (lib/decks/deck-types.ts keys), shown as a badge and
--                    fed back to the AI when adding cards.
--   decks.bracket    Commander power bracket 1–5 (Exhibition … cEDH), null
--                    for other formats.
--   card_ai_calls    gains the 'generate_deck_ideas' action (1 credit buys
--                    three theme + style suggestions for the wizard).

alter table public.decks
  add column if not exists deck_type text check (deck_type is null or char_length(deck_type) <= 60),
  add column if not exists bracket smallint check (bracket is null or bracket between 1 and 5);

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
      'generate_deck_cards',
      'generate_card_ideas',
      'generate_deck_ideas'
    ])
  );

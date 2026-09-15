-- 0078 — card_ai_calls.action gains 'generate_card_ideas' (the creator's
-- "Get ideas" flow: one text call designs several card concepts the user
-- picks fields from; 1 credit per batch, no art). Same constraint rewrite
-- as 0058.

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
      'generate_card_ideas'
    ])
  );

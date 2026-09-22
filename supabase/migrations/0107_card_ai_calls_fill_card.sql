-- ===========================================================================
-- 0107 — card_ai_calls accepts the creator's per-field AI fill
--
-- lib/ai/generation-jobs.ts logs every card_fill step as action 'fill_card'
-- (the "Generate with AI" buttons in the creator, kind card_fill since 0089),
-- but the CHECK last rewritten in 0085 never learned the label. logAiCall()
-- swallows insert errors by design, so those calls silently vanished: they
-- never counted toward the 40/min + 500/day limiter (lib/ai/rate-limit.ts)
-- and never showed on /dashboard/usage. tests/unit/ai/ai-call-labels.test.ts
-- now keeps the AiActionLabel union and this list in sync.
--
-- The list is additive on purpose: retired labels (generate_set_icon,
-- remix_card, …) stay because historical rows carry them and a CHECK is
-- validated against existing rows when it is added.
--
-- Grants: none to state — no new object; card_ai_calls keeps its 0097 ACL.
-- ===========================================================================

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
      'analyze_deck'
    ])
  );

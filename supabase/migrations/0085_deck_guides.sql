-- 0085 — AI deck guides ("how to play" + combos) and the analyze_deck action.
--
--   deck_guides   one row per deck: overview, game plan steps, mulligan
--                 advice, combos, weaknesses, key cards. Written by the
--                 service role only — either free at the end of an AI deck
--                 generation (source 'generation') or when a Pro owner pays
--                 one credit to analyze a deck (source 'analysis',
--                 POST /api/decks/[id]/guide). Read follows the deck's own
--                 visibility; the Pro-viewer gate lives in app code.
--   card_ai_calls gains 'analyze_deck'.

create table if not exists public.deck_guides (
  deck_id uuid primary key references public.decks (id) on delete cascade,
  overview text not null check (char_length(overview) <= 2000),
  game_plan jsonb not null default '[]'::jsonb,
  mulligan text check (mulligan is null or char_length(mulligan) <= 1000),
  combos jsonb not null default '[]'::jsonb,
  weaknesses text check (weaknesses is null or char_length(weaknesses) <= 1000),
  key_cards jsonb not null default '[]'::jsonb,
  source text not null check (source in ('generation', 'analysis')),
  generated_at timestamptz not null default now()
);

alter table public.deck_guides enable row level security;

drop policy if exists "Deck guides follow their deck's visibility" on public.deck_guides;
create policy "Deck guides follow their deck's visibility"
  on public.deck_guides
  for select
  using (
    exists (
      select 1 from public.decks d
      where d.id = deck_guides.deck_id
        and (d.visibility in ('public', 'unlisted') or d.owner_id = auth.uid())
    )
  );

grant select on public.deck_guides to anon, authenticated;

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
      'generate_deck_ideas',
      'analyze_deck'
    ])
  );

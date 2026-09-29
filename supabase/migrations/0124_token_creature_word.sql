-- 0124 — stored creature tokens gain "Creature" in their supertype (TODO 3b.15).
--
-- A token's card types ride in `supertype` ("Token Artifact Creature —
-- Thopter" is card_type 'token' with "Artifact Creature" in supertype — the
-- importer's rule since 1.3), and from this release the creator's token
-- picker, the P/T gate (showsPowerToughness) and the AI read them there: only
-- a Creature token has a power / toughness, and the type line prints "Token"
-- first ("Token Creature — Soldier"). Before the picker every token was a
-- creature, so a stored token with a P/T and no type word IS a creature
-- token: it gains "Creature" (owner decision 2026-09-29), last in printed
-- order after the words it keeps ("Legendary" → "Legendary Creature"). It
-- then prints "Token Creature — Soldier" with its P/T, and the picker shows
-- the Creature toggle on.
--
-- Scope, as the app reads it (lib/cards/card-display.ts):
--   * card_type = 'token';
--   * a power or a toughness (a non-empty string, the renderers' test);
--   * no Creature, Artifact or Enchantment word in supertype (whole words,
--     any case — hasTokenTypeWord). A token that names another type (a
--     Treasure's "Artifact") is left alone;
--   * the result fits cards_supertype_length (64, migration 0003). A longer
--     one is skipped rather than failing the migration; the renderers still
--     print its P/T (printsPowerToughness's stored-token rule).
-- Back faces (the back_face jsonb) are not touched: the renderers' same rule
-- keeps a token back face's P/T, and production has no public card with a
-- token back face (checked 2026-09-29).
--
-- Production, 2026-09-29 (anonymous REST, public rows only — RLS hides
-- private ones, so their count is unknown): 32 public tokens; 8 have a P/T
-- and no type word (all 8 with an empty supertype) and change here. The other
-- 24 have no P/T (22 of them typed "Basic", one account's lands on the token
-- frame) and are untouched.
--
-- Render stamps are NOT nulled: the release ships a CARD_LAYOUT_VERSION bump
-- scoped to every token whose printed line changes ("Token" first, and these
-- rows' new word), and the automatic re-bake (0120) re-draws them. This
-- update runs when the PR merges, before that deployment's cron can reach
-- them. It is an edit of the type line, so the cards' updated_at moves (the
-- 0108 trigger ignores only the render columns).
--
-- Triggers on the update: set_cards_updated_at (0108) bumps updated_at;
-- cards_search_vector_refresh (0086) re-indexes the new word;
-- cards_remix_notify (0032) returns early (visibility doesn't change). No
-- insert-only trigger (the capacity check, 0104) fires.
--
-- Idempotent: an updated row has "Creature", so a second run matches nothing.
--
-- Grants: none. This migration only updates rows of public.cards. It creates
-- no table or function and changes no grant, so the API roles keep exactly
-- the privileges they have on public.cards (0097).
--
-- Ships through a PR; never applied ad-hoc.

update public.cards
set supertype = btrim(regexp_replace(coalesce(supertype, '') || ' Creature', '\s+', ' ', 'g'))
where card_type = 'token'
  and (coalesce(power, '') <> '' or coalesce(toughness, '') <> '')
  and coalesce(supertype, '') !~* '(^|\s)(creature|artifact|enchantment)(\s|$)'
  and char_length(btrim(regexp_replace(coalesce(supertype, '') || ' Creature', '\s+', ' ', 'g'))) <= 64;

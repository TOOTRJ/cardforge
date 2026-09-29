-- 0128 — stored creature tokens gain "Creature" in their supertype (TODO 3b.15).
--
-- Numbered 0128, not the 0124 it was written as: main took 0125 (#406) and
-- 0126 / 0127 are queued ahead of the token release, and Supabase never
-- applies a version below one production already has.
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
-- So does a stored token with a P/T that says Artifact or Enchantment but
-- not Creature (owner decision 2026-09-29, round 10: "so they keep their
-- P/T") — a hand-typed "Artifact" on a 1/1 Thopter, or an AI token the old
-- autofix gave a 2/2. Under this release's rule (a token prints a P/T only
-- with Creature or a Vehicle / Spacecraft subtype) its P/T would stop
-- printing; with "Creature" added — last, its printed place: "Artifact" →
-- "Artifact Creature", "Enchantment Artifact" → "Enchantment Artifact
-- Creature", "Legendary Artifact" → "Legendary Artifact Creature" — it
-- prints "Token Artifact Creature — Thopter" with the P/T it printed before.
-- A Vehicle or Spacecraft keeps its P/T without the word (showsPowerToughness)
-- and is left alone.
--
-- Scope, as the app reads it (lib/cards/card-display.ts):
--   * card_type = 'token';
--   * a power or a toughness (a non-empty string, the renderers' test);
--   * no Creature word in supertype (whole words, any case —
--     supertypeHasWord);
--   * AND either no Artifact or Enchantment word either (the pre-picker
--     token: hasTokenTypeWord is false) or no Vehicle / Spacecraft subtype
--     (any case, trimmed — PT_SUBTYPES). A word-less token keeps the first
--     scope exactly, whatever its subtypes;
--   * the result fits cards_supertype_length (64, migration 0003). A longer
--     one is skipped rather than failing the migration; a word-less one
--     still prints its P/T (printsPowerToughness's stored-token rule), an
--     Artifact / Enchantment one does not.
-- Back faces (the back_face jsonb) are not touched: the renderers' same rule
-- keeps a token back face's P/T, and production has no public card with a
-- token back face (checked 2026-09-29).
--
-- Production, 2026-09-29 (anonymous REST, public rows only — RLS hides
-- private ones, so their count is unknown; re-read 17:30 UTC): 33 public
-- tokens; 9 have a P/T and no type word (all 9 with an empty supertype) and
-- change here, 0 have a P/T with Artifact or Enchantment. The other 24 have
-- no P/T (22 of them typed "Basic", one account's lands on the token frame)
-- and are untouched. The owner counts the private rows of both kinds before
-- the merge (TODO 4.49).
--
-- The same statement sets layout_version = NULL on exactly these rows (the
-- 0117 / 0118 pattern). A null stamp owes a platform re-bake that the
-- automatic re-bake (0120) picks up, and never shows the owner a badge
-- (hasNewerLook is false for a null stamp). It makes the order of this
-- migration and the Vercel deploy irrelevant: Supabase applies migrations
-- when the PR merges, but its runner can lag the deploy (docs/ENVIRONMENTS.md
-- §4), and the release's CARD_LAYOUT_VERSION bump (v34, a "sweep") could then
-- re-bake these rows BEFORE they have the word — "Token — Boar" with its P/T,
-- stamped 34, then stale-but-current once the word lands. With the stamp
-- nulled here:
--   * migration first, old deployment still live: its cron re-bakes them
--     with the old code and stamps them v33; the new deployment's v34 sweep
--     re-bakes them again ("Token Creature — Boar");
--   * deployment first: the v34 cron may bake them without the word; this
--     update then nulls the stamp and the next run re-bakes them with it.
-- The stored render is kept (the gallery shows it until the re-bake), and
-- the render columns are not touched. It is an edit of the type line, so the
-- cards' updated_at moves (the 0108 trigger ignores only the render columns).
--
-- Triggers on the update: cards_set_updated_at (set_cards_updated_at, 0108)
-- bumps updated_at (layout_version is a render column it ignores);
-- cards_search_vector_refresh (0086) re-indexes the new word;
-- cards_remix_notify (0032) returns early (visibility doesn't change). No
-- insert-only trigger (the capacity check, 0104) fires.
--
-- Idempotent: an updated row has "Creature", so a second run matches nothing
-- (and nulls no stamp).
--
-- The creator reads the same word onto such a stored row before it runs
-- (formSupertypeOf), and the renderers print it the same way after it.
--
-- Grants: none. This migration only updates rows of public.cards. It creates
-- no table or function and changes no grant, so the API roles keep exactly
-- the privileges they have on public.cards (0097).
--
-- Ships through a PR; never applied ad-hoc.

update public.cards
set
  supertype = btrim(regexp_replace(coalesce(supertype, '') || ' Creature', '\s+', ' ', 'g')),
  layout_version = null
where card_type = 'token'
  and (coalesce(power, '') <> '' or coalesce(toughness, '') <> '')
  and coalesce(supertype, '') !~* '(^|\s)creature(\s|$)'
  and (
    coalesce(supertype, '') !~* '(^|\s)(artifact|enchantment)(\s|$)'
    or not exists (
      select 1
      from unnest(subtypes) as t(subtype)
      where lower(btrim(t.subtype, E' \t\n\r')) in ('vehicle', 'spacecraft')
    )
  )
  and char_length(btrim(regexp_replace(coalesce(supertype, '') || ' Creature', '\s+', ' ', 'g'))) <= 64;

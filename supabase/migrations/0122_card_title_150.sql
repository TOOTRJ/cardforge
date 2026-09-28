-- 0122 — card titles up to 150 characters (TODO 1.12).
--
-- cards.title was capped at 120 characters since 0003 (cards_title_length).
-- The longest printed Magic name is 141 characters — Unhinged #107, "Our
-- Market Research Shows That Players Like Really Long Card Names So We Made
-- this Card to Have the Absolute Longest Card Name Ever Elemental" — so a
-- Scryfall import of it failed the save. The cap moves to 150, mirrored by
-- CARD_TITLE_MAX in lib/validation/card.ts (the front title and a second
-- face's title, which lives in the back_face jsonb and has no CHECK of its
-- own). Deck, challenge and news titles keep their own 120 (0055, 0040,
-- 0080).
--
-- Widening a CHECK can't fail on existing rows: every stored title is already
-- 1–120 characters, which is inside 1–150. Adding the constraint re-checks
-- them under a brief lock on public.cards; the table is small.
--
-- Idempotent: the constraint is dropped if present and added again, so a
-- second run ends in the same state.
--
-- NUMBERING: provisional. 0120 (frame_requests, TODO 1.6) and 0121 (Phase 2's
-- frame preview) are claimed by open PRs. If a higher version merges first,
-- this file is renumbered past it before merge — Supabase's branching refuses
-- a migration older than one already applied.
--
-- Grants: none. This migration only replaces a CHECK constraint. It creates
-- no table or function and changes no grant, so the API roles keep exactly
-- the privileges they have on public.cards (0097).
--
-- Ships through a PR; never applied ad-hoc.

alter table public.cards
  drop constraint if exists cards_title_length;

alter table public.cards
  add constraint cards_title_length
    check (char_length(title) between 1 and 150);

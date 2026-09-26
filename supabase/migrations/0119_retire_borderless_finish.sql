-- 0119 — retire the dead "borderless" finish (TODO 0.25; owner decision
-- 2026-09-26: reset silently).
--
-- "borderless" was a frame_style.finish value (documented in 0014). It has
-- drawn nothing since the MSE-schema rebuild (2026-06-01): both renderers
-- branch only on foil / etched / showcase, so a borderless-finish card bakes
-- exactly like a regular one, and the creator stopped offering it. The only
-- place a user still saw it was the edit / remix summary ("Finish:
-- Borderless"). Borderless becomes a frame treatment (its own templates),
-- never a finish; the app drops the value from CARD_FINISH_VALUES and reads a
-- legacy "borderless" as "regular" (types/card.ts, lib/validation/card.ts).
--
-- Production on 2026-09-26 (one anonymous read, publishable key, so public +
-- unlisted rows only): 12 public cards from 4 owners, created 2026-05-15 to
-- 05-23, 11 on m15 and 1 on tarkirdragon, 0 unlisted. Private rows can't be
-- counted that way. This statement resets every row, whatever its visibility.
--
-- What it changes: frame_style.finish "borderless" → "regular", and nothing
-- else in the row (template and any other key are kept by jsonb_set).
--
-- What it keeps, on purpose:
--   * layout_version and the stored render (rendered_image_url,
--     rendered_thumb_url, rendered_at). No pixel changes — a borderless and a
--     regular finish bake byte-identical PNGs (tests/unit/db/
--     retire-borderless-finish-migration.test.tsx) — so there is no re-bake,
--     no "newer look" badge and no render_update notification.
--   * updated_at. cards_set_updated_at (0108) would move it to now():
--     frame_style is a content column, and the trigger overwrites whatever the
--     UPDATE itself sets (it assigns new.updated_at = now() on a content
--     change and new.updated_at = old.updated_at otherwise, so neither setting
--     updated_at in the SET list nor a second "restore" UPDATE can keep it).
--     This is not an edit by the owner: the sitemap lastmod, the card page's
--     dateModified, the OG cache-buster (max(updated_at, rendered_at)) and
--     "recently updated" orderings must not move, and the bake's
--     compare-and-set on updated_at (lib/cards/bake-render.ts,
--     lib/cards/rebake-batch.ts) must not see a phantom save. So the block
--     below disables that ONE trigger around the UPDATE and re-enables it.
--     It is one DO block, so it is atomic on its own: if the UPDATE fails,
--     the disable rolls back with it. The catalog change is transactional
--     too, so no other session ever sees the trigger disabled; ALTER TABLE
--     takes a SHARE ROW EXCLUSIVE lock on public.cards, which holds other
--     writes to cards for the few milliseconds the UPDATE takes (reads are
--     not blocked). Migrations run as the table owner, which ALTER TABLE
--     … DISABLE TRIGGER requires.
--
-- Other triggers on public.cards:
--   * cards_search_vector_refresh (0086) fires only on the text columns. It
--     doesn't fire here.
--   * cards_remix_notify (0032) returns early: visibility doesn't change, so
--     no row is a new publish and no notification is written.
--   * cards_enforce_capacity (0104) is BEFORE INSERT only.
-- RLS doesn't apply: migrations run as the table owner.
--
-- Idempotent: the WHERE clause matches only "borderless" rows, and the
-- statement rewrites each one to "regular", so a second run updates 0 rows.
-- The seeds (supabase/seeds) have no borderless card; a row copied into the
-- dev database from production is reset the same way.
--
-- Grants: none. This migration only changes data. It creates no table or
-- function, so there is nothing for an API role to be granted.
--
-- Ships through a PR; never applied ad-hoc.

do $$
declare
  reset_rows integer;
begin
  alter table public.cards disable trigger cards_set_updated_at;

  update public.cards
  set frame_style = jsonb_set(frame_style, '{finish}', '"regular"'::jsonb)
  where frame_style ->> 'finish' = 'borderless';
  get diagnostics reset_rows = row_count;

  alter table public.cards enable trigger cards_set_updated_at;

  raise notice '0119: % card(s) moved from the borderless finish to regular', reset_rows;
end;
$$;

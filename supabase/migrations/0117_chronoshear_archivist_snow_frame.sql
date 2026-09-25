-- 0117 — one production card moves from the Snow Land frame to the Snow frame
-- (owner decision, frame review of every production card, 2026-09-25).
--
-- Chronoshear Archivist (1b73a2d3-9361-48b4-91d8-f8e07f39cecb) is a blue
-- artifact costing {2}{U}, saved on `m15snowland`. Land frames have no mana
-- cost box (the profile sets hideCost, lib/cards/template-layout.ts), so the
-- card has never shown its cost. `m15snow` is the same snow dress on the
-- spell frame, and it prints the cost. m15snow/u is a verified frame_reviews
-- combo on production (supabase/seed.sql mirrors it), so the owner can still
-- save the card in the creator afterwards.
--
-- Idempotent and targeted by id. It changes only that row, and only while the
-- row is still on m15snowland: if the owner has picked another frame since,
-- that choice stands and this is a no-op. Running it again is also a no-op.
-- Preview branches and the dev database don't have this id, so nothing
-- changes there.
--
-- The same statement sets layout_version = NULL. A null stamp tells the
-- platform to re-bake the card, and never shows the owner a badge
-- (lib/cards/layout-version.ts):
--   * hasPendingCorrection → true, so a download renders the new frame live
--     until the card is re-baked. It does not serve the stored bake that
--     hides the cost.
--   * classifyForSweep → "rebake". Both /api/admin/rebake scope=sweep
--     (scripts/rebake-renders.mjs) and the compare page's "marked" scope
--     (a null stamp with a stored render) pick it up
--     (lib/cards/rebake-batch.ts).
--   * hasNewerLook → false for a null stamp, so there is no "newer look"
--     badge. The render_update cron (lib/cards/render-update-notify.ts) only
--     scans rows where layout_version < CARD_LAYOUT_VERSION, which never
--     matches a null stamp, so the owner gets no notification either.
-- The stored render is kept. The gallery shows the old bake until the sweep
-- replaces it, and keeping it leaves the row in the "marked" scope.
--
-- Triggers on public.cards:
--   * cards_set_updated_at (0108) moves updated_at to now(). frame_style is a
--     content change, not a render column, so this counts as a real edit:
--     the sitemap lastmod and the OG cache-buster update, and the card moves
--     up the owner's "recently updated" lists. The rebake batch reads
--     updated_at when it runs, after this migration, so its compare-and-set
--     is unaffected.
--   * cards_search_vector_refresh (0086) fires only on the text columns. It
--     doesn't fire here.
--   * cards_remix_notify (0032) returns early: the card was already public.
--   * cards_enforce_capacity (0104) is BEFORE INSERT only. It can't fire on
--     an update.
-- RLS doesn't apply: migrations run as the table owner.
--
-- Grants: none. This migration only changes data. It creates no table or
-- function, so there is nothing for an API role to be granted.
--
-- After it merges, run the platform re-bake sweep (the layout v24–v26 sweep
-- covers it) or "Re-bake now" on /admin/frame-compare.
--
-- Ships through a PR; never applied ad-hoc.

update public.cards
set
  frame_style = jsonb_set(frame_style, '{template}', '"m15snow"'::jsonb),
  layout_version = null
where id = '1b73a2d3-9361-48b4-91d8-f8e07f39cecb'
  and frame_style ->> 'template' = 'm15snowland';

-- 0118 — two production cards are re-baked because their art is a phone photo
-- stored sideways (EXIF orientation, TODO 3.14).
--
-- A phone camera stores its pixels in the sensor's orientation and writes an
-- EXIF Orientation tag saying how to turn them. Browsers obey the tag, so the
-- creator and the live preview showed these photos upright. The bake (sharp +
-- Satori + resvg) ignored the tag, so the stored render, the gallery thumb, the
-- OG image and the watermarked download all show the art on its side, with
-- the saved crop landing on the wrong part of the photo. The same PR fixes the
-- code: uploads are stored upright, and the bake turns any tagged file it
-- reads (lib/media/orientation.ts, lib/render/art-source.ts).
--
-- A read-only scan of production on 2026-09-25 (publishable key and public
-- storage URLs only, HTTP Range requests for the first 128 KB of each file)
-- found exactly these two. It covered 728 public + unlisted cards: 819 image
-- URLs across art, back-face art, custom watermarks and set icons. 479
-- distinct files on our storage were read; 339 AI outputs
-- (card-art/<owner>/ai-*) were skipped because AI images carry no camera
-- EXIF; no URL pointed at any other host.
-- 52 files carry an orientation tag: 49 say 1, one says 0 (invalid, which
-- browsers and sharp both treat as 1), and these two JPEGs say 6:
--   * Cyclonic Rift     311ef220-1ced-4f03-a1bf-1fe881163e27 (public, m15)
--   * Javi, el más duro a20cb8ea-4b38-420a-b9fa-05c126f818e8 (public, m15)
-- Private cards can't be read with the publishable key. They have no stored
-- render to fix: they render live, and live renders use the fixed code.
--
-- The statement sets layout_version = NULL. A null stamp tells the platform to
-- re-bake the card and never shows the owner a badge
-- (lib/cards/layout-version.ts):
--   * hasPendingCorrection → true, so a download renders the card live (and
--     upright) until it is re-baked, instead of serving the sideways bake.
--   * classifyForSweep → "rebake". Both /api/admin/rebake scope=sweep
--     (scripts/rebake-renders.mjs) and the compare page's "marked" scope
--     (a null stamp with a stored render, /api/admin/rebake-marked) pick them
--     up (lib/cards/rebake-batch.ts).
--   * hasNewerLook → false for a null stamp, so there is no "newer look"
--     badge, and the render_update cron (lib/cards/render-update-notify.ts)
--     only scans rows where layout_version < CARD_LAYOUT_VERSION, which never
--     matches a null stamp, so the owners get no notification either.
-- The stored renders are kept, which keeps the rows in the "marked" scope.
--
-- Guards: each id is paired with the art URL the scan read. If an owner has
-- since replaced the art, the save re-baked the card with the new art and
-- this is a no-op for that row. `layout_version is not null` makes a second
-- run a no-op too. Preview branches and the dev database don't have these
-- ids, so nothing changes there.
--
-- Triggers on public.cards:
--   * cards_set_updated_at (0108) ignores layout_version, so updated_at does
--     not move: a platform re-bake is not an edit (no sitemap lastmod or
--     "recently updated" change).
--   * cards_search_vector_refresh (0086) fires only on the text columns. It
--     doesn't fire here.
--   * cards_remix_notify (0032) returns early: both cards were already public.
--   * cards_enforce_capacity (0104) is BEFORE INSERT only.
-- RLS doesn't apply: migrations run as the table owner.
--
-- Grants: none. This migration only changes data. It creates no table or
-- function, so there is nothing for an API role to be granted.
--
-- After it merges AND the fixed code is live, re-bake the marked cards: the
-- "Re-bake now" button on /admin/frame-compare (marked scope) or the next
-- SCOPE=sweep run. A re-bake that runs on the old code would bake the same
-- sideways image, so don't run one against a deployment without this fix.
--
-- Ships through a PR; never applied ad-hoc.

update public.cards as c
set layout_version = null
from (
  values
    ('311ef220-1ced-4f03-a1bf-1fe881163e27'::uuid, 'https://auth.pipglyph.com/storage/v1/object/public/card-art/066276e3-5221-4a77-90a2-a8d804f36dce/b45adea7-daf1-4517-8155-5f623e3cf31e.jpg'),
    ('a20cb8ea-4b38-420a-b9fa-05c126f818e8'::uuid, 'https://auth.pipglyph.com/storage/v1/object/public/card-art/d67c5dab-9671-4111-b178-f4688840b7e9/a2608ff0-19e9-49a1-ac3b-15c592c32a2a.jpg')
) as sideways (id, art_url)
where c.id = sideways.id
  and c.art_url = sideways.art_url
  and c.layout_version is not null;

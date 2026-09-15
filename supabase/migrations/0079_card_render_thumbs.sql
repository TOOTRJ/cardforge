-- ---------------------------------------------------------------------------
-- Baked-render thumbnails (2026-09-15)
--
-- The stored bake (`rendered_image_url`) is the HD 1500×2100 PNG (~3 MB) —
-- the bytes a paid HD download serves. Gallery tiles were loading that same
-- object, so a page of thirty cards moved ~100 MB. The bake now also writes a
-- 600 px WebP thumbnail beside the PNG (card-renders/{owner}/{card}.thumb.webp,
-- lib/cards/render-thumb.ts) and records its public URL here; tiles use it
-- directly. Null for cards baked before this migration until their next bake
-- or the one-off scripts/backfill-render-thumbs.mjs.
-- ---------------------------------------------------------------------------

alter table public.cards
  add column if not exists rendered_thumb_url text;

comment on column public.cards.rendered_thumb_url is
  'Public URL of the 600px WebP thumbnail of the baked render (card-renders bucket), cache-busted with ?v=. Null until the card is baked with the thumbnail step.';

-- The bucket was created PNG-only (migration 0021); the thumbnail is WebP.
update storage.buckets
  set allowed_mime_types = array['image/png', 'image/webp']
  where id = 'card-renders';

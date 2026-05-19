-- Phase 12 — Baked card renders.
--
-- Every card now stores a URL to a baked PNG of itself, generated at save
-- time. The gallery, profile, and detail pages serve that PNG instead of
-- re-rendering the React preview, so a card looks identical everywhere it
-- appears and long rules text never squeezes the art.
--
-- Two pieces:
--   1. `cards.rendered_image_url` + `cards.rendered_at` — pointer to the
--      most recent bake. Null for cards baked before this migration ran.
--   2. `card-renders` storage bucket — one PNG per card at a deterministic
--      path, overwritten on every save. Cache-busted via a `?v=` query on
--      the stored URL.

-- ---------------------------------------------------------------------------
-- Schema: rendered_image_url + rendered_at on cards
-- ---------------------------------------------------------------------------

alter table public.cards
  add column if not exists rendered_image_url text,
  add column if not exists rendered_at timestamptz;

-- ---------------------------------------------------------------------------
-- Storage bucket — same layout + RLS posture as card-exports.
-- Path layout: card-renders/{owner_id}/{card_id}.png
--   * public-read so the gallery can <img src="..."> without a signed URL
--   * writes scoped to the owner's first-folder = their auth.uid()
--   * NO broad SELECT on storage.objects — public buckets serve URLs
--     without it (matches card-art and card-exports)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-renders',
  'card-renders',
  true,
  16777216,
  array['image/png']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Owners can upload card renders to their own folder" on storage.objects;
drop policy if exists "Owners can update their own card renders" on storage.objects;
drop policy if exists "Owners can delete their own card renders" on storage.objects;

create policy "Owners can upload card renders to their own folder"
  on storage.objects
  for insert
  with check (
    bucket_id = 'card-renders'
    and auth.role() = 'authenticated'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Owners can update their own card renders"
  on storage.objects
  for update
  using (
    bucket_id = 'card-renders'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'card-renders'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Owners can delete their own card renders"
  on storage.objects
  for delete
  using (
    bucket_id = 'card-renders'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

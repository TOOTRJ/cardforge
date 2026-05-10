-- Phase 5 — card-exports storage bucket.
-- Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP.
--
-- Path layout: card-exports/{owner_id}/{card_id}-{timestamp}.{format}
--   * bucket is public-read so users can share or save the rendered image.
--   * writes scoped to the owner's first-folder = their auth.uid().
--   * NO broad SELECT on storage.objects — public buckets serve URLs without
--     it (advisor 0025; matches the card-art bucket setup).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-exports',
  'card-exports',
  true,
  16777216,  -- 16 MB cap on a single export (HD PNGs are large)
  array['image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Owners can upload card exports to their own folder" on storage.objects;
drop policy if exists "Owners can update their own card exports" on storage.objects;
drop policy if exists "Owners can delete their own card exports" on storage.objects;

create policy "Owners can upload card exports to their own folder"
  on storage.objects
  for insert
  with check (
    bucket_id = 'card-exports'
    and auth.role() = 'authenticated'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Owners can update their own card exports"
  on storage.objects
  for update
  using (
    bucket_id = 'card-exports'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'card-exports'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Owners can delete their own card exports"
  on storage.objects
  for delete
  using (
    bucket_id = 'card-exports'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

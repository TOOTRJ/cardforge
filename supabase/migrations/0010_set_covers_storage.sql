-- Phase 7 — set-covers storage bucket.
-- Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP.
--
-- Path layout: set-covers/{owner_id}/{filename}
--   * public-read so cover thumbnails render in any browser.
--   * owner-scoped writes via auth.uid()::text = (storage.foldername(name))[1].
--   * 5 MB cap (covers don't need to be huge), image MIME allowlist.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'set-covers',
  'set-covers',
  true,
  5242880,  -- 5 MB
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- NO broad SELECT on storage.objects — public buckets serve URLs without
-- it (advisor 0025; matches card-art / card-exports).

drop policy if exists "Owners can upload set covers to their own folder" on storage.objects;
drop policy if exists "Owners can update their own set covers" on storage.objects;
drop policy if exists "Owners can delete their own set covers" on storage.objects;

create policy "Owners can upload set covers to their own folder"
  on storage.objects
  for insert
  with check (
    bucket_id = 'set-covers'
    and auth.role() = 'authenticated'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Owners can update their own set covers"
  on storage.objects
  for update
  using (
    bucket_id = 'set-covers'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'set-covers'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Owners can delete their own set covers"
  on storage.objects
  for delete
  using (
    bucket_id = 'set-covers'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

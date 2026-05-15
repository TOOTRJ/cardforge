-- Phase 3 — card-art storage bucket + owner-scoped RLS.
--
-- Path layout: card-art/{owner_id}/{filename}
--   * bucket is public-read so card art can render from any browser.
--   * writes are restricted to the owner's first-folder = their auth.uid().
--   * file_size_limit and allowed_mime_types are bucket-level guardrails.
-- Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-art',
  'card-art',
  true,
  8388608,  -- 8 MB
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS policies live on storage.objects, scoped by bucket_id.
--
-- Note: we intentionally do NOT add a SELECT policy here. Public buckets
-- expose object URLs without it; adding a broad SELECT would let clients
-- LIST every file in the bucket, which is more access than required.
-- (Supabase advisor 0025 — public_bucket_allows_listing.)

drop policy if exists "Owners can upload card art to their own folder" on storage.objects;
drop policy if exists "Owners can update their own card art" on storage.objects;
drop policy if exists "Owners can delete their own card art" on storage.objects;

create policy "Owners can upload card art to their own folder"
  on storage.objects
  for insert
  with check (
    bucket_id = 'card-art'
    and auth.role() = 'authenticated'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Owners can update their own card art"
  on storage.objects
  for update
  using (
    bucket_id = 'card-art'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'card-art'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Owners can delete their own card art"
  on storage.objects
  for delete
  using (
    bucket_id = 'card-art'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

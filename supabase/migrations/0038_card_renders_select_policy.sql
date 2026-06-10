-- 0038: make card-render upserts pass RLS for the card owner.
--
-- Root cause of "save-time bakes never persisted" (found 2026-06-09): the
-- bake uploads with `upsert: true`, which storage-api executes as
-- INSERT ... ON CONFLICT DO UPDATE. Postgres requires SELECT visibility on
-- storage.objects for that plan, and card-renders had insert/update/delete
-- policies but NO select policy — so every session-authenticated upsert
-- failed with "new row violates row-level security policy" (the admin sweep
-- works because service_role bypasses RLS; card-art works because it uploads
-- with upsert: false).
--
-- Reads of the PNG bytes are unaffected either way (the bucket is public and
-- served by URL); this policy only grants object-row visibility to the owner
-- so their own upserts can resolve conflicts.

drop policy if exists "Owners can read their own card renders" on storage.objects;
create policy "Owners can read their own card renders"
  on storage.objects for select
  using (
    bucket_id = 'card-renders'
    and (auth.uid())::text = (storage.foldername(name))[1]
  );

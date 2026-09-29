-- 0126 — storage writes are server-only (TODO 3.14a follow-up, owner
-- decision 2026-09-29).
--
-- Until now each user bucket carried owner-folder INSERT / UPDATE / DELETE
-- policies on storage.objects (0004 card-art, 0007 card-exports, 0010
-- set-covers, 0021 card-renders, 0022 profile-media, 0039 custom-pips — all
-- `auth.uid()::text = (storage.foldername(name))[1]`). So a signed-in user
-- could write `{their id}/anything` straight from the Supabase client and
-- skip the upload actions: the Sharp byte sniff, the camera-metadata strip
-- (lib/media/upload-bytes.ts, TODO 3.14a) and the NSFW scan. In card-renders
-- that meant replacing their own card's stored bake — the gallery tile, the
-- OG image, the free download — with any picture, watermark-free.
--
-- After this migration the API roles hold NO insert, update or delete
-- policy on those buckets. Every write is a server action or route that
-- authenticates the caller, forces the `{userId}/` folder and writes with
-- the service role, which bypasses RLS (lib/media/user-storage.ts; the save
-- bake in lib/cards/bake-render.ts). Deletes moved server-side too: through
-- a user's JWT a storage `remove` needs SELECT as well as DELETE, and
-- card-art / profile-media / set-covers have no SELECT policy (listing stays
-- closed, advisor 0025) — so those removes were silent no-ops: a flagged
-- upload and a replaced avatar or banner were never actually deleted.
--
-- Unchanged: the buckets themselves (public read by URL, size and MIME
-- limits), the two owner SELECT policies (0038 card-renders, 0039
-- custom-pips; they only ever existed so the owner's upserts could resolve,
-- and back no write now) and `frames` (0116: no policies, service role
-- only). card-exports has no writer in the app; it just loses its policies.
--
-- The DO block is a drift guard for production, whose early storage setup
-- was applied by hand (see 0005): it drops any OTHER insert / update /
-- delete / all policy on storage.objects that names one of these buckets,
-- so the outcome never depends on a policy's name. A branch built from this
-- repo has none; production logs a NOTICE per policy it drops.
--
-- Grants: none. No table or function is created, and the (Supabase-managed)
-- privileges on storage.objects are untouched — which rows the API roles
-- may write is decided by policies, and for these buckets there are now
-- none. Never add an owner-folder write policy back: a new upload path goes
-- through lib/media/user-storage.ts.
--
-- Ships through a PR; never applied ad-hoc.

drop policy if exists "Owners can upload card art to their own folder" on storage.objects;
drop policy if exists "Owners can update their own card art" on storage.objects;
drop policy if exists "Owners can delete their own card art" on storage.objects;

drop policy if exists "Owners can upload card exports to their own folder" on storage.objects;
drop policy if exists "Owners can update their own card exports" on storage.objects;
drop policy if exists "Owners can delete their own card exports" on storage.objects;

drop policy if exists "Owners can upload set covers to their own folder" on storage.objects;
drop policy if exists "Owners can update their own set covers" on storage.objects;
drop policy if exists "Owners can delete their own set covers" on storage.objects;

drop policy if exists "Owners can upload card renders to their own folder" on storage.objects;
drop policy if exists "Owners can update their own card renders" on storage.objects;
drop policy if exists "Owners can delete their own card renders" on storage.objects;

drop policy if exists "Owners can upload their own profile media" on storage.objects;
drop policy if exists "Owners can update their own profile media" on storage.objects;
drop policy if exists "Owners can delete their own profile media" on storage.objects;

drop policy if exists "Owners can upload custom pips to their own folder" on storage.objects;
drop policy if exists "Owners can update their own custom pips" on storage.objects;
drop policy if exists "Owners can delete their own custom pips" on storage.objects;

do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and concat_ws(' ', qual, with_check)
        ~ '''(card-art|card-exports|set-covers|card-renders|profile-media|custom-pips)'''
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
    raise notice '0126: dropped storage.objects policy %', p.policyname;
  end loop;
end
$$;

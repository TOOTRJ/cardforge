-- 0131 — card art up to 20 MiB, uploaded through a private staging bucket
-- (TODO 6.10, third item; owner decision 2026-09-29: "the art upload limit is
-- raised in a follow-up"). Ships through a PR; never applied ad-hoc.
--
-- MERGE ORDER: after 0130 (the emblems PR, #421). This file only touches
-- storage.buckets, so it does not depend on 0130's contents — the number is
-- what orders them.
--
-- 1. `card-art`: file_size_limit 8 MB (0004) → 20 MiB.
--    Print exports composite the ORIGINAL art at 600 / 800 ppi (TODO 6.10,
--    lib/render/card-print.ts), and a 2000×2800 lossless PNG — the 800 ppi
--    full-art slot — is 8–11 MiB for a clean digital painting and 13–15 MiB
--    with painted grain (measured 2026-09-29); even incompressible 8-bit RGB
--    is 16 MiB at 2000×2800 and 18.9 MiB at the 2200×3000 bleed size. The
--    renderers fetch art up to 25 MiB (lib/render/art-source.ts), above
--    this. The MIME list is unchanged (png, jpeg, webp, gif) and restated so
--    the row reads whole.
--
-- 2. `card-art-incoming`: a NEW PRIVATE bucket, the same limits.
--    A Vercel Function takes at most 4.5 MB of request body (413
--    FUNCTION_PAYLOAD_TOO_LARGE, every plan), so the FormData server action
--    that carried the art could never receive a print-size file — whatever
--    next.config's `serverActions.bodySizeLimit` or 0004's 8 MB said. Now
--    the browser PUTs the file to a signed upload URL that
--    startCardArtUploadAction mints (service role) for ONE server-made name,
--    `{userId}/{uuid}.upload`, in this bucket; finishCardArtUploadAction
--    reads it back with the service role, runs the byte sniff, the metadata
--    strip and the moderation scan, writes the real object into card-art and
--    removes the staged one (lib/cards/upload-art-server.ts,
--    lib/media/user-storage.ts userUploadStaging).
--      * public = false and NO policy on storage.objects for it: no API role
--        can list, read, write or delete here (0126's rule — never add an
--        owner-folder write policy — holds). A signed upload URL is Storage's
--        own one-object grant (2 hours, no overwrite), not a policy.
--      * No picture column can point here: 0127's media_url_allowed() takes
--        card-art / set-covers / profile-media / custom-pips objects only.
--      * Storage enforces this row's file_size_limit and allowed_mime_types
--        on the signed upload itself.
--      * An upload whose finish never came is removed by the same user's
--        next start (older than 3 hours) and by account deletion
--        (lib/account/actions.ts); nothing else reads the bucket.
--
-- Grants: none changed. storage.buckets / storage.objects privileges are
-- Supabase-managed and untouched; this migration updates one storage.buckets
-- row and inserts another, and creates no policy, table or function.
--
-- Idempotent: `on conflict (id) do update` for both rows — re-running sets
-- the same values.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-art',
  'card-art',
  true,
  20971520,  -- 20 MiB (lib/cards/art-upload-limits.ts CARD_ART_MAX_BYTES)
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-art-incoming',
  'card-art-incoming',
  false,
  20971520,  -- 20 MiB (lib/cards/art-upload-limits.ts CARD_ART_MAX_BYTES)
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

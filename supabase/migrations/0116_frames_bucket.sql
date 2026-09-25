-- 0116 — the `frames` storage bucket (frames plan 4.2).
--
-- Frame masters (1500×2100 PNG, what the Satori bake reads) and their WebP
-- siblings (what the browser preview draws) move out of git into this
-- bucket, starting with the Card Conjurer-sourced M15 family, which must
-- never be committed to the public repo. Objects are CONTENT-ADDRESSED
-- (`<template>/<name>.<sha256-12>.<ext>`) and listed in
-- lib/frames/frame-manifest.json, so a replaced frame is a new URL: CDN and
-- in-memory caches never serve a stale master, and old URLs keep working
-- for anything that still points at them.
--
-- Public-read so the preview can use a plain URL and the bake can fetch it
-- without a key. NO write policies: only the service role writes, through
-- scripts/frames-publish.mjs (dev/preview project) and the owner-run
-- scripts/frames-promote.mjs (production). No broad SELECT policy on
-- storage.objects either — public buckets serve object URLs without it
-- (same posture as card-renders, 0021).
--
-- Every environment gets the bucket (this runs on production, the dev
-- branch and each preview branch); which bucket an environment READS is
-- NEXT_PUBLIC_FRAME_ORIGIN / NEXT_PUBLIC_SUPABASE_URL — see docs/FRAMES.md.
--
-- Grants: none. No table or function is created; storage.objects access for
-- this bucket is decided by the (absent) policies above and the service
-- role's bypass.
--
-- Ships through a PR; never applied ad-hoc.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'frames',
  'frames',
  true,
  20971520,
  array['image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

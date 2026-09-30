-- 0131 — card art up to 20 MiB, uploaded through a private staging bucket
-- (TODO 6.10, third item; owner decision 2026-09-29: "the art upload limit is
-- raised in a follow-up"). Ships through a PR; never applied ad-hoc.
--
-- MERGE ORDER: after 0130 (the emblems PR, #421). This file touches
-- storage.buckets and adds one service-role table + function of its own, so
-- it does not depend on 0130's contents — the number is what orders them.
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
--    first claims it (3. below), reads it back with the service role, runs
--    the byte sniff, the metadata strip and the moderation scan, writes the
--    real object into card-art and overwrites the staged one with an 8-byte
--    non-image tombstone
--    (lib/cards/upload-art-server.ts, lib/media/user-storage.ts
--    userUploadStaging): a signed upload URL only refuses to OVERWRITE, so a
--    deleted key could be put again with the same token and finished twice
--    on one counted upload.
--      * public = false and NO policy on storage.objects for it: no API role
--        can list, read, write or delete here (0126's rule — never add an
--        owner-folder write policy — holds). A signed upload URL is Storage's
--        own one-object grant (2 hours, no overwrite), not a policy.
--      * No picture column can point here: 0127's media_url_allowed() takes
--        card-art / set-covers / profile-media / custom-pips objects only.
--      * Storage enforces this row's file_size_limit and allowed_mime_types
--        on the signed upload itself.
--      * An upload whose finish never came, and a tombstone, is removed by
--        the same user's next start (older than 3 hours, past the token's 2)
--        and by account deletion
--        (lib/account/actions.ts); nothing else reads the bucket.
--
-- 3. `card_art_upload_claims` + claim_card_art_upload(): ONE finish per
--    staged upload (review 2026-09-29). The tombstone is written AFTER the
--    finish has read the file, so finishes fired in parallel on one name all
--    read it first — each stored a copy on ONE counted start, which undid
--    the upload rate limit for anyone scripting the action. Storage can't
--    arbitrate it: racing uploads of one key without upsert all succeed
--    (seen in CI against the local stack) — only a primary key can. The
--    finish calls claim_card_art_upload(user, name) before it reads
--    anything; `insert … on conflict do nothing` returns true to exactly one
--    caller per (user, name). A claim older than a day (the signed URL it
--    guards lives 2 hours) is pruned by the next claim, up to 500 at a time.
--
-- Grants: storage.buckets / storage.objects privileges are Supabase-managed
-- and untouched (two storage.buckets rows, no storage policy). The claim
-- table and function are service_role only — revoked from public / anon /
-- authenticated, like 0127's upload_hits: RLS on, no policy.
--
-- Idempotent: `on conflict (id) do update` for both bucket rows, `if not
-- exists` for the table and index, `create or replace` for the function;
-- the grants are re-stated.

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

-- 3. One finish per staged upload --------------------------------------------

create table if not exists public.card_art_upload_claims (
  user_id uuid not null references auth.users (id) on delete cascade,
  staged_name text not null check (char_length(staged_name) between 1 and 200),
  claimed_at timestamptz not null default now(),
  primary key (user_id, staged_name)
);

create index if not exists card_art_upload_claims_claimed_at_idx
  on public.card_art_upload_claims (claimed_at);

alter table public.card_art_upload_claims enable row level security;

create or replace function public.claim_card_art_upload(
  p_user_id uuid,
  p_staged_name text
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_user_id is null or p_staged_name is null or p_staged_name = '' then
    raise exception 'card art claim: a user id and a staged name are required';
  end if;

  -- Housekeeping: up to 500 claims older than a day, anyone's. A row another
  -- call has locked is skipped, never waited on.
  with expired as (
    select c.user_id, c.staged_name
      from public.card_art_upload_claims as c
     where c.claimed_at <= now() - interval '1 day'
     limit 500
       for update skip locked
  )
  delete from public.card_art_upload_claims as c
   using expired as e
   where c.user_id = e.user_id
     and c.staged_name = e.staged_name;

  -- The primary key decides: of calls racing on one (user, name), one
  -- inserts; the others wait for it, then insert nothing.
  insert into public.card_art_upload_claims (user_id, staged_name)
  values (p_user_id, p_staged_name)
  on conflict (user_id, staged_name) do nothing;

  return found;
end;
$$;

revoke all on table public.card_art_upload_claims from public, anon, authenticated;
grant select, insert, delete on table public.card_art_upload_claims to service_role;

revoke all on function public.claim_card_art_upload(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_card_art_upload(uuid, text)
  to service_role;

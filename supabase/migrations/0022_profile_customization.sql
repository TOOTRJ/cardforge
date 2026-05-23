-- 0022 — Profile customization: socials, banner, avatar, pinned cards, accent.
--
-- Additive only. Every column is nullable and bounded by a CHECK constraint
-- mirroring the zod schemas in lib/auth/schemas.ts. Strings cap at 2048
-- characters (same as website_url) so an attacker can't pad a profile row.
--
-- Storage: a single `profile-media` bucket holds avatars + banners under
-- `{owner_id}/avatar.{ext}` and `{owner_id}/banner.{ext}`. Server-side
-- upload actions validate the actual bytes via Sharp (see lib/cards/
-- upload-art-server.ts pattern). The bucket-level RLS just gates writes to
-- the owner's folder; SELECT is bucket-public so URLs render anywhere.

-- ===========================================================================
-- profiles — additive columns
-- ===========================================================================

alter table public.profiles
  add column if not exists banner_url text,
  add column if not exists accent_color text,
  add column if not exists twitter_url text,
  add column if not exists bluesky_url text,
  add column if not exists instagram_url text,
  add column if not exists youtube_url text,
  add column if not exists tiktok_url text,
  add column if not exists discord_url text,
  add column if not exists github_url text,
  add column if not exists pinned_card_ids uuid[] not null default array[]::uuid[];

-- Reasonably-sized text columns. 2048 matches website_url's existing cap.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_banner_url_length'
  ) then
    alter table public.profiles
      add constraint profiles_banner_url_length
        check (banner_url is null or char_length(banner_url) <= 2048);
  end if;

  -- Accent color is stored as a 7-char hex (#RRGGBB). Anything else is
  -- rejected at the DB so a client bypass can't inject CSS-like junk.
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_accent_color_format'
  ) then
    alter table public.profiles
      add constraint profiles_accent_color_format
        check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_social_urls_length'
  ) then
    alter table public.profiles
      add constraint profiles_social_urls_length check (
        (twitter_url is null or char_length(twitter_url) <= 2048)
        and (bluesky_url is null or char_length(bluesky_url) <= 2048)
        and (instagram_url is null or char_length(instagram_url) <= 2048)
        and (youtube_url is null or char_length(youtube_url) <= 2048)
        and (tiktok_url is null or char_length(tiktok_url) <= 2048)
        and (discord_url is null or char_length(discord_url) <= 2048)
        and (github_url is null or char_length(github_url) <= 2048)
      );
  end if;

  -- Pinned cards: at most 3 entries. Postgres CHECK constraints can't run
  -- subqueries, so uniqueness is enforced in the zod schema on the write
  -- path (see pinnedCardIdsSchema in lib/auth/schemas.ts). We don't
  -- FK-constrain the array either (Postgres doesn't support array FKs);
  -- the read side filters out cards that no longer exist or aren't public.
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_pinned_card_ids_limit'
  ) then
    alter table public.profiles
      add constraint profiles_pinned_card_ids_limit
        check (
          array_length(pinned_card_ids, 1) is null
          or array_length(pinned_card_ids, 1) <= 3
        );
  end if;
end $$;

-- ===========================================================================
-- profile-media storage bucket
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-media',
  'profile-media',
  true,
  8388608,  -- 8 MB
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Owners can upload their own profile media" on storage.objects;
drop policy if exists "Owners can update their own profile media" on storage.objects;
drop policy if exists "Owners can delete their own profile media" on storage.objects;

create policy "Owners can upload their own profile media"
  on storage.objects
  for insert
  with check (
    bucket_id = 'profile-media'
    and auth.role() = 'authenticated'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Owners can update their own profile media"
  on storage.objects
  for update
  using (
    bucket_id = 'profile-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'profile-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Owners can delete their own profile media"
  on storage.objects
  for delete
  using (
    bucket_id = 'profile-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- 0127 — every user-media URL column holds OUR storage objects in the
-- writer's own folder, and uploads are rate-limited per user (TODO 3.14b,
-- owner decisions 2026-09-29).
--
-- 1. The picture URL columns.
--    0126 made storage writes and a card's render pointer server-only, but
--    the other picture URLs were still whatever their owner wrote through
--    PostgREST (length CHECKs only; `isSafeImageUrl` = any https): an outside
--    picture skipped the byte sniff, the metadata strip and the moderation
--    scan, and the surfaces that draw it sent every viewer's IP to that host.
--    Inventory (every writer in the app, 2026-09-29):
--
--      column                          kind            may hold
--      cards.art_url                   card-art        card-art/{uid}/… (or a built-in image: the seed cards)
--      cards.back_face ->> 'art_url'   card-art        card-art/{uid}/… (likewise)
--      cards.watermark ->> 'url'       watermark       card-art/{uid}/… (wm-*: design watermark / land icon)
--      cards.set_icon_url              set-icon        set-covers/{uid}/… or card-art/{uid}/… (old AI icons)
--      profiles.avatar_url             avatar          profile-media/{uid}/… or /defaults/avatars/avatar-01..25.webp
--      profiles.banner_url             banner          profile-media/{uid}/… or /defaults/banners/banner-01..25.webp
--      decks.cover_url                 deck-cover      set-covers/{uid}/… (upload) or card-art/{uid}/… (AI cover)
--      custom_pips.image_url           pip             custom-pips/{uid}/…?v=…
--      deck_cards.image_url            deck-card-image https://cards.scryfall.io/… only (deck import)
--
--    Uploads, AI art, Scryfall imports ("art the user keeps is copied into
--    card-art") and — since this PR — a remix of someone else's card (the
--    save copies the parent's pictures into the remixer's folder,
--    lib/cards/remix-media.ts) all land in the writer's own folder. The only
--    Scryfall URL the product stores is a deck entry's printing image.
--    Admin-only columns (challenges.hero_image_url, site_updates) and
--    card_exports.file_url (owner-only rows, no reader, no writer) are not
--    covered.
--
--    One guard trigger per table, the shape of 0126's
--    cards_guard_render_columns: SECURITY INVOKER, so current_user is the
--    caller's role; anon / authenticated may only KEEP a column's current
--    value, CLEAR it (NULL or ''), or set it to a value
--    public.media_url_allowed(kind, url, auth.uid()) accepts. Anything else is
--    insufficient_privilege (42501) with a `media_url_not_allowed:` message
--    (lib/media/media-url-errors.ts turns it into a friendly field error).
--    The service role, postgres (migrations, seeds) and SECURITY DEFINER
--    functions are not checked. Existing rows are grandfathered — the
--    triggers check changes only and this migration rewrites no data
--    (production's public + unlisted rows, 2026-09-29: every card art, set
--    icon, watermark, pip and deck cover in our storage in the owner's folder
--    except 2 remixes sharing their parent's art; 53 Google avatars, 33
--    built-in, 6 uploaded; 376 Scryfall deck images. The private-row
--    counts are the owner's read-only query in supabase/migrations/README.md).
--
--    "Our storage": the database can't know its own public host, so
--    public.storage_origins lists the origins our storage URLs are minted on.
--    This migration lists production's two (the custom domain and its
--    original project host, which older rows still name) and nothing else —
--    no other environment's host, no wildcard. Every other database learns
--    its OWN origin from the app: before its first write into a user folder
--    the server upserts the origin of its NEXT_PUBLIC_SUPABASE_URL with the
--    service role (lib/media/storage-origin.ts), so a preview branch, the
--    persistent dev branch and the local stack each accept exactly their own
--    storage and no other project's (review 2026-09-29: the dev host listed
--    here made production trust dev's storage; a seeded `*.supabase.co` made
--    every preview trust any Supabase project's, an attacker's included —
--    the table's CHECK now takes exact origins only, no wildcard). A storage
--    domain move registers itself the same way. The app's display
--    guard (lib/media/media-urls.ts isAllowedMediaUrl) checks the
--    deployment's own host and bucket before drawing any of these URLs, so
--    a legacy outside value is never drawn either.
--
-- 2. Signup metadata.
--    handle_new_user (0094) copied `avatar_url` / `picture` from the new
--    user's raw_user_meta_data — which any email signup can set to anything
--    (`auth.signUp({ options: { data: { avatar_url } } })`) — and runs as its
--    owner, past the guard. It now keeps one only when the account came from
--    Google sign-in — `raw_app_meta_data.provider = 'google'`, which GoTrue
--    sets and a user can't — AND it is a Google ACCOUNT picture
--    (`https://lhN.googleusercontent.com/a/…` or `/a-/…`; that host also
--    serves any Google Photos / Blogger / Sites image, review 2026-09-29).
--    Anything else leaves avatar_url NULL and the built-in default applies
--    (0095). Production's 53 Google avatars all have that shape. The rest of
--    the function is 0094's, unchanged.
--
-- 3. A card's back face is one of its owner's own cards.
--    back_card_id (0041) was checked only by the app (lib/cards/actions.ts),
--    so a PATCH through PostgREST could point a card's back face at another
--    user's public or unlisted card, and the card page's flip drew THEIR art
--    under this card's name (review 2026-09-29). cards_guard_back_card lets
--    anon / authenticated only keep it, clear it, or set another card with
--    the same owner (looked up under the caller's own RLS). Production's
--    public + unlisted cards: none has a back_card_id (2026-09-29); the card
--    page also skips a back card with another owner (legacy rows).
--
-- 4. The upload rate limit.
--    public.upload_hits keeps ONE row per counted upload (hit_at);
--    hit_upload_limit(user, per_minute, per_day) — service role only, called
--    by every upload action BEFORE its write (lib/media/upload-rate-limit.ts,
--    30 a minute and 300 a day) — takes a per-user advisory lock and counts
--    the user's hits in the last 60 seconds and the last 24 hours EXACTLY
--    (sliding windows: calendar minutes let ~60 uploads through in two
--    seconds across a minute boundary — review 2026-09-29). Over either it
--    answers (false, seconds until the oldest hit in that window leaves,
--    'minute' | 'day') without counting, else it counts the hit and answers
--    (true, 0, null). A refused call is never counted, so a user holds at
--    most `per_day` rows. Admins are exempt: the function reads
--    profiles.is_admin itself, never a flag from the caller. Housekeeping:
--    each call deletes up to 500 rows the day no longer reads, anyone's,
--    skipping rows another call has locked (never waiting on another user's
--    upload) — no prune job. Account deletion cascades.
--
-- Grants (every migration states them; never a blanket grant):
--   * storage_origins: SELECT for anon + authenticated (the invoker triggers
--     read it; a list of our storage hosts is no secret), all for
--     service_role; RLS on with one read-all policy and no write policy.
--   * media_url_allowed / media_url_change_allowed: EXECUTE for anon,
--     authenticated, service_role — the invoker triggers call them as the
--     caller's role; they are pure predicates over their arguments and the
--     origin list.
--   * the six guard trigger functions (five media guards + the back-card
--     guard): EXECUTE revoked from public, anon, authenticated (a trigger
--     fires regardless; no API role may call one).
--   * upload_hits + hit_upload_limit: service_role only.
--   * handle_new_user: EXECUTE stays revoked from public, anon, authenticated.
--
-- Ships through a PR; never applied ad-hoc.

-- 1. Our storage origins ---------------------------------------------------

-- One exact origin per row — no wildcard can be stored, by anyone.
create table if not exists public.storage_origins (
  origin text primary key
    check (origin ~ '^https?://[a-z0-9.-]+(:[0-9]{1,5})?$'),
  note text
);

alter table public.storage_origins enable row level security;

drop policy if exists "Storage origins are readable by everyone" on public.storage_origins;
create policy "Storage origins are readable by everyone"
  on public.storage_origins for select using (true);

-- Production's only. Any other database (the dev branch, a preview branch,
-- the local stack) gets its own origin from the app, never from here.
insert into public.storage_origins (origin, note) values
  ('https://auth.pipglyph.com', 'production: the custom domain (since 2026-07)'),
  ('https://zkwkisxoqdhdchqyjwdc.supabase.co', 'production: the project host (URLs minted before 2026-07)')
on conflict (origin) do nothing;

revoke all on table public.storage_origins from public, anon, authenticated;
grant select on table public.storage_origins to anon, authenticated;
grant select, insert, update, delete on table public.storage_origins to service_role;

-- 2. Which URL a user may store --------------------------------------------

-- True when `p_url` may be stored in a column of this kind by `p_owner`: a
-- public object URL on one of our storage origins, in a bucket of this kind,
-- directly inside `p_owner`'s folder, under a plain file name (optionally
-- `?v=<digits>`, the pip's cache-buster) — or a built-in profile image, or a
-- Scryfall printing image for a deck entry. Mirrors lib/media/media-urls.ts.
create or replace function public.media_url_allowed(p_kind text, p_url text, p_owner uuid)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_buckets text[];
  v_parts text[];
begin
  if p_url is null then
    return false;
  end if;
  if p_kind = 'avatar' and p_url ~ '^/defaults/avatars/avatar-(0[1-9]|1[0-9]|2[0-5])\.webp$' then
    return true;
  end if;
  if p_kind = 'banner' and p_url ~ '^/defaults/banners/banner-(0[1-9]|1[0-9]|2[0-5])\.webp$' then
    return true;
  end if;
  -- PipGlyph's own built-in images (public/defaults) as card art — what the
  -- dev / preview seed cards use (supabase/seeds/10_dev_data.sql), so a
  -- remix of one saves.
  if p_kind = 'card-art'
     and p_url ~ '^(https://(www\.)?pipglyph\.com)?/defaults/(avatars/avatar|banners/banner)-(0[1-9]|1[0-9]|2[0-5])\.webp$' then
    return true;
  end if;
  if p_kind = 'deck-card-image' then
    return p_url ~ '^https://cards\.scryfall\.io/[A-Za-z0-9_./-]+(\?[0-9]{1,20})?$'
       and position('..' in p_url) = 0;
  end if;
  v_buckets := case p_kind
    when 'card-art' then array['card-art']
    when 'watermark' then array['card-art']
    when 'set-icon' then array['set-covers', 'card-art']
    when 'deck-cover' then array['set-covers', 'card-art']
    when 'avatar' then array['profile-media']
    when 'banner' then array['profile-media']
    when 'pip' then array['custom-pips']
  end;
  if v_buckets is null or p_owner is null then
    return false;
  end if;
  v_parts := regexp_match(
    p_url,
    '^(https?://[a-z0-9.-]+(?::[0-9]{1,5})?)/storage/v1/object/public/([a-z-]+)/([0-9a-f-]{36})/([A-Za-z0-9][A-Za-z0-9._-]{0,199})(?:\?v=[0-9]{1,20})?$'
  );
  if v_parts is null then
    return false;
  end if;
  return v_parts[2] = any (v_buckets)
     and v_parts[3] = p_owner::text
     and position('..' in v_parts[4]) = 0
     and exists (
       select 1
       from public.storage_origins as o
       where o.origin = v_parts[1]
     );
end;
$$;

-- A write is fine when the new value is empty, unchanged, or allowed for the
-- signed-in caller.
create or replace function public.media_url_change_allowed(p_kind text, p_old text, p_new text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_new is null
      or p_new = ''
      or p_new is not distinct from p_old
      or public.media_url_allowed(p_kind, p_new, auth.uid());
$$;

revoke all on function public.media_url_allowed(text, text, uuid) from public;
grant execute on function public.media_url_allowed(text, text, uuid)
  to anon, authenticated, service_role;
revoke all on function public.media_url_change_allowed(text, text, text) from public;
grant execute on function public.media_url_change_allowed(text, text, text)
  to anon, authenticated, service_role;

-- 3. The guard triggers ----------------------------------------------------

create or replace function public.guard_card_media_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old_art text;
  v_old_back_art text;
  v_old_watermark text;
  v_old_icon text;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_old_art := old.art_url;
    v_old_back_art := old.back_face ->> 'art_url';
    v_old_watermark := old.watermark ->> 'url';
    v_old_icon := old.set_icon_url;
  end if;
  if not public.media_url_change_allowed('card-art', v_old_art, new.art_url) then
    raise exception 'media_url_not_allowed: cards.art_url must be one of your own uploads'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.media_url_change_allowed('card-art', v_old_back_art, new.back_face ->> 'art_url') then
    raise exception 'media_url_not_allowed: cards.back_face art_url must be one of your own uploads'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.media_url_change_allowed('watermark', v_old_watermark, new.watermark ->> 'url') then
    raise exception 'media_url_not_allowed: cards.watermark url must be one of your own uploads'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.media_url_change_allowed('set-icon', v_old_icon, new.set_icon_url) then
    raise exception 'media_url_not_allowed: cards.set_icon_url must be one of your own uploads'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists cards_guard_media_columns on public.cards;
create trigger cards_guard_media_columns
  before insert or update of art_url, back_face, watermark, set_icon_url
  on public.cards
  for each row execute function public.guard_card_media_columns();

create or replace function public.guard_profile_media_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old_avatar text;
  v_old_banner text;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_old_avatar := old.avatar_url;
    v_old_banner := old.banner_url;
  end if;
  if not public.media_url_change_allowed('avatar', v_old_avatar, new.avatar_url) then
    raise exception 'media_url_not_allowed: profiles.avatar_url must be one of your own uploads or a built-in image'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.media_url_change_allowed('banner', v_old_banner, new.banner_url) then
    raise exception 'media_url_not_allowed: profiles.banner_url must be one of your own uploads or a built-in image'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- Named to sort after profiles_assign_default_media (0095): a new profile
-- is checked with its built-in pair already dealt.
drop trigger if exists profiles_guard_media_columns on public.profiles;
create trigger profiles_guard_media_columns
  before insert or update of avatar_url, banner_url
  on public.profiles
  for each row execute function public.guard_profile_media_columns();

create or replace function public.guard_deck_media_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old_cover text;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_old_cover := old.cover_url;
  end if;
  if not public.media_url_change_allowed('deck-cover', v_old_cover, new.cover_url) then
    raise exception 'media_url_not_allowed: decks.cover_url must be one of your own uploads'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists decks_guard_media_columns on public.decks;
create trigger decks_guard_media_columns
  before insert or update of cover_url
  on public.decks
  for each row execute function public.guard_deck_media_columns();

create or replace function public.guard_custom_pip_media_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old_image text;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_old_image := old.image_url;
  end if;
  if not public.media_url_change_allowed('pip', v_old_image, new.image_url) then
    raise exception 'media_url_not_allowed: custom_pips.image_url must be one of your own uploads'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists custom_pips_guard_media_columns on public.custom_pips;
create trigger custom_pips_guard_media_columns
  before insert or update of image_url
  on public.custom_pips
  for each row execute function public.guard_custom_pip_media_columns();

create or replace function public.guard_deck_card_media_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old_image text;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_old_image := old.image_url;
  end if;
  if not public.media_url_change_allowed('deck-card-image', v_old_image, new.image_url) then
    raise exception 'media_url_not_allowed: deck_cards.image_url must be a Scryfall printing image'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists deck_cards_guard_media_columns on public.deck_cards;
create trigger deck_cards_guard_media_columns
  before insert or update of image_url
  on public.deck_cards
  for each row execute function public.guard_deck_card_media_columns();

revoke all on function public.guard_card_media_columns() from public, anon, authenticated;
revoke all on function public.guard_profile_media_columns() from public, anon, authenticated;
revoke all on function public.guard_deck_media_columns() from public, anon, authenticated;
revoke all on function public.guard_custom_pip_media_columns() from public, anon, authenticated;
revoke all on function public.guard_deck_card_media_columns() from public, anon, authenticated;

-- 4. A card's back face: another of the owner's own cards -------------------

create or replace function public.guard_card_back_card()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old_back uuid;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_old_back := old.back_card_id;
  end if;
  if new.back_card_id is null or new.back_card_id is not distinct from v_old_back then
    return new;
  end if;
  -- Read under the caller's own RLS: their own cards, whatever the
  -- visibility; another user's card never matches the owner.
  if not exists (
    select 1
      from public.cards as c
     where c.id = new.back_card_id
       and c.id <> new.id
       and c.owner_id = new.owner_id
  ) then
    raise exception 'back_card_not_allowed: cards.back_card_id must be another of your own cards'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists cards_guard_back_card on public.cards;
create trigger cards_guard_back_card
  before insert or update of back_card_id
  on public.cards
  for each row execute function public.guard_card_back_card();

revoke all on function public.guard_card_back_card() from public, anon, authenticated;

-- 5. Signup metadata: only a Google sign-in's account picture ---------------

-- 0094's function with one change: meta_avatar.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_username text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  meta_display_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', '')
  );
  meta_avatar text := coalesce(
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(new.raw_user_meta_data ->> 'picture', '')
  );
  chosen text;
begin
  -- Any signup can put anything in its user metadata: keep an avatar only
  -- for a Google sign-in (raw_app_meta_data.provider — GoTrue's, never the
  -- user's) and only a Google ACCOUNT picture (`/a/…`, `/a-/…`; the same
  -- host serves any Google Photos image). Anything else gets the built-in
  -- default (profiles_assign_default_media, 0095).
  if meta_avatar is not null
     and (coalesce(new.raw_app_meta_data ->> 'provider', '') <> 'google'
          or meta_avatar !~ '^https://lh[0-9]{1,2}\.googleusercontent\.com/a-?/[A-Za-z0-9_./=-]+$') then
    meta_avatar := null;
  end if;

  -- Honour the requested handle only when it would pass every rule; anything
  -- else (OAuth signups send none) gets a generated one the user can change
  -- during onboarding. The email address is never used.
  if meta_username ~ '^[a-z0-9_]{3,32}$'
     and not public.is_reserved_username(meta_username)
     and not exists (select 1 from public.profiles where username = meta_username)
  then
    chosen := meta_username;
  else
    chosen := public.generate_username();
  end if;

  -- The existence checks above race with concurrent signups; retry on the
  -- unique index instead of failing the signup (an exception here would
  -- abort the auth.users insert).
  for attempt in 1..5 loop
    begin
      insert into public.profiles (id, username, display_name, avatar_url)
      values (
        new.id,
        chosen,
        left(coalesce(meta_display_name, chosen), 64),
        meta_avatar
      )
      on conflict (id) do nothing;
      return new;
    exception when unique_violation then
      chosen := public.generate_username();
    end;
  end loop;

  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    'mage_' || substr(replace(new.id::text, '-', ''), 1, 16),
    left(coalesce(meta_display_name, 'New creator'), 64),
    meta_avatar
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 6. The upload rate limit -------------------------------------------------

-- One row per counted upload. `hits` > 1 only when two calls of one user
-- land on the same microsecond.
create table if not exists public.upload_hits (
  user_id uuid not null references auth.users (id) on delete cascade,
  hit_at timestamptz not null,
  hits integer not null default 1 check (hits > 0),
  primary key (user_id, hit_at)
);

create index if not exists upload_hits_hit_at_idx
  on public.upload_hits (hit_at);

alter table public.upload_hits enable row level security;

create or replace function public.hit_upload_limit(
  p_user_id uuid,
  p_per_minute integer,
  p_per_day integer
)
returns table (allowed boolean, retry_after_seconds integer, limited_by text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz;
  v_minute integer;
  v_day integer;
  v_minute_oldest timestamptz;
  v_day_oldest timestamptz;
begin
  if p_user_id is null then
    raise exception 'upload limit: a user id is required';
  end if;
  if p_per_minute is null or p_per_minute < 1
     or p_per_day is null or p_per_day < p_per_minute then
    raise exception 'upload limit: bad limits (% / %)', p_per_minute, p_per_day;
  end if;

  -- Admins are exempt (owner decision 2026-09-29) — read here, never taken
  -- from the caller.
  if exists (select 1 from public.profiles as p where p.id = p_user_id and p.is_admin) then
    return query select true, 0, null::text;
    return;
  end if;

  -- One call per user at a time: two concurrent uploads can't both slip in
  -- under the limit. The clock is read once the lock is held, so one user's
  -- hits are stored in the order they were counted.
  perform pg_advisory_xact_lock(hashtextextended('upload_hits:' || p_user_id::text, 0));
  v_now := clock_timestamp();

  -- Housekeeping: up to 500 hits the day no longer reads, anyone's. A row
  -- another call has locked is skipped, never waited on.
  with expired as (
    select h.user_id, h.hit_at
      from public.upload_hits as h
     where h.hit_at <= v_now - interval '1 day'
     limit 500
       for update skip locked
  )
  delete from public.upload_hits as h
   using expired as e
   where h.user_id = e.user_id
     and h.hit_at = e.hit_at;

  -- Sliding windows, exactly: the last 60 seconds and the last 24 hours.
  select coalesce(sum(h.hits) filter (where h.hit_at > v_now - interval '1 minute'), 0)::integer,
         coalesce(sum(h.hits), 0)::integer,
         min(h.hit_at) filter (where h.hit_at > v_now - interval '1 minute'),
         min(h.hit_at)
    into v_minute, v_day, v_minute_oldest, v_day_oldest
    from public.upload_hits as h
   where h.user_id = p_user_id
     and h.hit_at > v_now - interval '1 day';

  if v_minute >= p_per_minute then
    -- A slot frees when the oldest hit of the last minute leaves it.
    return query
    select false,
           greatest(1, ceil(extract(epoch from (v_minute_oldest + interval '1 minute' - v_now))))::integer,
           'minute'::text;
    return;
  end if;

  if v_day >= p_per_day then
    -- …and of the last day.
    return query
    select false,
           greatest(1, ceil(extract(epoch from (v_day_oldest + interval '1 day' - v_now))))::integer,
           'day'::text;
    return;
  end if;

  insert into public.upload_hits as h (user_id, hit_at, hits)
  values (p_user_id, v_now, 1)
  on conflict (user_id, hit_at) do update set hits = h.hits + 1;

  return query select true, 0, null::text;
end;
$$;

revoke all on table public.upload_hits from public, anon, authenticated;
grant select, insert, update, delete on table public.upload_hits to service_role;

revoke all on function public.hit_upload_limit(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.hit_upload_limit(uuid, integer, integer)
  to service_role;

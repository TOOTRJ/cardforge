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
--    public.storage_origins lists the origins our storage URLs are minted on
--    (production's custom domain and its original project host, the
--    persistent dev branch). supabase/seed.sql adds the local stack and
--    `https://*.supabase.co` (every per-PR preview branch has its own host) —
--    seeds never run on production, so there only the exact origins pass. If
--    the storage domain ever moves, a migration adds the new origin BEFORE
--    NEXT_PUBLIC_SUPABASE_URL changes (uploads would otherwise save-fail).
--    The app's display guard (lib/media/media-urls.ts isAllowedMediaUrl)
--    checks the deployment's own host and bucket before drawing any of these
--    URLs, so a legacy outside value is never drawn either.
--
-- 2. Signup metadata.
--    handle_new_user (0094) copied `avatar_url` / `picture` from the new
--    user's raw_user_meta_data — which any email signup can set to anything
--    (`auth.signUp({ options: { data: { avatar_url } } })`) — and runs as its
--    owner, past the guard. It now keeps only a Google profile picture
--    (`https://lhN.googleusercontent.com/…`, what Google sign-in sends);
--    anything else leaves avatar_url NULL and the built-in default applies
--    (0095). The rest of the function is 0094's, unchanged.
--
-- 3. The upload rate limit.
--    public.upload_hits counts each user's uploads per minute;
--    hit_upload_limit(user, per_minute, per_day) — service role only, called
--    by every upload action BEFORE its write (lib/media/upload-rate-limit.ts,
--    30 a minute and 300 a rolling day) — takes a per-user advisory lock,
--    drops every window older than a day, and answers (false, seconds until a
--    slot frees, 'minute' | 'day') without counting, or counts the hit and
--    answers (true, 0, null). Admins are exempt: the function reads
--    profiles.is_admin itself, never a flag from the caller. The table holds
--    at most a day of minutes per active user — no prune job. Account
--    deletion cascades.
--
-- Grants (every migration states them; never a blanket grant):
--   * storage_origins: SELECT for anon + authenticated (the invoker triggers
--     read it; a list of our storage hosts is no secret), all for
--     service_role; RLS on with one read-all policy and no write policy.
--   * media_url_allowed / media_url_change_allowed: EXECUTE for anon,
--     authenticated, service_role — the invoker triggers call them as the
--     caller's role; they are pure predicates over their arguments and the
--     origin list.
--   * the five guard trigger functions: EXECUTE revoked from public, anon,
--     authenticated (a trigger fires regardless; no API role may call one).
--   * upload_hits + hit_upload_limit: service_role only.
--   * handle_new_user: EXECUTE stays revoked from public, anon, authenticated.
--
-- Ships through a PR; never applied ad-hoc.

-- 1. Our storage origins ---------------------------------------------------

create table if not exists public.storage_origins (
  origin text primary key
    check (origin ~ '^https?://(\*\.)?[a-z0-9.-]+(:[0-9]{1,5})?$'),
  note text
);

alter table public.storage_origins enable row level security;

drop policy if exists "Storage origins are readable by everyone" on public.storage_origins;
create policy "Storage origins are readable by everyone"
  on public.storage_origins for select using (true);

insert into public.storage_origins (origin, note) values
  ('https://auth.pipglyph.com', 'production: the custom domain (since 2026-07)'),
  ('https://zkwkisxoqdhdchqyjwdc.supabase.co', 'production: the project host (URLs minted before 2026-07)'),
  ('https://znipzaxgpaiandwiqabn.supabase.co', 'the persistent dev branch')
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
          or (o.origin like '%://*.%'
              and v_parts[1] ~ ('^' || replace(replace(o.origin, '.', '\.'), '*', '[a-z0-9-]+') || '$'))
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

-- 4. Signup metadata: only a Google profile picture -------------------------

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
  -- Any signup can put anything in its metadata: keep only a Google profile
  -- picture (what Google sign-in sends). Anything else gets the built-in
  -- default (profiles_assign_default_media, 0095).
  if meta_avatar is not null
     and meta_avatar !~ '^https://lh[0-9]{1,2}\.googleusercontent\.com/[A-Za-z0-9_./=-]+$' then
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

-- 5. The upload rate limit -------------------------------------------------

create table if not exists public.upload_hits (
  user_id uuid not null references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  hits integer not null default 1 check (hits > 0),
  primary key (user_id, window_start)
);

create index if not exists upload_hits_window_idx
  on public.upload_hits (window_start);

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
  v_window timestamptz := date_trunc('minute', now());
  v_minute integer;
  v_day integer;
  v_oldest timestamptz;
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
  -- under the limit.
  perform pg_advisory_xact_lock(hashtextextended('upload_hits:' || p_user_id::text, 0));

  -- Every user's windows the day no longer reads.
  delete from public.upload_hits as h
   where h.window_start <= v_window - interval '1 day';

  select coalesce(sum(h.hits) filter (where h.window_start = v_window), 0)::integer,
         coalesce(sum(h.hits), 0)::integer,
         min(h.window_start)
    into v_minute, v_day, v_oldest
    from public.upload_hits as h
   where h.user_id = p_user_id
     and h.window_start > v_window - interval '1 day';

  if v_minute >= p_per_minute then
    return query
    select false,
           greatest(1, ceil(extract(epoch from (v_window + interval '1 minute' - now()))))::integer,
           'minute'::text;
    return;
  end if;

  if v_day >= p_per_day then
    -- The oldest counted minute leaves the day at window_start + 1 day.
    return query
    select false,
           greatest(1, ceil(extract(epoch from (v_oldest + interval '1 day' - now()))))::integer,
           'day'::text;
    return;
  end if;

  insert into public.upload_hits as h (user_id, window_start, hits)
  values (p_user_id, v_window, 1)
  on conflict (user_id, window_start) do update set hits = h.hits + 1;

  return query select true, 0, null::text;
end;
$$;

revoke all on table public.upload_hits from public, anon, authenticated;
grant select, insert, update, delete on table public.upload_hits to service_role;

revoke all on function public.hit_upload_limit(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.hit_upload_limit(uuid, integer, integer)
  to service_role;

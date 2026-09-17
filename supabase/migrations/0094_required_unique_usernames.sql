-- 0094_required_unique_usernames.sql — every profile has a username, always.
-- Ships through a PR; never applied ad-hoc.
--
-- profiles.username has been UNIQUE since 0001, but it was NULLABLE and
-- handle_new_user() answered a collision by inserting the profile with NO
-- username. A null handle breaks every /profile/[username] and
-- /card/[username]/[slug] link for that account, hides its cards' byline and
-- silently accumulates (NULLs never collide with each other). OAuth signups
-- were the main source: they carry no username, so the trigger derived one
-- from the EMAIL LOCAL PART — which both collides easily and publishes half of
-- the user's email address on their public profile.
--
-- This migration:
--   1. is_reserved_username()  — handles nobody may claim (staff/system/route
--      words). Mirrored in lib/auth/usernames.ts for the friendly form error.
--   2. generate_username()     — a neutral, MTG-flavoured handle
--      ("ember_sphinx_4821") that is free at the time of the call.
--   3. handle_new_user()       — uses the requested username when it is valid,
--      free and not reserved; otherwise a generated one. Never derives from the
--      email address, never leaves username NULL, never fails the signup.
--   4. Backfills existing NULL usernames and makes the column NOT NULL.
--   5. A guard trigger so a user-driven write cannot set a reserved handle
--      (the app checks first; this is the backstop for direct PostgREST calls).
--
-- Uniqueness stays case-insensitive in effect: profiles_username_format (0001)
-- only admits lowercase, so the plain unique index is sufficient.

-- 1. Reserved handles ---------------------------------------------------------
create or replace function public.is_reserved_username(p_username text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(coalesce(p_username, '')) = any (array[
    -- staff / impersonation
    'admin', 'administrator', 'pipglyph', 'pipglyph_team', 'pipglyph_admin',
    'support', 'help', 'staff', 'team', 'moderator', 'mod', 'mods', 'official',
    'system', 'root', 'owner', 'security', 'billing', 'abuse', 'legal',
    'wizards', 'wotc', 'hasbro',
    -- placeholders
    'null', 'undefined', 'anonymous', 'deleted', 'unknown', 'everyone', 'here',
    'user', 'username', 'guest', 'test',
    -- route words (kept free in case profiles ever move to /[username])
    'api', 'www', 'app', 'auth', 'login', 'logout', 'signup', 'signin',
    'register', 'settings', 'dashboard', 'onboarding', 'profile', 'profiles',
    'gallery', 'create', 'card', 'cards', 'deck', 'decks', 'set', 'sets',
    'feed', 'news', 'pricing', 'press', 'privacy', 'terms', 'about',
    'messages', 'notifications', 'feedback', 'unsubscribe', 'new', 'edit'
  ]);
$$;

revoke all on function public.is_reserved_username(text) from public, anon, authenticated;
grant execute on function public.is_reserved_username(text) to anon, authenticated;

-- 2. Generated handles --------------------------------------------------------
-- Generic fantasy vocabulary only — no Wizards of the Coast names.
create or replace function public.generate_username()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  adjectives constant text[] := array[
    'arcane', 'ember', 'gilded', 'umbral', 'verdant', 'azure', 'ashen',
    'silver', 'storm', 'rune', 'mystic', 'feral', 'radiant', 'hollow', 'iron',
    'crimson', 'lunar', 'solar', 'thorn', 'frost'
  ];
  nouns constant text[] := array[
    'drake', 'sphinx', 'golem', 'griffin', 'wyvern', 'shaman', 'knight',
    'druid', 'rogue', 'mage', 'hydra', 'phoenix', 'wurm', 'specter', 'sage',
    'smith', 'scribe', 'oracle', 'titan', 'familiar'
  ];
  candidate text;
begin
  for attempt in 1..20 loop
    candidate :=
      adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
      || '_' || nouns[1 + floor(random() * array_length(nouns, 1))::int]
      || '_' || lpad(floor(random() * 10000)::int::text, 4, '0');
    if not exists (select 1 from public.profiles where username = candidate) then
      return candidate;
    end if;
  end loop;
  -- 4M combinations exhausted 20 times in a row is not a real case; stay
  -- unique anyway.
  return 'mage_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
end;
$$;

revoke all on function public.generate_username() from public, anon, authenticated;

-- 3. Profile auto-create ------------------------------------------------------
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

-- 4. Backfill + NOT NULL ------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select id from public.profiles where username is null loop
    update public.profiles
      set username = public.generate_username()
      where id = r.id;
  end loop;
end;
$$;

alter table public.profiles alter column username set not null;

-- 5. Reserved-handle backstop for user-driven writes ---------------------------
-- auth.role() is 'authenticated'/'anon' only for PostgREST requests; the
-- signup trigger (GoTrue's own connection), the service role and migrations
-- pass through, so staff accounts can still be given a reserved handle.
create or replace function public.guard_profile_username()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  -- OLD is unassigned on INSERT (the settings upsert takes that path first),
  -- so the unchanged-handle exemption is its own branch.
  if tg_op = 'UPDATE' then
    if new.username is not distinct from old.username then
      return new;
    end if;
  elsif exists (
    select 1 from public.profiles p
    where p.id = new.id and p.username = new.username
  ) then
    -- INSERT … ON CONFLICT (id) DO UPDATE re-submitting the current handle.
    return new;
  end if;
  if public.is_reserved_username(new.username) then
    raise exception 'That username is reserved.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_profile_username() from public, anon, authenticated;

drop trigger if exists profiles_guard_username on public.profiles;
create trigger profiles_guard_username
  before insert or update of username on public.profiles
  for each row execute function public.guard_profile_username();

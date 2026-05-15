-- Phase 2 — Profiles table, RLS, and auto-create trigger.
-- Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP.

-- Extensions ----------------------------------------------------------------

create extension if not exists "pgcrypto";

-- Profiles table -----------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  bio text,
  website_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format
    check (
      username is null
      or (
        char_length(username) between 3 and 32
        and username ~ '^[a-z0-9_]+$'
      )
    ),
  constraint profiles_display_name_length
    check (display_name is null or char_length(display_name) <= 64),
  constraint profiles_bio_length
    check (bio is null or char_length(bio) <= 280),
  constraint profiles_website_url_length
    check (website_url is null or char_length(website_url) <= 2048)
);

create index if not exists profiles_username_idx on public.profiles (username);

-- updated_at trigger -------------------------------------------------------

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_profiles_updated_at();

-- Row-level security -------------------------------------------------------

alter table public.profiles enable row level security;

-- Drop & recreate policies so the migration is idempotent.
drop policy if exists "Profiles are publicly readable" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;

create policy "Profiles are publicly readable"
  on public.profiles
  for select
  using (true);

create policy "Users can insert their own profile"
  on public.profiles
  for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create profile on signup --------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_username text := nullif(new.raw_user_meta_data ->> 'username', '');
  meta_display_name text := nullif(new.raw_user_meta_data ->> 'display_name', '');
  derived_username text;
begin
  derived_username := coalesce(meta_username, lower(split_part(new.email, '@', 1)));

  -- Sanitize the derived username so it satisfies the username format check.
  derived_username := lower(regexp_replace(derived_username, '[^a-z0-9_]', '_', 'g'));
  if char_length(derived_username) < 3 then
    derived_username := derived_username || '_user';
  end if;
  if char_length(derived_username) > 32 then
    derived_username := substring(derived_username from 1 for 32);
  end if;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    derived_username,
    coalesce(meta_display_name, derived_username)
  )
  on conflict (id) do nothing;

  return new;
exception when unique_violation then
  -- Username collision: insert without it; the user can pick one in settings.
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(meta_display_name, lower(split_part(new.email, '@', 1))))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

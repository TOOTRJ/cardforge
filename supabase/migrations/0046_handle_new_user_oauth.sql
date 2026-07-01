-- 0046_handle_new_user_oauth.sql — populate profiles from OAuth (Google) signups.
--
-- Email/password signups pass username + display_name in user metadata. OAuth
-- signups (Google) instead carry full_name / name / avatar_url / picture. This
-- rewrites handle_new_user() to derive a display name + avatar from either
-- source, still deriving a username from the email when none was supplied (the
-- collision fallback leaves username null so the user can pick one in settings).
--
-- Body-only change; the AFTER INSERT trigger on auth.users and the EXECUTE
-- revokes from 0002 stay in place. Apply via `supabase db push` or the MCP.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_username text := nullif(new.raw_user_meta_data ->> 'username', '');
  meta_display_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', '')
  );
  meta_avatar text := coalesce(
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(new.raw_user_meta_data ->> 'picture', '')
  );
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

  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    derived_username,
    coalesce(meta_display_name, derived_username),
    meta_avatar
  )
  on conflict (id) do nothing;

  return new;
exception when unique_violation then
  -- Username collision: insert without it; the user can pick one in settings.
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(meta_display_name, lower(split_part(new.email, '@', 1))),
    meta_avatar
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

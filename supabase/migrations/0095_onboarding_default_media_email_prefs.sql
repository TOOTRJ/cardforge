-- 0095_onboarding_default_media_email_prefs.sql — first-run onboarding,
-- default profile art, and email preferences.
-- Ships through a PR; never applied ad-hoc.
--
--   1. profiles.onboarded_at        — NULL until the user finishes (or skips)
--      /onboarding; the (app) layout sends them there while it is NULL.
--      Existing accounts are stamped so nobody is pushed back through it.
--   2. Default avatar + banner      — every profile gets a random one of the
--      25 + 25 images in public/defaults at insert, so a profile is never
--      imageless; existing NULLs are backfilled. Stored as a site-relative
--      path (/defaults/avatars/avatar-07.webp) so the value is identical in
--      production, previews and local (lib/profile/default-media.ts).
--   3. email_preferences            — per-user opt-in/out, the unsubscribe
--      token, the digest watermark and the bounce suppression flag. Its own
--      table because profiles is world-readable (column grants, 0074) and
--      none of this is public.
--   4. newsletter_deliveries + site_updates.emailed_* — who was sent which
--      update by email, so "send again" only reaches new subscribers.
--   5. suppress_email()             — bounce/complaint webhook entry point.

-- 1. Onboarding marker ---------------------------------------------------------
alter table public.profiles
  add column if not exists onboarded_at timestamptz;

update public.profiles
  set onboarded_at = coalesce(created_at, now())
  where onboarded_at is null;

-- Public column list (0074): the flag is not sensitive, and the owner's own
-- read goes through the same grant.
grant select (onboarded_at) on public.profiles to anon, authenticated;

-- 2. Default profile art --------------------------------------------------------
-- Keep the counts in sync with lib/profile/default-media.ts and the files in
-- public/defaults (scripts/generate-default-profile-media.mjs).
create or replace function public.random_default_avatar()
returns text
language sql
volatile
set search_path = public
as $$
  select '/defaults/avatars/avatar-' || lpad((1 + floor(random() * 25))::int::text, 2, '0') || '.webp';
$$;

create or replace function public.random_default_banner()
returns text
language sql
volatile
set search_path = public
as $$
  select '/defaults/banners/banner-' || lpad((1 + floor(random() * 25))::int::text, 2, '0') || '.webp';
$$;

revoke all on function public.random_default_avatar() from public, anon, authenticated;
revoke all on function public.random_default_banner() from public, anon, authenticated;

create or replace function public.assign_default_profile_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.avatar_url is null then
    new.avatar_url := public.random_default_avatar();
  end if;
  if new.banner_url is null then
    new.banner_url := public.random_default_banner();
  end if;
  return new;
end;
$$;

revoke all on function public.assign_default_profile_media() from public, anon, authenticated;

drop trigger if exists profiles_assign_default_media on public.profiles;
create trigger profiles_assign_default_media
  before insert on public.profiles
  for each row execute function public.assign_default_profile_media();

-- Row-by-row so every existing profile draws its own random image.
update public.profiles set avatar_url = public.random_default_avatar() where avatar_url is null;
update public.profiles set banner_url = public.random_default_banner() where banner_url is null;

-- 3. Email preferences -----------------------------------------------------------
create table if not exists public.email_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Messages from the team, credit grants, plan changes, the welcome email.
  account_emails boolean not null default true,
  -- The daily digest of unread activity (likes, comments, follows, remixes…).
  activity_emails boolean not null default true,
  -- Marketing: opt-IN only, never pre-ticked.
  newsletter boolean not null default false,
  newsletter_consented_at timestamptz,
  -- Opaque key for the one-click unsubscribe links in every non-auth email.
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  -- Digest watermark: notifications created before this were already mailed.
  last_digest_at timestamptz,
  -- Set by the provider webhook on a hard bounce or spam complaint: no
  -- non-auth email is sent to this account until it is cleared.
  suppressed_at timestamptz,
  suppressed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_preferences enable row level security;

drop policy if exists "Users read their own email preferences" on public.email_preferences;
create policy "Users read their own email preferences"
  on public.email_preferences for select
  using (auth.uid() = user_id);

drop policy if exists "Users update their own email preferences" on public.email_preferences;
create policy "Users update their own email preferences"
  on public.email_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Users flip the three switches and nothing else: the token, the watermark,
-- the consent timestamp and the suppression flag are server-owned.
revoke all on public.email_preferences from anon, authenticated;
grant select on public.email_preferences to authenticated;
grant update (account_emails, activity_emails, newsletter) on public.email_preferences to authenticated;

create or replace function public.touch_email_preferences()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  -- The consent record is stamped here, not by the client: when the
  -- newsletter switch turns on, and cleared when it turns off.
  if new.newsletter and not old.newsletter then
    new.newsletter_consented_at := now();
  elsif not new.newsletter and old.newsletter then
    new.newsletter_consented_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.touch_email_preferences() from public, anon, authenticated;

drop trigger if exists email_preferences_touch on public.email_preferences;
create trigger email_preferences_touch
  before update on public.email_preferences
  for each row execute function public.touch_email_preferences();

-- One row per profile, created with it (same hook point as the signup credit
-- ledger row, 0027) — handle_new_user() itself stays untouched.
create or replace function public.create_email_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.email_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_email_preferences() from public, anon, authenticated;

drop trigger if exists profiles_create_email_preferences on public.profiles;
create trigger profiles_create_email_preferences
  after insert on public.profiles
  for each row execute function public.create_email_preferences();

-- Existing accounts: service emails on (they are the in-app notifications,
-- by mail, with one-click unsubscribe), newsletter OFF — nobody has
-- consented to marketing yet.
insert into public.email_preferences (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

-- 4. Newsletter bookkeeping --------------------------------------------------------
alter table public.site_updates
  add column if not exists emailed_at timestamptz,
  add column if not exists emailed_count integer not null default 0;

create table if not exists public.newsletter_deliveries (
  update_id uuid not null references public.site_updates (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (update_id, user_id)
);

-- Service role only (admin send action); no policies on purpose.
alter table public.newsletter_deliveries enable row level security;
revoke all on public.newsletter_deliveries from anon, authenticated;

-- 5. Bounce / complaint suppression ---------------------------------------------------
-- Called by /api/webhooks/resend with the address the provider reports. A
-- complaint also withdraws newsletter consent.
create or replace function public.suppress_email(p_email text, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.email_preferences ep
    set suppressed_at = now(),
        suppressed_reason = left(coalesce(p_reason, 'unknown'), 64),
        newsletter = case when p_reason = 'complained' then false else ep.newsletter end
  from auth.users u
  where u.id = ep.user_id
    and lower(u.email) = lower(btrim(p_email));
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.suppress_email(text, text) from public, anon, authenticated;
grant execute on function public.suppress_email(text, text) to service_role;

-- Recipient lists for the digest + newsletter need the auth email next to the
-- preference row; auth.users is not exposed through PostgREST.
create or replace function public.email_recipients(p_list text, p_user_ids uuid[] default null)
returns table (user_id uuid, email text, unsubscribe_token uuid, last_digest_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select ep.user_id, u.email::text, ep.unsubscribe_token, ep.last_digest_at
  from public.email_preferences ep
  join auth.users u on u.id = ep.user_id
  where ep.suppressed_at is null
    and u.email is not null
    and u.email_confirmed_at is not null
    and (p_user_ids is null or ep.user_id = any (p_user_ids))
    and case p_list
      when 'account' then ep.account_emails
      when 'activity' then ep.activity_emails
      when 'newsletter' then ep.newsletter
      else false
    end;
$$;

revoke all on function public.email_recipients(text, uuid[]) from public, anon, authenticated;
grant execute on function public.email_recipients(text, uuid[]) to service_role;

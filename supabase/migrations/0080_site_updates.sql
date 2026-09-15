-- ---------------------------------------------------------------------------
-- Site updates & upcoming features (2026-09-15)
--
-- Admin-authored announcements: shipped updates and teased upcoming features.
-- They power the /news page, the homepage banner, and an acknowledgement
-- splash that signed-in users must dismiss (site_update_acks records who has).
--
--   kind            'update' (shipped) | 'upcoming' (coming soon)
--   publish_at      release time — scheduled when in the future; a row is
--                   public only when is_published AND publish_at <= now()
--   show_in_banner  surface on the homepage banner
--   require_ack     show the blocking splash to signed-in users who have
--                   not acknowledged it (until ack_until, if set)
--
-- Reads: everyone sees released rows; admins see everything. Writes are
-- admin-only.
--
-- NOTE on the admin check: since 0074 the `authenticated` role has no
-- SELECT grant on profiles.is_admin, so the older policy shape
-- `exists (select 1 from profiles where … is_admin)` fails with
-- "permission denied for table profiles" when evaluated for a signed-in
-- user (those tables' admin writes go through the service role, which is
-- why nothing broke). These policies therefore call viewer_is_admin(), a
-- SECURITY DEFINER helper that reads the flag for auth.uid() only.
-- ---------------------------------------------------------------------------

create or replace function public.viewer_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;
-- anon must be able to CALL it too: the admin SELECT policy below is
-- evaluated for every role (policies are OR'd), and a function anon cannot
-- execute makes the whole select fail with "permission denied". For anon
-- auth.uid() is null, so it simply returns false.
revoke all on function public.viewer_is_admin() from public;
grant execute on function public.viewer_is_admin() to anon, authenticated;

create table if not exists public.site_updates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('update', 'upcoming')),
  title text not null check (char_length(title) between 3 and 120),
  summary text not null check (char_length(summary) between 3 and 280),
  body text check (char_length(body) <= 4000),
  link_href text check (char_length(link_href) <= 512),
  publish_at timestamptz not null default now(),
  is_published boolean not null default true,
  show_in_banner boolean not null default false,
  require_ack boolean not null default false,
  ack_until timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_updates_release_idx
  on public.site_updates (is_published, publish_at desc);

create table if not exists public.site_update_acks (
  update_id uuid not null references public.site_updates (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  acked_at timestamptz not null default now(),
  primary key (update_id, user_id)
);

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.site_updates enable row level security;
alter table public.site_update_acks enable row level security;

drop policy if exists "Released site updates are readable by everyone" on public.site_updates;
drop policy if exists "Admins can read every site update" on public.site_updates;
drop policy if exists "Admins can insert site updates" on public.site_updates;
drop policy if exists "Admins can update site updates" on public.site_updates;
drop policy if exists "Admins can delete site updates" on public.site_updates;

create policy "Released site updates are readable by everyone"
  on public.site_updates
  for select
  using (is_published and publish_at <= now());

create policy "Admins can read every site update"
  on public.site_updates
  for select
  using (public.viewer_is_admin());

create policy "Admins can insert site updates"
  on public.site_updates
  for insert
  with check (public.viewer_is_admin());

create policy "Admins can update site updates"
  on public.site_updates
  for update
  using (public.viewer_is_admin())
  with check (public.viewer_is_admin());

create policy "Admins can delete site updates"
  on public.site_updates
  for delete
  using (public.viewer_is_admin());

drop policy if exists "Users can read their own acknowledgements" on public.site_update_acks;
drop policy if exists "Users can acknowledge site updates" on public.site_update_acks;

create policy "Users can read their own acknowledgements"
  on public.site_update_acks
  for select
  using (user_id = auth.uid());

create policy "Users can acknowledge site updates"
  on public.site_update_acks
  for insert
  with check (user_id = auth.uid());

grant select on public.site_updates to anon, authenticated;
grant insert, update, delete on public.site_updates to authenticated;
grant select, insert on public.site_update_acks to authenticated;

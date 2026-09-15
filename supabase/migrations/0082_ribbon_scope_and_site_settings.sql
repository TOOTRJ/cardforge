-- 0082 — where the what's-new ribbon shows, and a global switch for it.
--
--   site_updates.banner_scope  'home' (homepage only, the default) or 'site'
--                              (every page, under the header) — per update.
--   site_settings              tiny key → jsonb table for site-wide admin
--                              switches. First key: 'updates_banner'
--                              { "enabled": true } — false hides the ribbon
--                              everywhere without touching the updates.
--
-- Reads are public (the ribbon renders on static pages); writes are admin
-- via viewer_is_admin() (0080).

alter table public.site_updates
  add column if not exists banner_scope text not null default 'home'
    check (banner_scope in ('home', 'site'));

create table if not exists public.site_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.site_settings enable row level security;

drop policy if exists "Site settings are readable by everyone" on public.site_settings;
drop policy if exists "Admins can insert site settings" on public.site_settings;
drop policy if exists "Admins can update site settings" on public.site_settings;

create policy "Site settings are readable by everyone"
  on public.site_settings for select using (true);
create policy "Admins can insert site settings"
  on public.site_settings for insert with check (public.viewer_is_admin());
create policy "Admins can update site settings"
  on public.site_settings for update
  using (public.viewer_is_admin()) with check (public.viewer_is_admin());

grant select on public.site_settings to anon, authenticated;
grant insert, update on public.site_settings to authenticated;

insert into public.site_settings (key, value)
  values ('updates_banner', '{"enabled": true}'::jsonb)
  on conflict (key) do nothing;

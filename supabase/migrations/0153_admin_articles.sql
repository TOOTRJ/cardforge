-- ---------------------------------------------------------------------------
-- 0153_admin_articles.sql — articles admins compose and schedule (the
-- orchestrator renumbers this placeholder at merge).
--
-- The guides in content/articles/*.mdx stay as they are (every URL, its
-- frontmatter, its tests). This table ADDS the composer's articles: the same
-- /articles/<slug> URL space, the same shelves, tags, sitemap, llms.txt and
-- RSS, merged by lib/content/article-catalog.ts (a file wins a slug clash —
-- the composer refuses one). docs/research/article-seo-2026-10.md has why.
--
--   is_published + publish_at   the release, site_updates' shape (0080): a row
--                               is public only when is_published AND
--                               publish_at <= now(). A future publish_at is
--                               "scheduled" — the backlog that publishes over
--                               time. A draft has is_published false.
--   content_updated_at          the honest "Updated" date (schema.org
--                               dateModified, sitemap lastmod): set only when
--                               an admin marks an edit of a live article as a
--                               real revision — a typo fix never moves it.
--   announced_at                when the publish was announced (revalidation
--                               + IndexNow). /api/cron/publish-articles
--                               announces every released row with none; an
--                               unpublish or a reschedule clears it.
--   cover_url / cover_alt       the cover (Article.image, the article's OG
--                               image source); alt text is REQUIRED with a
--                               cover — a CHECK, not only the composer.
--
-- Reads: everyone sees released rows; admins (viewer_is_admin(), 0080) see
-- every row. Writes: admins only, through the same helper. The cover is a
-- picture column under 0127's rules: articles_guard_media_columns lets an
-- API role keep, clear or set a value media_url_allowed('article-image', …)
-- accepts — an object in the writer's own `set-covers` folder (the composer
-- uploads through lib/media/user-storage.ts) or one of PipGlyph's own
-- diagrams under /article-media/ (public/article-media, shipped in git).
-- media_url_allowed is 0150's, plus the 'article-image' kind and that ONE
-- site-relative branch (lib/media/media-urls.ts mirrors both).
--
-- Grants (every migration states them; never a blanket grant):
--   * articles: SELECT for anon + authenticated (RLS decides which rows);
--     INSERT, UPDATE, DELETE for authenticated (RLS: admins only); all for
--     service_role (the publish cron).
--   * media_url_allowed: EXECUTE for anon, authenticated, service_role, as
--     0127 / 0150.
--   * guard_article_media_columns: EXECUTE revoked from public, anon,
--     authenticated (a trigger fires regardless; no API role may call it).
--   * admin_list_article_authors: EXECUTE for authenticated + service_role
--     (it answers an admin caller only); revoked from public and anon.
--
-- Ships through a PR; never applied ad-hoc.
-- ---------------------------------------------------------------------------

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (char_length(slug) between 3 and 90 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 3 and 120),
  seo_title text check (char_length(seo_title) between 3 and 70),
  description text not null check (char_length(description) between 3 and 300),
  excerpt text check (char_length(excerpt) <= 400),
  body text not null default '' check (char_length(body) <= 100000),
  tags text[] not null default '{}'
    check (cardinality(tags) <= 8),
  category text check (category in ('design', 'reference', 'comparisons', 'lore')),
  faq jsonb not null default '[]'::jsonb
    check (jsonb_typeof(faq) = 'array' and jsonb_array_length(faq) <= 12),
  cover_url text check (char_length(cover_url) <= 1024),
  cover_alt text check (char_length(cover_alt) <= 250),
  cover_width integer check (cover_width between 1 and 10000),
  cover_height integer check (cover_height between 1 and 10000),
  author_id uuid references public.profiles (id) on delete set null,
  is_published boolean not null default false,
  publish_at timestamptz,
  content_updated_at timestamptz,
  announced_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint articles_published_has_time check (not is_published or publish_at is not null),
  constraint articles_cover_has_alt check (
    cover_url is null or (cover_alt is not null and char_length(btrim(cover_alt)) > 0)
  )
);

create index if not exists articles_release_idx
  on public.articles (is_published, publish_at desc);

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.articles enable row level security;

drop policy if exists "Released articles are readable by everyone" on public.articles;
drop policy if exists "Admins can read every article" on public.articles;
drop policy if exists "Admins can insert articles" on public.articles;
drop policy if exists "Admins can update articles" on public.articles;
drop policy if exists "Admins can delete articles" on public.articles;

create policy "Released articles are readable by everyone"
  on public.articles
  for select
  using (is_published and publish_at <= now());

create policy "Admins can read every article"
  on public.articles
  for select
  using (public.viewer_is_admin());

create policy "Admins can insert articles"
  on public.articles
  for insert
  with check (public.viewer_is_admin());

create policy "Admins can update articles"
  on public.articles
  for update
  using (public.viewer_is_admin())
  with check (public.viewer_is_admin());

create policy "Admins can delete articles"
  on public.articles
  for delete
  using (public.viewer_is_admin());

revoke all on table public.articles from public, anon, authenticated;
grant select on table public.articles to anon, authenticated;
grant insert, update, delete on table public.articles to authenticated;
grant select, insert, update, delete on table public.articles to service_role;

-- ===========================================================================
-- The cover is a picture column (0127's rules)
-- ===========================================================================

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
  -- The sixteen built-in deck backgrounds (0150, public/defaults/deck-covers):
  -- a default the owner shuffled to or picked.
  if p_kind = 'deck-cover'
     and p_url ~ '^/defaults/deck-covers/(white|blue|black|red|green|multicolor|colorless|neutral)-[12]\.webp$' then
    return true;
  end if;
  -- PipGlyph's own built-in images (public/defaults) as card art — what the
  -- dev / preview seed cards use (supabase/seeds/10_dev_data.sql), so a
  -- remix of one saves.
  if p_kind = 'card-art'
     and p_url ~ '^(https://(www\.)?pipglyph\.com)?/defaults/(avatars/avatar|banners/banner)-(0[1-9]|1[0-9]|2[0-5])\.webp$' then
    return true;
  end if;
  -- PipGlyph's own article diagrams (0153, public/article-media): a
  -- site-relative file the repo ships, never a host.
  if p_kind = 'article-image'
     and p_url ~ '^/article-media/[a-z0-9]+(-[a-z0-9]+)*/[a-z0-9]+(-[a-z0-9]+)*\.(svg|png|webp)$' then
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
    when 'article-image' then array['set-covers']
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

revoke all on function public.media_url_allowed(text, text, uuid) from public;
grant execute on function public.media_url_allowed(text, text, uuid)
  to anon, authenticated, service_role;

create or replace function public.guard_article_media_columns()
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
  if not public.media_url_change_allowed('article-image', v_old_cover, new.cover_url) then
    raise exception 'media_url_not_allowed: articles.cover_url must be one of your own uploads or a PipGlyph diagram'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_article_media_columns() from public, anon, authenticated;

drop trigger if exists articles_guard_media_columns on public.articles;
create trigger articles_guard_media_columns
  before insert or update of cover_url
  on public.articles
  for each row execute function public.guard_article_media_columns();

-- ===========================================================================
-- The byline picker: the admins an article may be credited to
-- ===========================================================================
-- profiles.is_admin is not readable by the API roles (0074), so the composer
-- asks this SECURITY DEFINER helper, which answers an admin caller only (an
-- empty list for anyone else). The byline itself is public profile data.

create or replace function public.admin_list_article_authors()
returns table (id uuid, username text, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.display_name
  from public.profiles p
  where p.is_admin
    and public.viewer_is_admin()
  order by p.username;
$$;

revoke all on function public.admin_list_article_authors() from public, anon;
grant execute on function public.admin_list_article_authors() to authenticated, service_role;

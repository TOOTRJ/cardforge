-- 0134 — a double-faced card's BACK bake: two render pointers (TODO 5.0a,
-- the first PR of Phase 5; design 2026-10-02, design-next/5/final.md §3.2).
-- Ships through a PR; never applied ad-hoc.
--
-- MERGE ORDER: after 0133 (#452). Nothing here depends on 0133's contents —
-- the numbers are what order them.
--
-- ONE card holds both faces of a transform / modal double-faced card (owner
-- decision Q1, 2026-10-02): `cards.back_face` (the 0015 jsonb) keeps the
-- back's CONTENT and gains, in the app, the back's own body
-- (`frame_style.template`) and colour (`color_identity`) — no CHECK on the
-- jsonb, as 0015 / 0041 decided; lib/validation/card.ts backFaceSchema is
-- the gate. The 8 imported double-faced cards (a `back_face` with no body)
-- keep today's look: their back is drawn on the front's frame and colour,
-- and nothing here touches a row.
--
-- Two columns on public.cards, the back face's stored bake — written by
-- TODO 5.3, read by nothing yet:
--
--   rendered_back_image_url   `{owner}/{id}.back.png` in card-renders
--   rendered_back_thumb_url   `{owner}/{id}.back.thumb.webp` beside it
--
-- beside 0021 / 0079's `rendered_image_url` / `rendered_thumb_url` (the
-- front). ONE `rendered_at` and ONE `layout_version` per card: a bake
-- writes both faces in one run and one update. A card with no back body
-- keeps both columns null.
--
-- 1. The 0126 guard, re-created with both columns. cards_guard_render_columns
--    is declared on a column LIST (`update of …`): an update of a column not
--    listed never fires it, so until this migration an API role could have
--    pointed its card's back at any picture. The function body names the two
--    columns too: anon / authenticated may only keep or CLEAR them; a new
--    non-null value, or an insert carrying one, is insufficient_privilege.
--    The save bake persists with the service role (lib/cards/bake-render.ts).
--    SECURITY INVOKER on purpose, as 0126: current_user is the caller's role.
--
-- 2. The 0108 updated_at guard, re-created subtracting both columns. A back
--    bake is not an edit: without this every back bake would bump
--    updated_at, the sitemap's lastmod and the OG cache-buster (the
--    2026-09-22 lesson; 0108 fixed it for the front's columns).
--
-- The app's side (the same PR): lib/cards/bake-core.ts renderObjectNames
-- returns the four names, and every reader of a render name — the display
-- check isStoredRenderUrl, the /render-cdn proxy, removeRenderObjects, the
-- moderation hide, the go-private and delete paths, the orphan sweep — reads
-- that one list, so a `.back.png` is never served untagged nor swept as an
-- orphan. tests/unit/db/card-back-face-renders-migration.test.ts holds the
-- trigger's column list and the subtraction to those names.
--
-- Grants: none new. The columns are covered by 0097's table-level grants on
-- public.cards (anon / authenticated select; owner writes through RLS;
-- public.cards has no column-level grants), as 0133's were. The two trigger
-- functions keep 0126's / 0108's ACLs: the revoke below restates 0126's for
-- the guard (no API role may call it directly; it fires for every role's
-- writes regardless of EXECUTE), and set_cards_updated_at keeps 0097's
-- grant.
--
-- Idempotent: `add column if not exists`, `create or replace function`,
-- `drop trigger if exists` + `create trigger`. No data migration: nothing
-- has a back body yet, and adding a nullable column fires no trigger and
-- bumps no updated_at.

-- 1. The columns ------------------------------------------------------------

alter table public.cards
  add column if not exists rendered_back_image_url text,
  add column if not exists rendered_back_thumb_url text;

comment on column public.cards.rendered_back_image_url is
  'The back face''s stored bake ({owner}/{id}.back.png in card-renders, written by TODO 5.3). Null = none / no back body. Service-role only (cards_guard_render_columns, 0126 + 0134) and not an edit (set_cards_updated_at ignores it). TODO 5.0a.';
comment on column public.cards.rendered_back_thumb_url is
  'The back face''s 600 px WebP thumbnail ({owner}/{id}.back.thumb.webp in card-renders, beside the back bake). Null = none. Service-role only and not an edit. TODO 5.0a.';

-- 2. The 0126 render guard, with the back's two columns ----------------------

create or replace function public.guard_card_render_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.rendered_image_url is not null
       or new.rendered_thumb_url is not null
       or new.rendered_back_image_url is not null
       or new.rendered_back_thumb_url is not null
       or new.rendered_at is not null
       or new.layout_version is not null then
      raise exception 'render_columns_server_only: a card''s render is set by the server'
        using errcode = 'insufficient_privilege';
    end if;
  elsif (new.rendered_image_url is not null and new.rendered_image_url is distinct from old.rendered_image_url)
     or (new.rendered_thumb_url is not null and new.rendered_thumb_url is distinct from old.rendered_thumb_url)
     or (new.rendered_back_image_url is not null and new.rendered_back_image_url is distinct from old.rendered_back_image_url)
     or (new.rendered_back_thumb_url is not null and new.rendered_back_thumb_url is distinct from old.rendered_back_thumb_url)
     or (new.rendered_at is not null and new.rendered_at is distinct from old.rendered_at)
     or (new.layout_version is not null and new.layout_version is distinct from old.layout_version) then
    raise exception 'render_columns_server_only: a card''s render is set by the server (it may only be cleared)'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists cards_guard_render_columns on public.cards;
create trigger cards_guard_render_columns
  before insert or update of rendered_image_url, rendered_thumb_url, rendered_back_image_url, rendered_back_thumb_url, rendered_at, layout_version
  on public.cards
  for each row execute function public.guard_card_render_columns();

revoke all on function public.guard_card_render_columns() from public, anon, authenticated;

-- 3. The 0108 updated_at guard, ignoring the back's two columns ---------------

create or replace function public.set_cards_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new)
        - 'view_count' - 'likes_count' - 'share_count' - 'updated_at' - 'color_count'
        - 'rendered_image_url' - 'rendered_thumb_url' - 'rendered_back_image_url' - 'rendered_back_thumb_url' - 'rendered_at' - 'layout_version')
     is distinct from
     (to_jsonb(old)
        - 'view_count' - 'likes_count' - 'share_count' - 'updated_at' - 'color_count'
        - 'rendered_image_url' - 'rendered_thumb_url' - 'rendered_back_image_url' - 'rendered_back_thumb_url' - 'rendered_at' - 'layout_version') then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end;
$$;

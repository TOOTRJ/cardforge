-- 0126 — user pictures reach storage, and a card's render pointer, only
-- through the server (TODO 3.14a follow-up, owner decision 2026-09-29).
--
-- 1. No storage write policies.
--    Until now each user bucket carried owner-folder INSERT / UPDATE / DELETE
--    policies on storage.objects (0004 card-art, 0007 card-exports, 0010
--    set-covers, 0021 card-renders, 0022 profile-media, 0039 custom-pips — all
--    `auth.uid()::text = (storage.foldername(name))[1]`). So a signed-in user
--    could write `{their id}/anything` straight from the Supabase client and
--    skip the upload actions: the Sharp byte sniff, the camera-metadata strip
--    (lib/media/upload-bytes.ts, TODO 3.14a) and the NSFW scan. In
--    card-renders that meant replacing the watermarked bake OBJECT of their
--    own card with any picture.
--
--    After this migration the API roles hold NO insert, update or delete
--    policy on storage.objects for any bucket. Every write is a server action
--    or route that authenticates the caller, forces the `{userId}/` folder
--    and writes with the service role, which bypasses RLS
--    (lib/media/user-storage.ts; card renders through lib/cards/bake-core.ts,
--    which opens the owner's folder the same way). Deletes moved server-side
--    too: through a user's JWT a storage `remove` needs SELECT as well as
--    DELETE, and card-art / profile-media / set-covers have no SELECT policy
--    (listing stays closed, advisor 0025), so those removes were silent
--    no-ops: a flagged upload and a replaced avatar or banner were never
--    actually deleted.
--
--    The DO block is the drift guard for production, whose early storage
--    setup was applied by hand (see 0005). It drops EVERY remaining insert /
--    update / delete / all policy on storage.objects, whatever it is called
--    and whatever bucket it names (or doesn't: `true`, `bucket_id <> 'x'`,
--    a subquery on storage.buckets…), and raises a WARNING per drop. A
--    branch built from this repo has none left by then. An ALL policy's read
--    half goes with it; every bucket is public-read by URL, and the app
--    never lists or downloads through a user's JWT.
--
--    Unchanged: the buckets themselves (public read by URL, size and MIME
--    limits), the two owner SELECT policies (0038 card-renders, 0039
--    custom-pips; they only ever existed so the owner's upserts could
--    resolve, and back no write now) and `frames` (0116: no policies,
--    service role only). card-exports has no writer in the app; it just
--    loses its policies.
--
-- 2. A card's render pointer is the server's.
--    Dropping the card-renders write policies protects the bake object, but
--    the ROW still named it: `rendered_image_url`, `rendered_thumb_url`,
--    `rendered_at` and `layout_version` were writable by the owner like any
--    other column (0003's owner UPDATE policy, 0097's table-level UPDATE). An
--    owner could PATCH their card through PostgREST at any picture: an
--    outside host (a viewer-IP tracking pixel in every public listing), their
--    own raw card-art upload (no watermark), someone else's bake. The gallery
--    tile, the deck proxy, the free download and the share image showed it.
--
--    cards_guard_render_columns: an API role (anon / authenticated) may only
--    leave those four columns as they are or CLEAR them (NULL: the card falls
--    back to the live preview, and the auto-rebake cron re-bakes a published
--    one). Inserting a card with any of them set, or setting one to a new
--    non-null value, is refused with insufficient_privilege. The save bake
--    persists a new render with the service role (lib/cards/bake-render.ts);
--    the admin sweep and the layout tools already did. SECURITY INVOKER on
--    purpose, like 0121's frame-preview guard: current_user is the caller's
--    role (anon / authenticated for PostgREST, service_role for the admin
--    client, the owner for migrations and SECURITY DEFINER functions).
--
--    The app checks the same thing when it DRAWS a render
--    (lib/cards/render-cdn.ts isStoredRenderUrl: our host, card-renders, and
--    for the download / share image the card's own `{owner}/{id}.png`),
--    because the database can't know its own public storage host. Rows
--    written before this migration are cleaned below: a pointer that isn't
--    the card's own `card-renders/{owner_id}/{id}` object is cleared.
--    (Production, public + unlisted cards, 2026-09-29: none point outside
--    our card-renders bucket.) Nulled stamps need no sweep bump: the only
--    deployment that re-bakes them, old or new, bakes with the service role
--    at the right path.
--
-- Grants: none new. storage.objects privileges are Supabase-managed and
-- untouched: which rows the API roles may write is decided by policies, and
-- there are now none. public.cards privileges are unchanged (0097); the
-- trigger is the gate for the four render columns. The trigger function
-- fires for every role's writes regardless of EXECUTE; no API role may call
-- it directly (revoked below). Never add an owner-folder storage write policy
-- back: a new upload path goes through lib/media/user-storage.ts.
--
-- Ships through a PR; never applied ad-hoc.

-- 1. Storage write policies ------------------------------------------------

drop policy if exists "Owners can upload card art to their own folder" on storage.objects;
drop policy if exists "Owners can update their own card art" on storage.objects;
drop policy if exists "Owners can delete their own card art" on storage.objects;

drop policy if exists "Owners can upload card exports to their own folder" on storage.objects;
drop policy if exists "Owners can update their own card exports" on storage.objects;
drop policy if exists "Owners can delete their own card exports" on storage.objects;

drop policy if exists "Owners can upload set covers to their own folder" on storage.objects;
drop policy if exists "Owners can update their own set covers" on storage.objects;
drop policy if exists "Owners can delete their own set covers" on storage.objects;

drop policy if exists "Owners can upload card renders to their own folder" on storage.objects;
drop policy if exists "Owners can update their own card renders" on storage.objects;
drop policy if exists "Owners can delete their own card renders" on storage.objects;

drop policy if exists "Owners can upload their own profile media" on storage.objects;
drop policy if exists "Owners can update their own profile media" on storage.objects;
drop policy if exists "Owners can delete their own profile media" on storage.objects;

drop policy if exists "Owners can upload custom pips to their own folder" on storage.objects;
drop policy if exists "Owners can update their own custom pips" on storage.objects;
drop policy if exists "Owners can delete their own custom pips" on storage.objects;

do $$
declare
  p record;
begin
  for p in
    select policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
    raise warning '0126: dropped storage.objects % policy % (roles %, using %, with check %)',
      p.cmd, p.policyname, p.roles, coalesce(p.qual, '-'), coalesce(p.with_check, '-');
  end loop;
end
$$;

-- 2. A card's render pointer -----------------------------------------------

-- Rows written before this migration: a pointer that is not the card's own
-- bake object is cleared (the host can't be checked here; the app does).
update public.cards as c
set rendered_image_url = null,
    rendered_thumb_url = null,
    rendered_at = null,
    layout_version = null
where c.rendered_image_url is not null
  and split_part(c.rendered_image_url, '?', 1) not like
    '%/storage/v1/object/public/card-renders/' || c.owner_id::text || '/' || c.id::text || '.png';

update public.cards as c
set rendered_thumb_url = null
where c.rendered_thumb_url is not null
  and split_part(c.rendered_thumb_url, '?', 1) not like
    '%/storage/v1/object/public/card-renders/' || c.owner_id::text || '/' || c.id::text || '.thumb.webp';

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
       or new.rendered_at is not null
       or new.layout_version is not null then
      raise exception 'render_columns_server_only: a card''s render is set by the server'
        using errcode = 'insufficient_privilege';
    end if;
  elsif (new.rendered_image_url is not null and new.rendered_image_url is distinct from old.rendered_image_url)
     or (new.rendered_thumb_url is not null and new.rendered_thumb_url is distinct from old.rendered_thumb_url)
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
  before insert or update of rendered_image_url, rendered_thumb_url, rendered_at, layout_version
  on public.cards
  for each row execute function public.guard_card_render_columns();

revoke all on function public.guard_card_render_columns() from public, anon, authenticated;

-- 0169_featured_pool.sql — the home page's hero cards rotate daily from an
-- admin-picked POOL (TODO HM4, owner 2026-11-04: "Go: pool only"; and "I
-- want the original card checks to work for suggestions but the admin should
-- be able to add any public card they want to the list by pasting in the
-- public URL").
--
-- Why: the hero read 0053's two fixed featured_cards slots, which went
-- unchanged on production from 16 and 22 September — and one held another
-- company's character. A likes-ranked top-up was considered and dropped: on
-- production the most-liked public cards that are neither imported nor
-- remixed are mostly fan cards of other companies' characters, and likes
-- run 1–4, so "most-liked" is mostly ties. Nothing reaches the hero without
-- an admin's click; the admin page OFFERS suggestions instead.
--
-- 1. featured_pool — (card, added_at, added_by). Admin-only state: RLS on,
--    NO policy, nothing granted to anon or authenticated; the admin page
--    writes and reads it through the service role behind its is_admin
--    check. Deleting a card (or the admin's profile) cascades / clears.
--
-- 2. TWO CHECKS, read only from columns — never a title, printed_types or
--    any other text (no automatic rule can tell a fan card from an
--    original, so that judgment is the admin's):
--    home_hero_shown_refusal(card) — may the hero DRAW it? NULL = yes, else:
--      not_public — visibility is not 'public' (unlisted, private, and a
--                   moderation hide, which sets it private);
--      no_render  — no stored bake (the hero draws the stored image; an
--                   edit clears it until the re-bake).
--    home_hero_refusal(card) — the ORIGINAL-CARD guard: the first of
--      from_real_card — source_scryfall_id (imports and remixes of a
--                       printing, since 0016) or import_scryfall_id (0144);
--      remix          — parent_card_id is set;
--      not_creator    — the owner is no real creator (0149's
--                       owner_is_creator: an admin, or no public card);
--    then the shown check. It narrows what is OFFERED, not what a card is:
--    each reason can be undone (parent_card_id is cleared when the parent
--    is deleted — 0003's on delete set null; an owner can clear
--    source_scryfall_id on an edit, and a card imported before 0144 has no
--    import_scryfall_id), so the admin's click is the real gate.
--    Where each applies:
--      the POOL          — the shown check alone, at the add (by the card
--                          page's URL, resolved on the server) and at every
--                          read: an admin may put ANY public card on the
--                          hero, and it leaves by itself once it isn't
--                          public or loses its bake;
--      SUGGESTIONS       — the full guard (and their "Add" button: an add by
--                          id passes the full guard, never the shown check);
--      the FALLBACK pair — the full guard at every read (it took a fan card
--                          of another company's character off the hero with
--                          no one acting; never relax it).
--
-- 3. home_hero_pool() — the visitor's ONE read (the home page, ISR, public
--    client): the pool's cards that pass the shown check, oldest-added first
--    (source 'pool', ord 1…, by added_at then card_id), then 0053's two
--    slots' cards that pass the full guard (source 'fallback', ord = slot),
--    each with the fields the hero draws and its owner's handle. The app
--    sorts them again by (source, ord) and picks the day's pair
--    (lib/featured/hero-rotation.ts): with two or more pool cards, positions
--    (2d, 2d+1) mod N for the UTC day number d — every pool card on equal
--    days, and the same pair all day while N is stable (a card added,
--    removed or leaving this read reshuffles it at the next regeneration);
--    with fewer, the pool's card(s) then the fallback slots. SECURITY DEFINER (the pool
--    grants the API roles nothing), empty search_path; it hands out only
--    public cards' public fields.
--
-- 4. Admin reads and the write — service role only:
--    featured_pool_admin_list() (every pool row with its shown check and,
--    for information only, the original guard's first reason; then the two
--    fallback slots with the full guard — the page says why a card isn't
--    shown), featured_pool_suggestions(limit) (recent most-liked cards that
--    pass the full guard and aren't in the pool — the last 120 days, likes
--    then newest, at most 24) and featured_pool_add(card, admin,
--    original_only) ('added' / 'already' / 'missing' / a refusal — the
--    check decides, never the app: original_only = the full guard, for a
--    suggestion's button; false = the shown check, for a pasted URL).
--
-- Grants: featured_pool — revoked from public, anon and authenticated
-- (production auto-grants new public objects to the API roles; this takes
-- that back), everything to service_role. home_hero_pool — PUBLIC revoked,
-- EXECUTE to anon, authenticated and service_role. home_hero_refusal,
-- home_hero_shown_refusal, home_hero_original_refusal,
-- featured_pool_admin_list, featured_pool_suggestions and featured_pool_add
-- — revoked from PUBLIC, anon and authenticated (a new database grants the
-- API roles EXECUTE by default), EXECUTE to service_role alone.
--
-- Backward compatible: featured_cards keeps its shape and its public read
-- (the deployment live while this lands still reads it); it is the fallback
-- pair now, and dropping it is a later PR. Ships through a PR; never applied
-- ad-hoc. Idempotent.

-- ===========================================================================
-- 1. The pool
-- ===========================================================================

create table if not exists public.featured_pool (
  card_id uuid primary key references public.cards (id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references public.profiles (id) on delete set null
);

create index if not exists featured_pool_added_at_idx
  on public.featured_pool (added_at, card_id);

alter table public.featured_pool enable row level security;
-- No policy: service-role reads and writes only.

revoke all on table public.featured_pool from public, anon, authenticated;
grant select, insert, update, delete on table public.featured_pool to service_role;

-- ===========================================================================
-- 2. The checks
-- ===========================================================================

-- Can the hero draw it? The pool's check.
create or replace function public.home_hero_shown_refusal(c public.cards)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when c.visibility is distinct from 'public' then 'not_public'
    when c.rendered_image_url is null then 'no_render'
    else null
  end;
$$;

revoke all on function public.home_hero_shown_refusal(public.cards) from public, anon, authenticated;
grant execute on function public.home_hero_shown_refusal(public.cards) to service_role;

-- Is it an original? The first reason it isn't; NULL = none of the three.
create or replace function public.home_hero_original_refusal(c public.cards)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when c.source_scryfall_id is not null or c.import_scryfall_id is not null then 'from_real_card'
    when c.parent_card_id is not null then 'remix'
    when not public.owner_is_creator(c.owner_id) then 'not_creator'
    else null
  end;
$$;

revoke all on function public.home_hero_original_refusal(public.cards) from public, anon, authenticated;
grant execute on function public.home_hero_original_refusal(public.cards) to service_role;

-- The full guard: suggestions, their add, and the fallback pair.
create or replace function public.home_hero_refusal(c public.cards)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(public.home_hero_original_refusal(c), public.home_hero_shown_refusal(c));
$$;

revoke all on function public.home_hero_refusal(public.cards) from public, anon, authenticated;
grant execute on function public.home_hero_refusal(public.cards) to service_role;

-- ===========================================================================
-- 3. The visitor's read
-- ===========================================================================

create or replace function public.home_hero_pool()
returns table (
  card_id uuid,
  source text,
  ord integer,
  slug text,
  title text,
  frame_style jsonb,
  rendered_image_url text,
  rendered_thumb_url text,
  username text,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  with shown as (
    select c.*, 'pool'::text as src,
      (row_number() over (order by fp.added_at, fp.card_id))::integer as rn
    from public.featured_pool fp
    join public.cards c on c.id = fp.card_id
    where public.home_hero_shown_refusal(c) is null
    union all
    select c.*, 'fallback'::text as src, fc.slot as rn
    from public.featured_cards fc
    join public.cards c on c.id = fc.card_id
    where public.home_hero_refusal(c) is null
  )
  select s.id, s.src, s.rn, s.slug, s.title, s.frame_style,
    s.rendered_image_url, s.rendered_thumb_url, p.username, p.display_name
  from shown s
  join public.profiles p on p.id = s.owner_id
  where p.username is not null
  order by case s.src when 'pool' then 0 else 1 end, s.rn;
$$;

revoke all on function public.home_hero_pool() from public;
grant execute on function public.home_hero_pool() to anon, authenticated, service_role;

-- ===========================================================================
-- 4. The admin page's reads and its write
-- ===========================================================================

create or replace function public.featured_pool_admin_list()
returns table (
  card_id uuid,
  source text,
  slot integer,
  added_at timestamptz,
  slug text,
  title text,
  username text,
  refusal text,
  not_original text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select fp.card_id, 'pool'::text, null::integer, fp.added_at, c.slug, c.title,
    p.username, public.home_hero_shown_refusal(c), public.home_hero_original_refusal(c)
  from public.featured_pool fp
  join public.cards c on c.id = fp.card_id
  left join public.profiles p on p.id = c.owner_id
  union all
  select fc.card_id, 'fallback'::text, fc.slot, fc.created_at, c.slug, c.title,
    p.username, public.home_hero_refusal(c), null::text
  from public.featured_cards fc
  join public.cards c on c.id = fc.card_id
  left join public.profiles p on p.id = c.owner_id
  order by 2 desc, 3, 4, 1;
$$;

revoke all on function public.featured_pool_admin_list() from public, anon, authenticated;
grant execute on function public.featured_pool_admin_list() to service_role;

create or replace function public.featured_pool_suggestions(p_limit integer default 12)
returns table (
  card_id uuid,
  slug text,
  title text,
  username text,
  likes_count integer,
  created_at timestamptz,
  rendered_thumb_url text,
  rendered_image_url text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.slug, c.title, p.username, c.likes_count, c.created_at,
    c.rendered_thumb_url, c.rendered_image_url
  from public.cards c
  join public.profiles p on p.id = c.owner_id
  where c.visibility = 'public'
    and c.created_at >= now() - interval '120 days'
    and p.username is not null
    and not exists (select 1 from public.featured_pool fp where fp.card_id = c.id)
    and public.home_hero_refusal(c) is null
  order by c.likes_count desc, c.created_at desc, c.id
  limit least(greatest(coalesce(p_limit, 12), 1), 24);
$$;

revoke all on function public.featured_pool_suggestions(integer) from public, anon, authenticated;
grant execute on function public.featured_pool_suggestions(integer) to service_role;

create or replace function public.featured_pool_add(
  p_card_id uuid,
  p_added_by uuid,
  p_original_only boolean
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_card public.cards;
  v_refusal text;
begin
  select * into v_card from public.cards where id = p_card_id;
  if not found then
    return 'missing';
  end if;
  v_refusal := case when p_original_only is false
    then public.home_hero_shown_refusal(v_card)
    else public.home_hero_refusal(v_card)
  end;
  if v_refusal is not null then
    return v_refusal;
  end if;
  insert into public.featured_pool (card_id, added_by)
  values (p_card_id, p_added_by)
  on conflict (card_id) do nothing;
  if not found then
    return 'already';
  end if;
  return 'added';
end;
$$;

revoke all on function public.featured_pool_add(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.featured_pool_add(uuid, uuid, boolean) to service_role;

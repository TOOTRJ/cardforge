-- 0169_featured_pool.sql — the home page's hero cards rotate daily from an
-- admin-picked POOL of original cards (TODO HM4, owner 2026-11-04: "Go:
-- pool only").
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
-- 2. THE ORIGINAL-CARD GUARD — home_hero_refusal(card): ONE rule, read when
--    a card is ADDED (featured_pool_add) and again whenever the page READS
--    the pool (home_hero_pool), so a card that later stops qualifying drops
--    out by itself. NULL = the card may be on the hero; else the FIRST reason, the
--    lasting ones before those its owner can change:
--      from_real_card — started from a real printing: source_scryfall_id
--                       (imports and remixes of a printing, since 0016) or
--                       import_scryfall_id (0144) is set;
--      remix          — parent_card_id is set (feature the parent instead);
--      not_creator    — the owner is no real creator (0149's
--                       owner_is_creator: never an admin's card);
--      not_public     — visibility is not 'public' (unlisted never shows);
--      no_render      — no stored bake (the hero draws the stored image).
--    It reads ONLY those columns — never a title, printed_types or any
--    other text: no automatic rule can tell a fan card from an original, so
--    that judgment is the admin's, and the guard only refuses what it can
--    know.
--
-- 3. home_hero_pool() — the visitor's ONE read (the home page, ISR, public
--    client): the pool's cards that pass the guard, oldest-added first
--    (source 'pool', ord 1…), then 0053's two slots' cards that pass it
--    (source 'fallback', ord = slot), each with the fields the hero draws
--    and its owner's handle. The app picks the day's pair (lib/featured/
--    hero-rotation.ts): with two or more pool cards, positions (2d, 2d+1)
--    mod N for the UTC day number d — the same pair all day, every pool card
--    on equal days; with fewer, the pool's card(s) then the fallback slots.
--    SECURITY DEFINER (the pool grants the API roles nothing), empty
--    search_path; it hands out only public cards' public fields.
--
-- 4. Admin reads and the write — service role only:
--    featured_pool_admin_list() (every pool row, then the two fallback
--    slots, each with its refusal — the page says why a card isn't shown), featured_pool_suggestions(limit)
--    (recent most-liked cards that pass the guard and aren't in the pool —
--    the last 120 days, likes then newest, at most 24) and
--    featured_pool_add(card, admin) ('added' / 'already' / 'missing' / a
--    refusal — the guard decides, never the app).
--
-- Grants: featured_pool — revoked from public, anon and authenticated
-- (production auto-grants new public objects to the API roles; this takes
-- that back), everything to service_role. home_hero_pool — PUBLIC revoked,
-- EXECUTE to anon, authenticated and service_role. home_hero_refusal,
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
-- 2. The guard
-- ===========================================================================

create or replace function public.home_hero_refusal(c public.cards)
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
    when c.visibility is distinct from 'public' then 'not_public'
    when c.rendered_image_url is null then 'no_render'
    else null
  end;
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
    where public.home_hero_refusal(c) is null
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
  refusal text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select fp.card_id, 'pool'::text, null::integer, fp.added_at, c.slug, c.title,
    p.username, public.home_hero_refusal(c)
  from public.featured_pool fp
  join public.cards c on c.id = fp.card_id
  left join public.profiles p on p.id = c.owner_id
  union all
  select fc.card_id, 'fallback'::text, fc.slot, fc.created_at, c.slug, c.title,
    p.username, public.home_hero_refusal(c)
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

create or replace function public.featured_pool_add(p_card_id uuid, p_added_by uuid)
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
  v_refusal := public.home_hero_refusal(v_card);
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

revoke all on function public.featured_pool_add(uuid, uuid) from public, anon, authenticated;
grant execute on function public.featured_pool_add(uuid, uuid) to service_role;

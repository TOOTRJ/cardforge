-- 0196_home_hero_pool_by_key.sql — the home page hero's read finds its
-- cards by key (it scanned every card).
--
-- home_hero_pool() (0169) is the visitor's ONE read of the hero's cards: the
-- pool's, then the two fallback slots' that pass the original-card guard.
-- Read from production on 2026-11-10 (pg_stat_statements, 3,777 calls): a
-- mean of 1.77 s, a maximum of 2.99 s — and 25 calls in 24 hours cancelled
-- at the anonymous role's 3 s statement timeout, each a home page built
-- with no featured cards. EXPLAIN showed why: for the FALLBACK half the
-- planner read all of `cards` (3,183 rows) and ran home_hero_refusal — whose
-- `owner_is_creator` looks the owner's public cards up — on every one of
-- them (468,800 buffers) before joining the two slots; it cost as much time
-- as every other gallery read of the day together.
--
-- Same answer, another shape: each half first FETCHES its cards by primary
-- key — a lateral subquery behind `offset 0`, which the planner cannot
-- flatten into a join it is free to re-order, inside a MATERIALIZED CTE,
-- which it cannot push the check into — and only then runs the check on
-- those rows: 48 pool cards and 2 slots, not the table. On production's
-- data: the same 50 rows in the same order as 0169's body (compared both
-- ways, position included), 407 buffers, 4 ms. The work now grows with the
-- pool, not with the number of cards on the site.
--
-- Nothing else changes: the signature and the returned columns, SECURITY
-- DEFINER with an empty search_path, the pool's check (shown) and the
-- fallback pair's (the full guard), the order (pool by added_at then id,
-- then the slots), the `username is not null` join. The three checks and
-- every admin function of 0169 are untouched. Grants restated (0097).
-- Idempotent. Ships through a PR; never applied ad-hoc.

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
  with pool_rows as materialized (
    select l.card, fp.added_at
    from public.featured_pool fp
    cross join lateral (
      select c as card from public.cards c where c.id = fp.card_id offset 0
    ) l
  ),
  fallback_rows as materialized (
    select l.card, fc.slot
    from public.featured_cards fc
    cross join lateral (
      select c as card from public.cards c where c.id = fc.card_id offset 0
    ) l
  ),
  shown as (
    select (p.card).id as id, (p.card).owner_id as owner_id, (p.card).slug as slug,
      (p.card).title as title, (p.card).frame_style as frame_style,
      (p.card).rendered_image_url as rendered_image_url,
      (p.card).rendered_thumb_url as rendered_thumb_url,
      'pool'::text as src,
      (row_number() over (order by p.added_at, (p.card).id))::integer as rn
    from pool_rows p
    where public.home_hero_shown_refusal(p.card) is null
    union all
    select (f.card).id, (f.card).owner_id, (f.card).slug,
      (f.card).title, (f.card).frame_style,
      (f.card).rendered_image_url,
      (f.card).rendered_thumb_url,
      'fallback'::text as src,
      f.slot as rn
    from fallback_rows f
    where public.home_hero_refusal(f.card) is null
  )
  select s.id, s.src, s.rn, s.slug, s.title, s.frame_style,
    s.rendered_image_url, s.rendered_thumb_url, p.username, p.display_name
  from shown s
  join public.profiles p on p.id = s.owner_id
  where p.username is not null
  order by case s.src when 'pool' then 0 else 1 end, s.rn;
$$;

comment on function public.home_hero_pool() is
  'The home page hero''s cards (0169): the pool''s that are public with a bake, then the fallback slots'' that pass the original-card guard. Since 0196 each half fetches its cards by primary key before the check runs (it ran on every card of the table).';

revoke all on function public.home_hero_pool() from public;
grant execute on function public.home_hero_pool() to anon, authenticated, service_role;

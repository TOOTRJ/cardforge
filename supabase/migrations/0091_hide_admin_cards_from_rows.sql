-- 0091_hide_admin_cards_from_rows.sql — staff cards stay out of the
-- discovery rows (owner decision 2026-09-17).
--
-- "Hot this week" (trending) and "Fresh off the forge" (newest) on the
-- gallery and the homepage are the community's showcase; cards created by
-- admin accounts should not appear there. profiles.is_admin is not readable
-- by anon/authenticated (migration 0074), so the check lives in a tiny
-- SECURITY DEFINER predicate that returns only a boolean:
--
--   * owner_is_admin(owner)     — is this card's owner an admin?
--   * list_gallery_cards(...)   — gains p_hide_admin_cards (default false:
--                                 the main gallery grid is unchanged; the
--                                 "newest" row passes true).
--   * list_trending_pool(limit) — the public-card pool the trending score
--                                 ranks, already minus admin-owned cards.
--
-- Discover, search, filters and profile pages are untouched.

create or replace function public.owner_is_admin(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = p_owner_id), false);
$$;

revoke all on function public.owner_is_admin(uuid) from public;
grant execute on function public.owner_is_admin(uuid) to anon, authenticated;

-- Adding a parameter changes the signature: drop the 0086 overload first so
-- PostgREST never sees two candidates.
drop function if exists public.list_gallery_cards(text, text, text, text, text, text, boolean, text, text, integer, integer);

create or replace function public.list_gallery_cards(
  p_search text default null,
  p_card_type text default null,
  p_rarity text default null,
  p_color text default null,
  p_tag text default null,
  p_source_scryfall_id text default null,
  p_remixes_only boolean default false,
  p_sort text default 'discover',
  p_seed text default '',
  p_limit integer default 24,
  p_offset integer default 0,
  p_hide_admin_cards boolean default false
)
returns setof public.cards
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      nullif(btrim(coalesce(p_search, '')), '') as q,
      case when nullif(btrim(coalesce(p_search, '')), '') is null then null
           else websearch_to_tsquery('english', btrim(p_search)) end as tsq,
      case when nullif(btrim(coalesce(p_search, '')), '') is null then null
           else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' end as like_q
  ),
  base as (
    select c.id, c.created_at, c.updated_at, c.likes_count, c.view_count,
      -- Engagement weight: every card starts at 1 so nothing is unreachable;
      -- log-dampened so a viral card leads without monopolising the page.
      1.0 + 2.0 * ln(1.0
        + 0.05 * c.view_count
        + 1.0 * c.likes_count
        + 1.5 * c.share_count
        + 2.0 * (select count(*) from public.cards r where r.parent_card_id = c.id)) as discover_weight,
      -- Uniform (0,1) from the card id + seed: stable within a seed, fresh
      -- across seeds.
      greatest(
        (('x' || substr(md5(c.id::text || coalesce(p_seed, '')), 1, 8))::bit(32)::bigint + 2147483648.0) / 4294967296.0,
        1e-9) as discover_u,
      case when p.tsq is null then 0
           else ts_rank_cd(c.search_vector, p.tsq)
                + case when c.title ilike p.like_q escape '\' then 1.0 else 0.0 end
      end as search_rank
    from public.cards c
    cross join params p
    where c.visibility = 'public'
      and (not p_hide_admin_cards or not public.owner_is_admin(c.owner_id))
      and (p_card_type is null or c.card_type = p_card_type)
      and (p_rarity is null or c.rarity = p_rarity)
      and (p_source_scryfall_id is null or c.source_scryfall_id = p_source_scryfall_id)
      and (p_tag is null or c.tags @> array[p_tag])
      and (not p_remixes_only or c.parent_card_id is not null)
      and (
        p_color is null
        or (p_color = 'colorless' and (cardinality(c.color_identity) = 0 or 'colorless' = any(c.color_identity)))
        or (p_color = 'multicolor' and (coalesce(c.color_count, 0) > 1 or 'multicolor' = any(c.color_identity)))
        or (p_color not in ('colorless', 'multicolor') and p_color = any(c.color_identity))
      )
      and (
        p.q is null
        or c.search_vector @@ p.tsq
        or c.title ilike p.like_q escape '\'
      )
  ),
  ranked as (
    select b.id, row_number() over (
      order by
        case when (select q from params) is not null and p_sort = 'discover' then -b.search_rank end asc,
        case when p_sort = 'discover' then -ln(b.discover_u) / b.discover_weight end asc,
        case when p_sort = 'newest' then b.created_at end desc,
        case when p_sort = 'popular' then b.likes_count end desc,
        case when p_sort = 'viewed' then b.view_count end desc,
        b.updated_at desc
    ) as rn
    from base b
    order by rn
    limit greatest(1, least(p_limit, 100))
    offset greatest(0, p_offset)
  )
  select c.*
  from ranked r
  join public.cards c on c.id = r.id
  order by r.rn;
$$;

revoke all on function public.list_gallery_cards(text, text, text, text, text, text, boolean, text, text, integer, integer, boolean) from public;
grant execute on function public.list_gallery_cards(text, text, text, text, text, text, boolean, text, text, integer, integer, boolean) to anon, authenticated;

-- The trending candidate pool: the most recently touched public cards,
-- minus admin-owned ones. security invoker keeps RLS in charge of what is
-- visible; the admin predicate is the definer function above.
create or replace function public.list_trending_pool(p_limit integer default 500)
returns setof public.cards
language sql
stable
security invoker
set search_path = public
as $$
  select c.*
  from public.cards c
  where c.visibility = 'public'
    and not public.owner_is_admin(c.owner_id)
  order by c.updated_at desc
  limit greatest(1, least(p_limit, 1000));
$$;

revoke all on function public.list_trending_pool(integer) from public;
grant execute on function public.list_trending_pool(integer) to anon, authenticated;

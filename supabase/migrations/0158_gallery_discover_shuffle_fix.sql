-- 0158_gallery_discover_shuffle_fix.sql — the gallery's Discover order drew
-- its random number from the wrong range, so its weighted shuffle ran
-- BACKWARDS for half the cards and the most-engaged cards came up LEAST.
--
-- list_gallery_cards() (0086; 0091, 0136 and 0141 carried the line forward)
-- orders Discover by -ln(u) / weight (Efraimidis–Spirakis weighted sampling,
-- lib/cards/discover.ts), which needs u uniform in (0, 1). It computed
--
--   u = (('x' || substr(md5(…), 1, 8))::bit(32)::bigint + 2147483648.0) / 4294967296.0
--
-- as if `bit(32)::bigint` were SIGNED (−2³¹ … 2³¹−1). It is not: the cast
-- reads the 32 bits as an unsigned number, 0 … 2³²−1 ('xffffffff' →
-- 4294967295), so u fell in [0.5, 1.5). For every card whose u passed 1,
-- -ln(u) is NEGATIVE, and dividing a negative key by a LARGER weight brings
-- it closer to 0 — the popular card sorts LATER, the reverse of the intent.
-- With 100 cards, 10 of them weight 5, the first 8 slots went to a popular
-- card 0 % of the time (the correct draw: about a third).
--
-- The fix is that one line: u = (bits + 0.5) / 2³², in (0, 1) — never 0 and
-- never 1 (the greatest(…, 1e-9) guard stays as it was). The function below
-- is 0141's definition byte for byte with ONLY the `u` expression changed
-- (tests/unit/db/discover-shuffle-migration.test.ts holds it to 0141's
-- body). Nothing stored changes; from the deploy on, each Discover seed
-- draws a different — correctly weighted — shuffle.
--
-- 0157 (list_commander_cards, the /decks commander row, PR #705) copied the
-- same line and is fixed in its own file before it merges; this migration
-- merges after it.
--
-- Grants: unchanged. list_gallery_cards() keeps its signature (`create or
-- replace` keeps its ACL); they are restated below as 0141 left them —
-- revoked from PUBLIC, execute to anon, authenticated and service_role.
--
-- Ships through a PR; never applied ad-hoc. Idempotent.

-- The gallery search (0141's body; only the Discover draw's `u` changed) ---
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
           else '%' || translate(
                  replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_'),
                  '’‘“”—–', '''''""--') || '%' end as like_q
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
        (('x' || substr(md5(c.id::text || coalesce(p_seed, '')), 1, 8))::bit(32)::bigint + 0.5) / 4294967296.0,
        1e-9) as discover_u,
      case when p.tsq is null then 0
           else ts_rank_cd(c.search_vector, p.tsq)
                + case when translate(c.title, '’‘“”—–', '''''""--') ilike p.like_q escape '\'
                         or translate(coalesce(c.nickname, ''), '’‘“”—–', '''''""--') ilike p.like_q escape '\' then 1.0 else 0.0 end
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
        or translate(c.title, '’‘“”—–', '''''""--') ilike p.like_q escape '\'
        or translate(coalesce(c.nickname, ''), '’‘“”—–', '''''""--') ilike p.like_q escape '\'
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
grant execute on function public.list_gallery_cards(text, text, text, text, text, text, boolean, text, text, integer, integer, boolean) to anon, authenticated, service_role;

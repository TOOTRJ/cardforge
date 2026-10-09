-- 0136_gallery_search_print_typography.sql — the gallery's title search
-- reads a quote, an apostrophe and a dash as ONE character, typed or printed.
--
-- TODO 6.11 stores a new card's text as a card prints it: "Urza’s Saga",
-- "Kesh’s “Last” Stand — ’99" (U+2019, U+201C/D, U+2014) where the maker —
-- and everyone searching — types ' " and -. Cards saved before it, and
-- fields their owner has not edited since, keep the typed characters.
--
-- list_gallery_cards() matches a search two ways: full-text (search_vector)
-- and `title ilike '%<query>%'`. Full-text splits on either kind of
-- apostrophe, so whole words still match ("Urza's Saga" finds "Urza’s
-- Saga"). The ILIKE half is what carries a HALF-TYPED word ("Urza's Sa"), a
-- title made of stop words only ("It's On", "Can't") and a dash ("wait-what")
-- — and it compared characters exactly, so a straight-typed query stopped
-- finding a title stored curly (and a phone's curly-typed query never found
-- a title stored straight).
--
-- The fix: both sides of that ILIKE are read in their typed form — the
-- printed ’ ‘ “ ” — – folded to ' ' " " - - by translate(), in the query
-- (after its own % _ \ are escaped, as before) and in the title. "Urza's
-- Sa" finds "Urza’s Saga", and a phone's "Urza’s" finds a title stored
-- straight. (Not a `_` wildcard in the pattern: "n't" would then match
-- "Constrictor".) No stored row, index or search_vector changes. The title
-- side is now an expression, so cards_title_trgm_idx no longer serves this
-- predicate — it did not before either (the pattern comes from a CTE, not a
-- constant); the scan is the public cards the other filters leave.
--
-- The function body is 0091's (the latest definition), carried forward with
-- the pattern and its two ILIKEs changed — tests/unit/supabase/
-- gallery-search-typography.test.ts holds the two files together. Same
-- signature, so `create or replace` keeps the function's ACL; the grants are
-- restated below all the same (new projects do not auto-grant; as 0097 left
-- them: execute for anon, authenticated and service_role, nothing for
-- public).
--
-- Idempotent.

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
        (('x' || substr(md5(c.id::text || coalesce(p_seed, '')), 1, 8))::bit(32)::bigint + 2147483648.0) / 4294967296.0,
        1e-9) as discover_u,
      case when p.tsq is null then 0
           else ts_rank_cd(c.search_vector, p.tsq)
                + case when translate(c.title, '’‘“”—–', '''''""--') ilike p.like_q escape '\' then 1.0 else 0.0 end
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

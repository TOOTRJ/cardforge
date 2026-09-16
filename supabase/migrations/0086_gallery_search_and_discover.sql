-- 0086 — Gallery search + discover ranking, in the database.
--
--   * cards.share_count + increment_card_share(): shares become a signal the
--     gallery can weight (the share dialog reports each share, best-effort).
--   * cards.search_vector (weighted tsvector, trigger-maintained) + GIN
--     index, and a pg_trgm index on title: search matches word order /
--     stems ("dragons" finds "dragon") and partial titles, with ranking.
--   * list_gallery_cards(): ONE ranked, filtered, paged query for the public
--     gallery. sort='discover' is weighted random — every public card can
--     surface, but the ones people view, like, share and remix most surface
--     more often (Efraimidis–Spirakis: key = -ln(u) / weight, u hashed from
--     the card id + a caller seed so a page and its "Next" page agree).
--     security invoker: RLS still scopes anon to public rows.

create extension if not exists pg_trgm with schema extensions;

-- 1. Shares ---------------------------------------------------------------
alter table public.cards
  add column if not exists share_count integer not null default 0;

comment on column public.cards.share_count is
  'Lifetime share tally from the share dialog (any target), bumped by increment_card_share (best-effort).';

create or replace function public.increment_card_share(p_card_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.cards set share_count = share_count + 1 where id = p_card_id;
$$;

revoke all on function public.increment_card_share(uuid) from public;
grant execute on function public.increment_card_share(uuid) to anon, authenticated;

-- 2. Search vector --------------------------------------------------------
alter table public.cards
  add column if not exists search_vector tsvector;

create or replace function public.cards_search_vector_refresh()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('simple',
      coalesce(new.supertype, '') || ' ' || coalesce(new.card_type, '') || ' ' ||
      coalesce(array_to_string(new.subtypes, ' '), '') || ' ' ||
      coalesce(array_to_string(new.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.rules_text, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(new.flavor_text, '')), 'D');
  return new;
end;
$$;

drop trigger if exists cards_search_vector_refresh on public.cards;
create trigger cards_search_vector_refresh
  before insert or update of title, supertype, card_type, subtypes, tags, rules_text, flavor_text
  on public.cards
  for each row execute function public.cards_search_vector_refresh();

-- Backfill existing rows (the trigger runs on the no-op update).
update public.cards set title = title where search_vector is null;

create index if not exists cards_search_vector_idx
  on public.cards using gin (search_vector);
create index if not exists cards_title_trgm_idx
  on public.cards using gin (title extensions.gin_trgm_ops);
create index if not exists cards_public_created_idx
  on public.cards (created_at desc)
  where visibility = 'public';

-- 3. The gallery query ----------------------------------------------------
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
  p_offset integer default 0
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

revoke all on function public.list_gallery_cards(text, text, text, text, text, text, boolean, text, text, integer, integer) from public;
grant execute on function public.list_gallery_cards(text, text, text, text, text, text, boolean, text, text, integer, integer) to anon, authenticated;

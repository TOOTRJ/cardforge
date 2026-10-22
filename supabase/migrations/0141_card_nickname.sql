-- 0141_card_nickname.sql — a card's NICKNAME (TODO 6.3, owner 2026-10-21):
-- the flavour name print sets in the title bar, with the card's own name in
-- small italic type on a plate under it (Godzilla series, Universes Beyond
-- printings: Scryfall's `flavor_name`, "Wakandan War Panther" over
-- "Fleecemane Lion" — MSC #282).
--
--   NULL   no nickname — every row that exists today, and every card whose
--          maker leaves the field empty: the card prints exactly as before;
--   text   the name printed in the title bar on a frame that declares the
--          nickname plate (lib/cards/nickname.ts); `title` stays the card's
--          name (its slug, its page, its deck entries, its rules identity)
--          and prints on the plate.
--
-- Display and search only: what a card IS never reads it. No stored row
-- changes: the column is added NULL and nothing is backfilled. No layout
-- bump.
--
-- Search: the nickname is searchable like the name — weight A in
-- search_vector (0086's trigger, redefined with it and fired by it), and the
-- ILIKE half of list_gallery_cards() (0136's body, carried forward with ONE
-- more comparison in each place it compares the title, folded the same).
-- Every existing row's search_vector is what it was (a NULL nickname adds
-- nothing), so nothing is recomputed.
--
-- Grants: `cards` is granted at TABLE level (0097: select to anon, select /
-- insert / update / delete to authenticated, all to service_role), which
-- covers a new column on every project; RLS is row-level and unchanged.
-- list_gallery_cards() keeps its signature (`create or replace` keeps its
-- ACL); its grants are restated below as 0136 left them. The trigger
-- function is invoked by the trigger alone (no API role calls it).
--
-- Ships through a PR; never applied ad-hoc. Idempotent.

alter table public.cards
  add column if not exists nickname text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cards_nickname_length'
      and conrelid = 'public.cards'::regclass
  ) then
    alter table public.cards
      add constraint cards_nickname_length
      check (nickname is null or (char_length(nickname) between 1 and 150 and btrim(nickname) <> ''));
  end if;
end $$;

comment on column public.cards.nickname is
  'The card''s nickname / flavour name (TODO 6.3): printed in the title bar with `title` on a plate under it, on a frame that declares the plate. NULL = none (every card saved before 0141). Display and search only.';

-- Search vector (0086's definition, the nickname beside the title) ---------
create or replace function public.cards_search_vector_refresh()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '') || ' ' || coalesce(new.nickname, '')), 'A') ||
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
  before insert or update of title, nickname, supertype, card_type, subtypes, tags, rules_text, flavor_text
  on public.cards
  for each row execute function public.cards_search_vector_refresh();

-- The gallery search (0136's body; the nickname beside the title) ----------
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

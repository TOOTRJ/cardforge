-- 0157_commander_row.sql — "Cards to build around" on /decks reads public
-- LEGENDARY CREATURES, a weighted-random sample (TODO DK8.4, the
-- commander row; owner 2026-10-30).
--
-- The row used to be the gallery's trending cards. It is now its own read:
-- the cards a Commander deck can be built around, shuffled afresh at each
-- ISR regeneration of /decks (the app passes a new seed every time).
--
--   * list_commander_cards(seed, limit) — public cards whose OWNER is no
--     admin (0091's owner_is_admin, the showcase rows' rule), that are a
--     legendary creature as lib/decks/first-card.ts `isLegendaryCreature`
--     reads one: the whole word "Legendary" in `supertype`, and a creature
--     by `card_type` or a "Creature" word beside another type ("Legendary
--     Artifact Creature"); never a token or an emblem. What a card IS reads
--     `card_type` and `supertype`, never `printed_types` (CLAUDE.md "The
--     type line"). Words are split on whitespace and compared without case
--     — supertypeHasWord (lib/cards/card-display.ts) word for word.
--   * the order is list_gallery_cards' Discover order (0086): every card
--     weighted 1 + 2·ln(1 + engagement), drawn by -ln(u) / weight with u
--     uniform from md5(id || seed) — stable within a seed, fresh across
--     seeds, a popular card more likely but never a monopoly.
--
-- SECURITY INVOKER: the caller's RLS applies (anon reads public cards
-- only; the function asks for public anyway). Nothing stored changes.
--
-- Grants: the new function is revoked from PUBLIC and granted to anon,
-- authenticated and service_role — list_gallery_cards' grants (0141).

create or replace function public.list_commander_cards(
  p_seed text default '',
  p_limit integer default 12
)
returns setof public.cards
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select c.id,
      1.0 + 2.0 * ln(1.0
        + 0.05 * c.view_count
        + 1.0 * c.likes_count
        + 1.5 * c.share_count
        + 2.0 * (select count(*) from public.cards r where r.parent_card_id = c.id)) as discover_weight,
      greatest(
        (('x' || substr(md5(c.id::text || coalesce(p_seed, '')), 1, 8))::bit(32)::bigint + 2147483648.0) / 4294967296.0,
        1e-9) as discover_u
    from public.cards c
    cross join lateral (
      select regexp_split_to_array(lower(btrim(coalesce(c.supertype, ''))), '\s+') as words
    ) w
    where c.visibility = 'public'
      and c.card_type not in ('token', 'emblem')
      and 'legendary' = any(w.words)
      and (c.card_type = 'creature' or 'creature' = any(w.words))
      and not public.owner_is_admin(c.owner_id)
  )
  select c.*
  from base b
  join public.cards c on c.id = b.id
  order by -ln(b.discover_u) / b.discover_weight asc, c.id
  limit greatest(1, least(p_limit, 48));
$$;

revoke all on function public.list_commander_cards(text, integer) from public;
grant execute on function public.list_commander_cards(text, integer) to anon, authenticated, service_role;

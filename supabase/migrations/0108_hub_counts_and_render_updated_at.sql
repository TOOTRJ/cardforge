-- ===========================================================================
-- 0108 — hub-page counts + render writes stop bumping cards.updated_at
--
-- (a) Three read-only aggregates for the new browse hubs (/gallery/tag/[tag],
--     /gallery/type/[type], /decks/format/[format]) and the sitemap: public
--     card counts per discovery tag and per card type, and public non-empty
--     deck counts per format. SECURITY INVOKER so RLS applies as the caller;
--     the visibility filter keeps unlisted rows out of the public numbers.
--     PostgREST can't unnest/group, hence SQL functions.
--
-- (b) The 0100 updated_at guard ignored the counters but not the RENDER
--     columns, so every bake and every render sweep bumped updated_at (295
--     cards on one day in 2026-09): the sitemap's lastmod, the card page's
--     dateModified and "newest" orderings all read render churn as edits.
--     The guard now also subtracts rendered_image_url, rendered_thumb_url,
--     rendered_at and layout_version. The share-image cache-buster keys on
--     max(updated_at, rendered_at) from now on (lib/cards/render-version.ts),
--     so a rebake still refreshes the OG image.
-- ===========================================================================

create or replace function public.gallery_tag_counts()
returns table (tag text, card_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select t.tag, count(*)::bigint as card_count
  from public.cards c
  cross join lateral unnest(c.tags) as t(tag)
  where c.visibility = 'public'
  group by t.tag
  order by count(*) desc, t.tag asc;
$$;

create or replace function public.gallery_type_counts()
returns table (card_type text, card_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select c.card_type, count(*)::bigint as card_count
  from public.cards c
  where c.visibility = 'public'
  group by c.card_type
  order by count(*) desc, c.card_type asc;
$$;

create or replace function public.public_deck_format_counts()
returns table (format text, deck_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select d.format, count(*)::bigint as deck_count
  from public.decks d
  where d.visibility = 'public'
    and exists (select 1 from public.deck_cards dc where dc.deck_id = d.id)
  group by d.format
  order by count(*) desc, d.format asc;
$$;

-- (b) render writes are not edits
create or replace function public.set_cards_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new)
        - 'view_count' - 'likes_count' - 'share_count' - 'updated_at' - 'color_count'
        - 'rendered_image_url' - 'rendered_thumb_url' - 'rendered_at' - 'layout_version')
     is distinct from
     (to_jsonb(old)
        - 'view_count' - 'likes_count' - 'share_count' - 'updated_at' - 'color_count'
        - 'rendered_image_url' - 'rendered_thumb_url' - 'rendered_at' - 'layout_version') then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end;
$$;

-- Grants (every migration states them — new projects don't auto-grant). The
-- three aggregates are public reads; the trigger function needs none.
revoke all on function public.gallery_tag_counts() from public;
grant execute on function public.gallery_tag_counts() to anon, authenticated, service_role;
revoke all on function public.gallery_type_counts() from public;
grant execute on function public.gallery_type_counts() to anon, authenticated, service_role;
revoke all on function public.public_deck_format_counts() from public;
grant execute on function public.public_deck_format_counts() to anon, authenticated, service_role;

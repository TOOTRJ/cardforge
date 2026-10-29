-- ===========================================================================
-- 0147 — the public creators directory and the requested-frames list
-- (TODO NV11 and the first part of NV12; the decks / navigation / width plan,
-- owner 2026-10-28). Two read-only aggregates, nothing written.
--
-- (a) list_public_creators(sort, limit, offset) — /creators and
--     /creators/browse. The makers with at least one PUBLIC card (the rule
--     the sitemap already lists profiles by, app/sitemap.ts), minus admin
--     accounts (0091's owner_is_admin(), as the trending and newest rows),
--     each with: the public card count, the public decks that hold at least
--     one card (0108's non-empty rule), the likes on their public cards, the
--     date of their newest public card, and that card's id with the two
--     before it (the row's strip — the app reads those cards by id), plus
--     the total for paging. SECURITY INVOKER: RLS applies as the caller, and
--     the explicit visibility filters keep every number viewer-independent
--     (a signed-in caller's own private or unlisted cards and decks never
--     count). PostgREST can't group and order by an aggregate, hence SQL.
--     Sorts: 'cards' (most public cards; the default), 'recent' (newest
--     public card), 'liked' (most likes on public cards) — any other value
--     reads as 'cards'. The makers CTE is MATERIALIZED so owner_is_admin()
--     runs once per maker: inlined, the planner pushes that filter below the
--     GROUP BY and calls it once per public card.
--
-- (b) requested_frame_counts(signatures, answered) — /frames/requested. Per
--     frame signature, how many PEOPLE (distinct non-admin accounts) logged
--     an import PipGlyph couldn't draw exactly (0123's frame_requests).
--     frame_requests is admin-read only (0123), so this is SECURITY DEFINER
--     with an empty search_path, and it publishes a count per frame and
--     nothing else:
--       * never a user id, set, collector number, Scryfall id, template,
--         cause, date or a row's label — where a frame stands is the app's
--         answer from its registry and the verified combos, never a row's;
--       * the one text it returns, `signature`, is always an element of the
--         caller's own p_signatures (the app passes its registry's keys):
--         record_frame_request() takes any signature and label text from a
--         signed-in caller, so a row's own text could say anything — the app
--         names every frame from its code (lib/frames/requested-frames.ts),
--         never from a row. A caller may name keys the page leaves out (a
--         family PipGlyph will never build, a retired key): it gets the same
--         count, under the same rules, for those;
--       * it can't be watched live: it counts only rows from BEFORE today's
--         UTC midnight, back 180 days from that midnight — fixed here, not a
--         parameter — so a poll sees at most one change a day, never the
--         import that arrived a minute ago;
--       * a frame is published only once `min_people` (k = 2) distinct
--         people asked for it, so no count is one person's import. k is the
--         owner's to change (a new migration; REQUESTED_FRAMES_MIN_PEOPLE in
--         lib/frames/requested-frames.ts mirrors it, a test holds the two).
--     p_answered drops the rows whose "signature|template" pair PipGlyph
--     draws today (a gap logged before its piece shipped — the admin page's
--     `drawnNow`, lib/scryfall/frame-signatures.ts signatureDrawnOn). It has
--     to be per ROW: whether a gap is drawn depends on the frame the import
--     landed on (era/2015+crown is drawn on 7 of its rule's 18 frames), and
--     the rows' templates are never returned. A caller can still compare two
--     calls with different lists; what that tells is how many people's
--     day-old rows for a signature sit on one frame, and k applies after the
--     exclusion. Both arrays are capped (`max_keys`, 600) and the call is
--     refused past it.
--
-- Grants: both are public reads (anon, authenticated, service_role), never
-- PUBLIC. The table grants of 0123 are untouched — the API roles still can't
-- read frame_requests itself.
--
-- Ships through a PR; never applied ad-hoc.
-- ===========================================================================

create or replace function public.list_public_creators(
  p_sort text default 'cards',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  public_cards bigint,
  public_decks bigint,
  likes bigint,
  last_card_at timestamptz,
  recent_card_ids uuid[],
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with makers as materialized (
    select
      c.owner_id,
      count(*)::bigint as public_cards,
      coalesce(sum(c.likes_count), 0)::bigint as likes,
      max(c.created_at) as last_card_at
    from public.cards c
    where c.visibility = 'public'
    group by c.owner_id
  ),
  ranked as (
    select
      m.owner_id,
      p.username,
      p.display_name,
      p.avatar_url,
      m.public_cards,
      m.likes,
      m.last_card_at,
      row_number() over (
        order by
          case when p_sort = 'recent' then m.last_card_at end desc nulls last,
          case when p_sort = 'liked' then m.likes end desc nulls last,
          m.public_cards desc,
          m.last_card_at desc,
          p.username asc
      ) as rn,
      count(*) over () as total
    from makers m
    join public.profiles p on p.id = m.owner_id
    where not public.owner_is_admin(m.owner_id)
  ),
  page as (
    select r.*
    from ranked r
    order by r.rn
    limit greatest(1, least(coalesce(p_limit, 24), 60))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    pg.owner_id as id,
    pg.username,
    pg.display_name,
    pg.avatar_url,
    pg.public_cards,
    (
      select count(*)
      from public.decks d
      where d.owner_id = pg.owner_id
        and d.visibility = 'public'
        and exists (select 1 from public.deck_cards dc where dc.deck_id = d.id)
    )::bigint as public_decks,
    pg.likes,
    pg.last_card_at,
    array(
      select c.id
      from public.cards c
      where c.owner_id = pg.owner_id
        and c.visibility = 'public'
      order by c.created_at desc, c.id
      limit 3
    ) as recent_card_ids,
    pg.total
  from page pg
  order by pg.rn;
$$;

create or replace function public.requested_frame_counts(
  p_signatures text[],
  p_answered text[] default '{}'
)
returns table (
  signature text,
  people bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- k: a frame is published only once this many distinct people asked.
  min_people constant integer := 2;
  -- The most keys / answered pairs one call may pass.
  max_keys constant integer := 600;
  -- Today's UTC midnight: the window ends there, never at now().
  window_end constant timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
begin
  if coalesce(cardinality(p_signatures), 0) > max_keys
     or coalesce(cardinality(p_answered), 0) > max_keys then
    raise exception 'requested_frame_counts: at most % signatures and % answered pairs', max_keys, max_keys
      using errcode = '22023';
  end if;

  return query
    select
      r.signature,
      count(distinct r.user_id)::bigint
    from public.frame_requests r
    join public.profiles p on p.id = r.user_id
    where r.signature = any(coalesce(p_signatures, '{}'::text[]))
      and not p.is_admin
      and r.created_at >= window_end - interval '180 days'
      and r.created_at < window_end
      and (r.signature || '|' || coalesce(r.template, '')) <> all(coalesce(p_answered, '{}'::text[]))
    group by r.signature
    having count(distinct r.user_id) >= min_people
    order by count(distinct r.user_id) desc, r.signature asc
    limit 200;
end;
$$;

-- Grants (every migration states them — new projects don't auto-grant, and
-- production auto-grants everything, so the revokes make both match).
revoke all on function public.list_public_creators(text, integer, integer) from public;
grant execute on function public.list_public_creators(text, integer, integer)
  to anon, authenticated, service_role;

revoke all on function public.requested_frame_counts(text[], text[]) from public;
grant execute on function public.requested_frame_counts(text[], text[])
  to anon, authenticated, service_role;

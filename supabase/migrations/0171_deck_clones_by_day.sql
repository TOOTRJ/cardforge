-- 0171_deck_clones_by_day.sql — the owner's clones per day (TODO DK7.4a, the
-- deck activity panel's third series).
--
-- The panel draws a deck's views and likes over 7 / 30 / 90 days against the
-- period before (0151's deck_views_by_day, 0154's deck_likes_by_day). Clones
-- are recorded since 0164: clone_deck() writes one deck_remix_sources row per
-- copy of ANOTHER owner's deck (source_deck_id = the deck cloned). That table
-- grants nothing to any API role, so the panel cannot read it; this function
-- counts the rows in the database and hands out only the counts.
--
-- It mirrors deck_likes_by_day word for word: the deck's OWNER only (anyone
-- else — another user, anon — gets no rows), every UTC day of the last
-- `days` (clamped 1–400, default 30), oldest first, zeros included. A clone
-- counts on the UTC day it was made, and — like a like — only while it
-- exists: a clone deck its maker deleted is gone from deck_remix_sources
-- (on delete cascade), so the series is the clones the deck HOLDS. A deck
-- copied by its own owner ("Duplicate") writes no lineage row, and the count
-- also leaves out any row whose clone deck belongs to the source's owner, so
-- the owner's own copy is never a clone here whatever wrote the row. Nothing
-- is stored; no table, policy or column changes.
--
-- The Pro gate is the app's (lib/decks/activity-actions.ts reads
-- getEntitlements before calling the functions): the numbers are the
-- owner's own, so the database's rule is ownership alone, as 0151's / 0154's.
--
-- Grants: deck_clones_by_day() is authenticated's and the service role's;
-- anon and PUBLIC have no EXECUTE (a new project grants nothing, prod's old
-- project auto-grants — the revoke makes them agree).

create or replace function public.deck_clones_by_day(p_deck_id uuid, p_days integer default 30)
returns table (day date, clones integer)
language sql
stable
security definer
set search_path = ''
as $$
  with deck as (
    select d.id, d.owner_id from public.decks d
    where d.id = p_deck_id and d.owner_id = auth.uid()
  ),
  span as (
    select generate_series(
      (now() at time zone 'utc')::date - (least(greatest(coalesce(p_days, 30), 1), 400) - 1),
      (now() at time zone 'utc')::date,
      interval '1 day'
    )::date as day
  ),
  clone as (
    select r.created_at
    from deck
    join public.deck_remix_sources r on r.source_deck_id = deck.id
    join public.decks c on c.id = r.deck_id
    where c.owner_id <> deck.owner_id
  )
  select s.day, count(c.created_at)::integer as clones
  from deck
  cross join span s
  left join clone c
    on (c.created_at at time zone 'utc')::date = s.day
  group by s.day
  order by s.day;
$$;

comment on function public.deck_clones_by_day(uuid, integer) is
  'The caller''s OWN deck''s clones per UTC day they were made, for the last p_days (1–400), zeros included, oldest first; never the owner''s own copy; no rows for anyone else''s deck (0171).';

-- ===========================================================================
-- Grants
-- ===========================================================================

revoke all on function public.deck_clones_by_day(uuid, integer) from public, anon;
grant execute on function public.deck_clones_by_day(uuid, integer) to authenticated, service_role;

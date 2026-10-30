-- 0154_deck_activity.sql — the owner's likes per day (TODO DK7.4, the deck
-- activity panel; owner approval 2026-10-30).
--
-- The panel draws a deck's views and likes over 7 / 30 / 90 days against the
-- period before. Views come from 0151's deck_views_by_day. Likes need the
-- same shape: deck_likes rows are readable by anyone who can open the deck
-- (0151's policy), but counting them in the browser means reading every
-- like row of the deck — one user id each, past PostgREST's row cap on a
-- popular deck — to draw a handful of numbers. deck_likes_by_day(deck, days)
-- counts them in the database instead and hands out only the counts.
--
-- It mirrors deck_views_by_day word for word: the deck's OWNER only (anyone
-- else — another user, anon — gets no rows), every UTC day of the last
-- `days` (clamped 1–400, default 30), oldest first, zeros included. A like
-- counts on the UTC day it was made; an unliked deck's like is gone from
-- deck_likes, so the series is the likes the deck HOLDS, by the day each
-- was given (decks.likes_count is their total). Nothing is stored; no table,
-- policy or column changes.
--
-- The Pro gate is the app's (lib/decks/activity-actions.ts reads
-- getEntitlements before calling either function): the numbers are the
-- owner's own, so the database's rule is ownership alone, as 0151's.
--
-- Grants: deck_likes_by_day() is authenticated's and the service role's;
-- anon and PUBLIC have no EXECUTE (a new project grants nothing, prod's old
-- project auto-grants — the revoke makes them agree).

create or replace function public.deck_likes_by_day(p_deck_id uuid, p_days integer default 30)
returns table (day date, likes integer)
language sql
stable
security definer
set search_path = ''
as $$
  with deck as (
    select d.id from public.decks d
    where d.id = p_deck_id and d.owner_id = auth.uid()
  ),
  span as (
    select generate_series(
      (now() at time zone 'utc')::date - (least(greatest(coalesce(p_days, 30), 1), 400) - 1),
      (now() at time zone 'utc')::date,
      interval '1 day'
    )::date as day
  )
  select s.day, count(l.id)::integer as likes
  from deck
  cross join span s
  left join public.deck_likes l
    on l.deck_id = deck.id
   and (l.created_at at time zone 'utc')::date = s.day
  group by s.day
  order by s.day;
$$;

comment on function public.deck_likes_by_day(uuid, integer) is
  'The caller''s OWN deck''s likes per UTC day they were given, for the last p_days (1–400), zeros included, oldest first; no rows for anyone else''s deck (0154).';

-- ===========================================================================
-- Grants
-- ===========================================================================

revoke all on function public.deck_likes_by_day(uuid, integer) from public, anon;
grant execute on function public.deck_likes_by_day(uuid, integer) to authenticated, service_role;

-- 0203_admin_content_stats.sql — what people make and look at, for the admin
-- Content tab (/admin/analytics?tab=content).
--
-- Until now no admin page said how many cards and decks were made in a
-- period, how many of them are public, or which ones people open. One call
-- answers it for a period and for the same stretch N days earlier.
--
--   admin_content_stats(p_since, p_until default now(), p_include_admins default false) → jsonb
--
-- THE PERIOD is [p_since, p_until). THE PREVIOUS PERIOD is the SAME STRETCH
-- N days earlier: [p_since − N days, p_until − N days), N = the number of
-- UTC days the period touches (never under 1). The page asks for "the last
-- 30 UTC days, today included" (lib/admin/analytics/params.ts
-- analyticsPeriod: p_since = the start of a UTC day, p_until = now), so N is
-- 30 and the two periods are exactly as long as each other — the same
-- `previousSince` / `previousUntil` every other tab of the page compares
-- with. (Thirty WHOLE days against a period whose last day is part-way
-- through read every steady number as a fall.) What happened in the rest of
-- that earlier day is in neither period. Days are UTC. A VIEW is stored by
-- its day, not its instant: a day counts whole when it starts inside a
-- period, so the earlier period's last day is whole while today is as far
-- as it has got.
--
-- THE ANSWER, key by key:
--   since, until, previousSince, previousUntil
--                                 the bounds used (timestamps).
--   current, previous             one object per period:
--     cardsCreated     cards whose created_at is in the period (and that
--                      still exist: a deleted card is gone).
--     cardsPublic / cardsUnlisted / cardsPrivate
--                      those same cards by who can see them NOW (the three
--                      add up to cardsCreated).
--     decksCreated     decks whose created_at is in the period.
--     cardLikes / deckLikes
--                      likes given in the period that still stand (taking a
--                      like back deletes its row).
--     cardViews / deckViews
--                      rows of card_views (0168) / deck_views (0151) whose
--                      UTC day STARTS in the period: one per viewer, card (or
--                      deck) and UTC day, never the owner's own, a crawler's
--                      or a prefetch's.
--   perDay             the period's UTC days that have anything, oldest
--                      first: [{ day: 'YYYY-MM-DD', cardsCreated,
--                      decksCreated, cardViews }]. A quiet day has no row
--                      (the page fills it with zeros).
--   topCards           the 10 cards with the most views in the period:
--                      [{ id, title, slug, ownerId, username, views }] —
--                      PUBLIC cards only.
--   topDecks           the same for decks: PUBLIC decks only.
--
-- WHY PUBLIC ONLY in the two lists: a private card's title is its owner's
-- alone (a card with strong language is saved private for that reason), and
-- an unlisted card or deck is link-only — an admin page must not hand
-- either's title to everyone who can open the page. The COUNTS take every
-- visibility: a number names nothing.
--
-- p_include_admins = false (the default) leaves out cards and decks OWNED by
-- an admin and likes GIVEN by an admin — in beta the team's own activity is
-- most of it. VIEWS carry no user at all (the log keeps a salted key, no id,
-- address or cookie — 0151 / 0168), so a view cannot be told an admin's from
-- anyone's: views are counted for the content that is kept in — with admins
-- left out, views of an admin's cards and decks go with them, and a view BY
-- an admin of someone else's card stays.
--
-- An admin's FRAME PREVIEW (cards.frame_preview, 0121: saved while checking
-- a frame, always private) is a tool's working file, not something made: it
-- is never counted, whatever p_include_admins says.
--
-- Nothing is written. SECURITY DEFINER with an empty search_path: it reads
-- every card and deck whatever its visibility, and the two view logs no API
-- role may read.
--
-- Grants are explicit (0097): the service role's alone — the page checks the
-- viewer is an admin, then reads through the admin client
-- (lib/admin/analytics/content.ts). Idempotent. Ships through a PR; never
-- applied ad-hoc.

drop function if exists public.admin_content_stats(timestamptz, timestamptz, boolean);

create or replace function public.admin_content_stats(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_include_admins boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with asked as materialized (
    select
      p_since as since,
      coalesce(p_until, now()) as until,
      -- N = the UTC days the period touches.
      greatest(
        1,
        ((coalesce(p_until, now()) at time zone 'utc')::date - (p_since at time zone 'utc')::date) + 1
      ) as n_days
  ),
  bounds as materialized (
    select
      r.since,
      r.until,
      -- N days back, in exact seconds (an interval of "days" would follow
      -- the session's time zone across a clock change).
      r.since - make_interval(secs => 86400.0 * r.n_days) as previous_since,
      r.until - make_interval(secs => 86400.0 * r.n_days) as previous_until
    from asked r
  ),
  admins as materialized (
    select p.id from public.profiles p where p.is_admin
  ),
  -- Everything made, liked or viewed from the previous period's start to the
  -- period's end, each row marked with the period it belongs to.
  cards_made as materialized (
    select c.created_at, c.visibility, (c.created_at >= b.since) as in_period
    from bounds b
    join public.cards c on c.created_at >= b.previous_since and c.created_at < b.until
    where (c.created_at >= b.since or c.created_at < b.previous_until)
      and not c.frame_preview
      and (coalesce(p_include_admins, false) or c.owner_id not in (select a.id from admins a))
  ),
  decks_made as materialized (
    select d.created_at, (d.created_at >= b.since) as in_period
    from bounds b
    join public.decks d on d.created_at >= b.previous_since and d.created_at < b.until
    where (d.created_at >= b.since or d.created_at < b.previous_until)
      and (coalesce(p_include_admins, false) or d.owner_id not in (select a.id from admins a))
  ),
  card_likes_given as materialized (
    select (l.created_at >= b.since) as in_period
    from bounds b
    join public.card_likes l on l.created_at >= b.previous_since and l.created_at < b.until
    where (l.created_at >= b.since or l.created_at < b.previous_until)
      and (coalesce(p_include_admins, false) or l.user_id not in (select a.id from admins a))
  ),
  deck_likes_given as materialized (
    select (l.created_at >= b.since) as in_period
    from bounds b
    join public.deck_likes l on l.created_at >= b.previous_since and l.created_at < b.until
    where (l.created_at >= b.since or l.created_at < b.previous_until)
      and (coalesce(p_include_admins, false) or l.user_id not in (select a.id from admins a))
  ),
  -- A view belongs to its UTC day; the day counts when its START is in the
  -- period. The date range is the index's (…_views_day_idx); the instants
  -- are the exact test.
  card_views_seen as materialized (
    select v.card_id, v.day, ((v.day::timestamp at time zone 'utc') >= b.since) as in_period
    from bounds b
    join public.card_views v
      on v.day >= (b.previous_since at time zone 'utc')::date
     and v.day <= (b.until at time zone 'utc')::date
    join public.cards c on c.id = v.card_id
    where (v.day::timestamp at time zone 'utc') >= b.previous_since
      and (v.day::timestamp at time zone 'utc') < b.until
      and ((v.day::timestamp at time zone 'utc') >= b.since or (v.day::timestamp at time zone 'utc') < b.previous_until)
      and not c.frame_preview
      and (coalesce(p_include_admins, false) or c.owner_id not in (select a.id from admins a))
  ),
  deck_views_seen as materialized (
    select v.deck_id, ((v.day::timestamp at time zone 'utc') >= b.since) as in_period
    from bounds b
    join public.deck_views v
      on v.day >= (b.previous_since at time zone 'utc')::date
     and v.day <= (b.until at time zone 'utc')::date
    join public.decks d on d.id = v.deck_id
    where (v.day::timestamp at time zone 'utc') >= b.previous_since
      and (v.day::timestamp at time zone 'utc') < b.until
      and ((v.day::timestamp at time zone 'utc') >= b.since or (v.day::timestamp at time zone 'utc') < b.previous_until)
      and (coalesce(p_include_admins, false) or d.owner_id not in (select a.id from admins a))
  ),
  totals as (
    select
      w.in_period,
      jsonb_build_object(
        'cardsCreated', (select count(*) from cards_made x where x.in_period = w.in_period),
        'cardsPublic', (select count(*) from cards_made x where x.in_period = w.in_period and x.visibility = 'public'),
        'cardsUnlisted', (select count(*) from cards_made x where x.in_period = w.in_period and x.visibility = 'unlisted'),
        'cardsPrivate', (select count(*) from cards_made x where x.in_period = w.in_period and x.visibility = 'private'),
        'decksCreated', (select count(*) from decks_made x where x.in_period = w.in_period),
        'cardLikes', (select count(*) from card_likes_given x where x.in_period = w.in_period),
        'deckLikes', (select count(*) from deck_likes_given x where x.in_period = w.in_period),
        'cardViews', (select count(*) from card_views_seen x where x.in_period = w.in_period),
        'deckViews', (select count(*) from deck_views_seen x where x.in_period = w.in_period)
      ) as numbers
    from (values (true), (false)) as w (in_period)
  ),
  day_rows as (
    select (x.created_at at time zone 'utc')::date as day, count(*) as cards, 0::bigint as decks, 0::bigint as views
    from cards_made x
    where x.in_period
    group by 1
    union all
    select (x.created_at at time zone 'utc')::date, 0::bigint, count(*), 0::bigint
    from decks_made x
    where x.in_period
    group by 1
    union all
    select x.day, 0::bigint, 0::bigint, count(*)
    from card_views_seen x
    where x.in_period
    group by 1
  ),
  per_day as (
    select r.day, sum(r.cards) as cards, sum(r.decks) as decks, sum(r.views) as views
    from day_rows r
    group by r.day
  ),
  top_cards as (
    select c.id, c.title, c.slug, c.owner_id, p.username, seen.views
    from (
      select x.card_id, count(*) as views
      from card_views_seen x
      where x.in_period
      group by x.card_id
    ) seen
    join public.cards c on c.id = seen.card_id and c.visibility = 'public'
    left join public.profiles p on p.id = c.owner_id
    order by seen.views desc, c.created_at desc, c.id
    limit 10
  ),
  top_decks as (
    select d.id, d.title, d.slug, d.owner_id, p.username, seen.views
    from (
      select x.deck_id, count(*) as views
      from deck_views_seen x
      where x.in_period
      group by x.deck_id
    ) seen
    join public.decks d on d.id = seen.deck_id and d.visibility = 'public'
    left join public.profiles p on p.id = d.owner_id
    order by seen.views desc, d.created_at desc, d.id
    limit 10
  )
  select jsonb_build_object(
    'since', b.since,
    'until', b.until,
    'previousSince', b.previous_since,
    'previousUntil', b.previous_until,
    'current', (select t.numbers from totals t where t.in_period),
    'previous', (select t.numbers from totals t where not t.in_period),
    'perDay', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'day', to_char(d.day, 'YYYY-MM-DD'),
          'cardsCreated', d.cards,
          'decksCreated', d.decks,
          'cardViews', d.views
        ) order by d.day
      )
      from per_day d
    ), '[]'::jsonb),
    'topCards', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id, 'title', t.title, 'slug', t.slug,
          'ownerId', t.owner_id, 'username', t.username, 'views', t.views
        ) order by t.views desc, t.title, t.id
      )
      from top_cards t
    ), '[]'::jsonb),
    'topDecks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id, 'title', t.title, 'slug', t.slug,
          'ownerId', t.owner_id, 'username', t.username, 'views', t.views
        ) order by t.views desc, t.title, t.id
      )
      from top_decks t
    ), '[]'::jsonb)
  )
  from bounds b;
$$;

comment on function public.admin_content_stats(timestamptz, timestamptz, boolean) is
  'The admin Content tab''s numbers (0203) for [p_since, p_until) and the same stretch N UTC days earlier, [p_since − N days, p_until − N days): cards created (and their visibility now), decks created, likes still standing, card and deck views, a per-UTC-day series, and the 10 most viewed PUBLIC cards and decks. p_include_admins = false leaves out admins'' own cards, decks and likes; views carry no user and follow the content kept in. Frame previews are never counted. Service role only.';

revoke all on function public.admin_content_stats(timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.admin_content_stats(timestamptz, timestamptz, boolean) to service_role;

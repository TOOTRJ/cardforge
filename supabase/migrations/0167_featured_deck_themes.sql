-- 0167_featured_deck_themes.sql — the /decks landing's two new sections
-- (owner request 2026-11-03): "Featured themed decks" (admin-curated, on
-- /decks AND the home page) and "Discover" (a weighted shuffle that
-- replaces "Newest public decks").
--
-- Why "Newest public decks" went: it ordered by decks.updated_at, which
-- every edit moves — 0143's sync_deck_from_entries touches it on every
-- entry change and set_decks_updated_at on every other column — so a deck
-- made a year ago led the "newest" row the minute its owner changed a copy
-- count. The landing now shows Discover instead; /decks/browse's "Recently
-- updated" sort says what it does and stays.
--
-- 1. FEATURED THEMED DECKS (owner decision 2026-11-03: admin themes). An
--    admin makes a THEME — a title ("Dragons ascendant") and a one-line
--    blurb — and pastes deck URLs into it, in /admin/featured. Two tables:
--      * deck_themes — title (1–60), blurb (≤ 160, optional), position
--        (the order themes show in, lowest first), is_live (a theme can be
--        prepared or rested without losing its picks);
--      * deck_theme_decks — (theme, deck) with the deck's position in the
--        theme. A deck may sit in more than one theme. Deleting a deck or a
--        theme deletes its rows (cascade).
--    Admin-only state: RLS on, NO policy, nothing granted to anon or
--    authenticated — the admin page writes and reads through the service
--    role behind its is_admin check (0053's featured_cards posture, minus
--    the public read: a pick is a DECK ID, and an unlisted deck is reached
--    by naming its id (0151) — a raw pick list would hand one out after a
--    featured deck turned unlisted).
--
--    Every visitor-facing read goes through ONE function,
--    list_featured_deck_themes(themes, decks): the live themes, in order,
--    each with the ids of its decks a visitor may see — PUBLIC, NON-EMPTY
--    (the stored card_count, 0143: the maybeboard never counts) and a REAL
--    CREATOR's (0149's owner_is_creator: no admin, a public card of their
--    own — trending's rule) — in the theme's order, at most `decks` (1–8,
--    default 4) of them. A theme left with no such deck is left out, so the
--    page never shows a theme over nothing. At most `themes` (1–6, default
--    3) themes. SECURITY DEFINER (the tables grant the API roles nothing)
--    with an empty search_path; it returns ids only — the app reads the
--    deck rows through the public client as every deck list does.
--
-- 2. DISCOVER (owner decision 2026-11-03: size + engagement).
--    list_discover_decks(seed, limit) is the gallery's Discover draw
--    (list_gallery_cards, 0086 / 0158; lib/cards/discover.ts) over decks:
--      weight = size × (1 + 2·ln(1 + 0.05·views + 1·likes))
--      size   = 3 for a deck of 10 or more cards (card_count), else 1
--      key    = −ln(u) / weight, u = (32 md5 bits of id ‖ seed + 0.5) / 2³²
--    ordered by key ascending (Efraimidis–Spirakis weighted sampling: a
--    heavier deck comes up EARLIER more often, every deck can come up).
--    u is 0158's corrected draw — (bits + 0.5) / 2³², inside (0, 1) — never
--    0086's signed-offset form. The pool is trending's: public, non-empty,
--    a real creator's. At most 48 a call (default 24). SECURITY INVOKER:
--    anon reads public decks (0055 / 0151), and owner_is_creator is a
--    public read too. The weight is mirrored for tests in
--    lib/decks/discover.ts (`deckDiscoverWeight`).
--
-- 3. TRENDING BY RANGE (owner request 2026-11-04: "Hot this week /
--    month / year / all time", default the month, the gallery's rules).
--    list_trending_decks_by_range(range, limit) is 0166's
--    list_trending_cards over decks — the same ranges, windows, half-lives
--    and like weight (lib/cards/trending.ts mirrors them; a unit test
--    holds both functions to that one copy):
--      score = Σ 3 · 0.5 ^ (age_days / half_life)   over the range's likes
--    * a deck's only public engagement EVENT is a like (one row per liker,
--      deck_likes' unique key) — deck feedback is private to its owner,
--      and a deck has no comments or remixes;
--    * the deck owner's own like never counts;
--    * ranges: week = 7 days, half-life 3; month = 30 days, half-life 10;
--      year = 365 days, half-life 90; all = every like, no decay; any
--      other value reads as month (the default on /decks, as on /gallery);
--    * PUBLIC, NON-EMPTY decks (card_count > 0) of a real creator
--      (owner_is_creator) — 0149's trending pool;
--    * a deck with no like in the range is not "hot": no padding;
--    * ONE deck per creator (their best), as the gallery's one card;
--    * ties: score, then people (likers in the range), then lifetime
--      likes, then the NEWEST DECK (created_at — never updated_at, which
--      every edit moves), then id.
--    It returns ids and the range's like count (what the tiles print); the
--    app reads the deck rows through the public client. SECURITY INVOKER:
--    anon reads public decks and their likes, so every caller gets one
--    answer. 0149's list_trending_decks stays for the deployment live
--    while this lands (the app no longer calls it); dropping it is a
--    follow-up. A new index on deck_likes(created_at) keeps the windows
--    cheap.
--
-- Grants: the two tables — revoked from public, anon and authenticated
-- (production auto-grants new public objects to the API roles; this takes
-- that back), everything to service_role. The three functions — public
-- reads: PUBLIC revoked, EXECUTE to anon, authenticated and service_role.
--
-- Backward compatible: nothing old reads either table or function.
-- Ships through a PR; never applied ad-hoc. Idempotent.

-- ===========================================================================
-- 1. Featured themed decks
-- ===========================================================================

create table if not exists public.deck_themes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  blurb text,
  position integer not null default 0,
  is_live boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deck_themes_title_check
    check (title = btrim(title) and char_length(title) between 1 and 60),
  constraint deck_themes_blurb_check
    check (blurb is null or (blurb = btrim(blurb) and char_length(blurb) between 1 and 160))
);

create table if not exists public.deck_theme_decks (
  theme_id uuid not null references public.deck_themes (id) on delete cascade,
  deck_id uuid not null references public.decks (id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (theme_id, deck_id)
);

-- A deck's themes (the cascade on a deck delete, the admin page's lookup).
create index if not exists deck_theme_decks_deck_idx
  on public.deck_theme_decks (deck_id);

alter table public.deck_themes enable row level security;
alter table public.deck_theme_decks enable row level security;
-- No policies: the service role alone reads and writes these rows.

revoke all on table public.deck_themes from public, anon, authenticated;
revoke all on table public.deck_theme_decks from public, anon, authenticated;
grant select, insert, update, delete on table public.deck_themes to service_role;
grant select, insert, update, delete on table public.deck_theme_decks to service_role;

create or replace function public.list_featured_deck_themes(
  p_themes integer default 3,
  p_decks integer default 4
)
returns table (theme_id uuid, title text, blurb text, deck_ids uuid[])
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.title, t.blurb, picks.deck_ids
  from public.deck_themes t
  cross join lateral (
    select array_agg(shown.deck_id order by shown.position, shown.created_at, shown.deck_id) as deck_ids
    from (
      select td.deck_id, td.position, td.created_at
      from public.deck_theme_decks td
      join public.decks d on d.id = td.deck_id
      where td.theme_id = t.id
        and d.visibility = 'public'
        and d.card_count > 0
        and public.owner_is_creator(d.owner_id)
      order by td.position, td.created_at, td.deck_id
      limit least(greatest(coalesce(p_decks, 4), 1), 8)
    ) shown
  ) picks
  where t.is_live
    and picks.deck_ids is not null
  order by t.position, t.created_at, t.id
  limit least(greatest(coalesce(p_themes, 3), 1), 6);
$$;

revoke all on function public.list_featured_deck_themes(integer, integer) from public;
grant execute on function public.list_featured_deck_themes(integer, integer) to anon, authenticated, service_role;

-- ===========================================================================
-- 2. Discover
-- ===========================================================================

create or replace function public.list_discover_decks(
  p_seed text default '',
  p_limit integer default 24
)
returns setof public.decks
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select d.id,
      -- Size first (the owner's rule: a deck of 10+ cards shows more
      -- often), then engagement, log-dampened as the gallery's: every deck
      -- starts at weight ≥ 1, so nothing is unreachable.
      (case when d.card_count >= 10 then 3.0 else 1.0 end)
        * (1.0 + 2.0 * ln(1.0 + 0.05 * d.view_count + 1.0 * d.likes_count)) as discover_weight,
      -- Uniform (0, 1) from the deck id + seed (0158's draw): stable within
      -- a seed, fresh across seeds.
      greatest(
        (('x' || substr(md5(d.id::text || coalesce(p_seed, '')), 1, 8))::bit(32)::bigint + 0.5) / 4294967296.0,
        1e-9) as discover_u
    from public.decks d
    where d.visibility = 'public'
      and d.card_count > 0
      and public.owner_is_creator(d.owner_id)
  )
  select d.*
  from base b
  join public.decks d on d.id = b.id
  order by -ln(b.discover_u) / b.discover_weight asc, d.id
  limit least(greatest(coalesce(p_limit, 24), 1), 48);
$$;

revoke all on function public.list_discover_decks(text, integer) from public;
grant execute on function public.list_discover_decks(text, integer) to anon, authenticated, service_role;

-- ===========================================================================
-- 3. Trending by range — "Hot this week / month / year / all time".
-- ===========================================================================

create index if not exists deck_likes_created_at_idx
  on public.deck_likes (created_at);

create or replace function public.list_trending_decks_by_range(
  p_range text default 'month',
  p_limit integer default 8
)
returns table (
  deck_id uuid,
  score double precision,
  likes integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with cfg as (
    select
      case p_range
        when 'week' then now() - interval '7 days'
        when 'year' then now() - interval '365 days'
        when 'all' then '-infinity'::timestamptz
        else now() - interval '30 days'
      end as since,
      case p_range
        when 'week' then 3.0
        when 'year' then 90.0
        when 'all' then null
        else 10.0
      end::double precision as half_life_days
  ),
  scored as (
    select
      d.id,
      d.owner_id,
      d.likes_count,
      d.created_at,
      sum(
        3.0
        * case
            when cfg.half_life_days is null then 1.0
            else power(0.5,
              greatest(extract(epoch from (now() - l.created_at)), 0) / 86400.0 / cfg.half_life_days)
          end
      ) as score,
      count(*)::integer as likes
    from public.deck_likes l
    join public.decks d on d.id = l.deck_id
    cross join cfg
    where l.created_at >= cfg.since
      and l.user_id <> d.owner_id
      and d.visibility = 'public'
      and d.card_count > 0
    group by d.id, d.owner_id, d.likes_count, d.created_at
  ),
  best_per_creator as (
    select s.*, row_number() over (
      partition by s.owner_id
      order by s.score desc, s.likes desc, s.likes_count desc, s.created_at desc, s.id
    ) as creator_rank
    from scored s
    where public.owner_is_creator(s.owner_id)
  )
  select b.id, b.score, b.likes
  from best_per_creator b
  where b.creator_rank = 1
  order by b.score desc, b.likes desc, b.likes_count desc, b.created_at desc, b.id
  limit least(greatest(coalesce(p_limit, 8), 1), 24);
$$;

revoke all on function public.list_trending_decks_by_range(text, integer) from public;
grant execute on function public.list_trending_decks_by_range(text, integer) to anon, authenticated, service_role;

-- 0166_trending_card_ranges.sql — "Hot this week / month / year / all time"
-- on the gallery (owner request 2026-11-03), and the card trending score
-- moved into ONE SQL function.
--
-- Before: the app scored trending in-process (lib/cards/queries.ts) over a
-- POOL — the 500 most recently UPDATED public cards (0091's
-- list_trending_pool) — with four PostgREST reads. What that got wrong:
--   * the pool was "recently edited", not "recently engaged with": an older
--     card nobody edited could not trend however many likes it got;
--   * the like / comment / remix reads were plain selects, cut at
--     PostgREST's max-rows (1000): past that, counts were silently short;
--   * a comment thread counted every message — two people talking under a
--     card outscored ten likes;
--   * every card created in the last 3 days got a flat +5 (a like is 3), so
--     brand-new cards with no engagement at all filled the row;
--   * no time decay inside the 7 days: a like six days ago weighed what a
--     like an hour ago did.
--
-- Now: list_trending_cards(range, limit) ranks public cards by their
-- engagement EVENTS in the range, each weighted by kind and decayed by its
-- age (exponential, a half-life per range):
--     score = Σ weight(kind) · 0.5 ^ (age_days / half_life)
--   * kinds and weights (unchanged from lib/cards/trending.ts): a like 3,
--     a commenter 2, a remixer 4;
--   * ONE event per person per card per kind: a like is one row per liker
--     (card_likes' unique key); a commenter counts once, at their LATEST
--     comment in the range; a remixer once, at their latest public or
--     unlisted remix in the range (a private remix is no public signal);
--   * the card owner's own like / comment / remix never counts;
--   * ranges: week = 7 days, half-life 3; month = 30 days, half-life 10;
--     year = 365 days, half-life 90; all = every event, no decay (the
--     all-time greats, by distinct engagement); any other value reads as
--     month, the gallery's default;
--   * only PUBLIC cards (private, unlisted, moderation-hidden and
--     strong-language-private cards never trend) of a real creator
--     (0149's owner_is_creator: no admin — 0091's showcase rule — and a
--     public card of their own);
--   * a card with no counted event in the range is not "hot": the row may
--     be short or empty, never padded with cold cards;
--   * at most ONE card per creator (their best), then the limit;
--   * ties: score, then distinct people engaged, then lifetime likes, then
--     newest, then id — deterministic.
-- The function returns the ranking and the range's counts (undecayed, what
-- the tiles print); the app reads the card rows by id.
--
-- SECURITY INVOKER: RLS stays in charge — the function only reads public
-- cards and the likes / comments / remixes anon may read on them, so the
-- answer is the same for every caller (the gallery's ISR read is anon).
-- list_trending_pool (0091) is left in place for the deployment that is
-- live while this migration lands; dropping it is a follow-up.
--
-- Grants: execute to anon, authenticated, service_role (0097's rule:
-- every migration states its grants).

create index if not exists card_likes_created_at_idx
  on public.card_likes (created_at);
create index if not exists card_comments_created_at_idx
  on public.card_comments (created_at);
create index if not exists cards_remix_created_at_idx
  on public.cards (created_at, parent_card_id)
  where parent_card_id is not null;

create or replace function public.list_trending_cards(
  p_range text default 'month',
  p_limit integer default 6
)
returns table (
  card_id uuid,
  score double precision,
  likes integer,
  comments integer,
  remixes integer
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
  events as (
    select l.card_id, 'like'::text as kind, l.user_id as actor, l.created_at as at
    from public.card_likes l, cfg
    where l.created_at >= cfg.since
    union all
    select cm.card_id, 'comment', cm.author_id, max(cm.created_at)
    from public.card_comments cm, cfg
    where cm.created_at >= cfg.since
    group by cm.card_id, cm.author_id
    union all
    select r.parent_card_id, 'remix', r.owner_id, max(r.created_at)
    from public.cards r, cfg
    where r.parent_card_id is not null
      and r.created_at >= cfg.since
      and r.visibility in ('public', 'unlisted')
    group by r.parent_card_id, r.owner_id
  ),
  scored as (
    select
      c.id,
      c.owner_id,
      c.likes_count,
      c.created_at,
      sum(
        case e.kind when 'like' then 3.0 when 'comment' then 2.0 else 4.0 end
        * case
            when cfg.half_life_days is null then 1.0
            else power(0.5,
              greatest(extract(epoch from (now() - e.at)), 0) / 86400.0 / cfg.half_life_days)
          end
      ) as score,
      count(*) filter (where e.kind = 'like')::integer as likes,
      count(*) filter (where e.kind = 'comment')::integer as comments,
      count(*) filter (where e.kind = 'remix')::integer as remixes,
      count(distinct e.actor)::integer as people
    from events e
    join public.cards c on c.id = e.card_id
    cross join cfg
    where c.visibility = 'public'
      and e.actor <> c.owner_id
    group by c.id, c.owner_id, c.likes_count, c.created_at
  ),
  best_per_creator as (
    select s.*, row_number() over (
      partition by s.owner_id
      order by s.score desc, s.people desc, s.likes_count desc, s.created_at desc, s.id
    ) as creator_rank
    from scored s
    where public.owner_is_creator(s.owner_id)
  )
  select b.id, b.score, b.likes, b.comments, b.remixes
  from best_per_creator b
  where b.creator_rank = 1
  order by b.score desc, b.people desc, b.likes_count desc, b.created_at desc, b.id
  limit least(greatest(coalesce(p_limit, 6), 1), 24);
$$;

revoke all on function public.list_trending_cards(text, integer) from public;
grant execute on function public.list_trending_cards(text, integer) to anon, authenticated, service_role;

-- 0168 — the card page's two numbers, made honest (TODO CP3 + CP4).
--
-- 1. Views (CP4). cards.view_count was bumped by increment_card_view (0042,
--    0103): anon-callable, once per CALL — every reload, every crawler and
--    link-unfurl bot, every server re-render after a like or a comment, and
--    anyone who called the RPC in a loop. It now grows the way deck views do
--    since 0151: card_views logs ONE row per (card, viewer, UTC day) and the
--    counter moves only for a new row. record_card_view is the service
--    role's alone (POST /api/cards/[id]/view → lib/cards/views.ts), which
--    leaves out crawlers (isbot), prefetches and an empty user agent before
--    it is called; the database leaves out the owner and any card a visitor
--    can't open. The viewer is the app's 32-hex HMAC, keyed here by a
--    SHA-256 of (card, viewer) under the DAY's random salt, which is dropped
--    once the day is over — no address, user id or cookie is stored.
--    increment_card_view is dropped. view_count keeps its lifetime total:
--    the views counted before this stay as they were.
--
-- 2. The "most-liked" rank (CP3). card_like_rank (0042 / 0043) was 1 + the
--    shareable cards with strictly more likes: ties shared a number in
--    silence (production 2026-11-03: 98 cards with one like each read "#23
--    most-liked card overall"), UNLISTED cards — link-only — were ranked,
--    and an owner's like of their own card counted. card_like_standing
--    ranks PUBLIC cards by the likes OTHER people gave them, and says whether
--    the place is shared; the page shows it only near the top
--    (lib/cards/like-standing.ts). No row for a card that isn't public or has
--    no like from anyone else. card_like_rank is dropped. likes_count (the
--    Like button's number) is unchanged.
--
-- Grants are explicit (0097): card_views / card_view_salts and
-- record_card_view are the service role's only; card_like_standing is public
-- information (anon, authenticated, service_role) and runs as the caller —
-- it reads only public cards and the likes table everyone can read.
--
-- Idempotent. Ships through a PR; never applied ad-hoc.

-- ===========================================================================
-- 1. The view log
-- ===========================================================================

create table if not exists public.card_views (
  card_id uuid not null references public.cards (id) on delete cascade,
  day date not null,
  viewer_key text not null check (viewer_key ~ '^[0-9a-f]{32}$'),
  primary key (card_id, day, viewer_key)
);

comment on table public.card_views is
  'One row per (card, viewer, UTC day) of a card page view (0168). viewer_key is a SHA-256 of (card, the app''s hashed viewer) under that day''s salt — no address, user id or cookie. Written by record_card_view (service role) only. Pruned past 400 days.';

create index if not exists card_views_day_idx on public.card_views (day);

alter table public.card_views enable row level security;

create table if not exists public.card_view_salts (
  day date primary key,
  salt bytea not null
);

comment on table public.card_view_salts is
  'Today''s random salt for card_views keys (0168). Older days'' salts are deleted, so an old key can''t be tied to anyone.';

alter table public.card_view_salts enable row level security;

create or replace function public.record_card_view(p_card_id uuid, p_viewer text, p_viewer_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_salt bytea;
  v_key text;
begin
  if p_viewer is null or p_viewer !~ '^[0-9a-f]{32}$' then
    raise exception 'record_card_view: the viewer must be 32 hex digits';
  end if;

  -- A card a visitor can open, and never its owner's own view.
  if not exists (
    select 1 from public.cards c
    where c.id = p_card_id
      and c.visibility in ('public', 'unlisted')
      and c.owner_id is distinct from p_viewer_id
  ) then
    return false;
  end if;

  -- The day's salt: made by the day's first view (32 random bytes from two
  -- v4 uuids, as 0151), every older one dropped.
  insert into public.card_view_salts (day, salt)
  values (v_day, decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'))
  on conflict (day) do nothing;
  delete from public.card_view_salts s where s.day < v_day;
  select s.salt into v_salt from public.card_view_salts s where s.day = v_day;

  v_key := left(encode(
    sha256(v_salt || convert_to(p_card_id::text || ':' || p_viewer, 'UTF8')),
    'hex'), 32);

  insert into public.card_views (card_id, day, viewer_key)
  values (p_card_id, v_day, v_key)
  on conflict do nothing;
  if not found then
    return false; -- this viewer's view of this card today is counted already
  end if;

  -- A trusted path (0143's guard keeps the counter from the API roles).
  update public.cards set view_count = view_count + 1 where id = p_card_id;
  return true;
end;
$$;

comment on function public.record_card_view(uuid, text, uuid) is
  'Count one view of a public / unlisted card: one per (card, viewer, UTC day), never the owner''s (0168). p_viewer = the app''s 32-hex HMAC of the viewer. Service role only.';

drop function if exists public.increment_card_view(uuid);

comment on column public.cards.view_count is
  'Lifetime card page views: one per viewer and UTC day since 0168 (record_card_view, never the owner, a crawler or a prefetch); before 0168 every non-owner render. Server-owned (0143''s guard).';

-- ===========================================================================
-- 2. The like standing
-- ===========================================================================

create or replace function public.card_like_standing(p_card_id uuid)
returns table (rank integer, tied boolean, likes integer)
language sql
stable
set search_path = ''
as $$
  -- Likes from anyone but the card's owner: likes_count less the owner's
  -- own like (card_likes is unique per user and card).
  with me as (
    select c.id,
           c.likes_count - (exists (
             select 1 from public.card_likes l
             where l.card_id = c.id and l.user_id = c.owner_id
           ))::integer as likes
    from public.cards c
    where c.id = p_card_id and c.visibility = 'public'
  ),
  -- Only a card with as many likes or more can stand above or beside it
  -- (an owner's like only ever lowers a rival's count).
  rivals as (
    select c.likes_count - (exists (
             select 1 from public.card_likes l
             where l.card_id = c.id and l.user_id = c.owner_id
           ))::integer as likes
    from public.cards c
    cross join me
    where c.visibility = 'public'
      and c.id <> me.id
      and c.likes_count >= me.likes
  )
  select (1 + count(r.likes) filter (where r.likes > me.likes))::integer as rank,
         count(r.likes) filter (where r.likes = me.likes) > 0 as tied,
         me.likes
  from me
  left join rivals r on true
  where me.likes > 0
  group by me.likes;
$$;

comment on function public.card_like_standing(uuid) is
  'A public card''s place among public cards by the likes other people gave it (0168): rank = 1 + the cards with more, tied = another card has as many, likes = its own (the owner''s like left out). No row for a card that isn''t public or has no such like.';

drop function if exists public.card_like_rank(uuid);

-- ===========================================================================
-- Grants
-- ===========================================================================

revoke all on function public.record_card_view(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.record_card_view(uuid, text, uuid) to service_role;

revoke all on function public.card_like_standing(uuid) from public;
grant execute on function public.card_like_standing(uuid) to anon, authenticated, service_role;

revoke all on table public.card_views from public, anon, authenticated;
grant select, insert, update, delete on table public.card_views to service_role;

revoke all on table public.card_view_salts from public, anon, authenticated;
grant select, insert, update, delete on table public.card_view_salts to service_role;

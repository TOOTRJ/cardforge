-- 0150_deck_privacy_and_views.sql — what the API hands out about a deck
-- matches what its page shows (2026-10-28 deck plan: TODO DK0.11), private
-- cards out of the old AI guides, and a deck view log (DK0.11 + DK7.4's
-- groundwork).
--
-- 1. AN UNLISTED DECK IS LINK-ONLY. 0055's read rule ("public or unlisted,
--    or yours") let anyone LIST every unlisted deck through PostgREST
--    (`GET /decks?visibility=eq.unlisted`), and with it its entries (0055),
--    its likes (0102), its guide (0085) and every deck_id a feedback row may
--    name. A policy can't see a request's filters, so it can't tell "the
--    deck at /deck/<slug>" from "every unlisted deck" — unless the request
--    NAMES the deck. requested_deck_link() reads the `x-pipglyph-deck`
--    request header (PostgREST hands every request's headers to the
--    database as `request.headers`) and the decks policy admits an unlisted
--    deck only when that header holds its slug or its id: a read names at
--    most one unlisted deck, by the link a visitor already has, and a list
--    without the header holds none. Public decks and the owner's own read
--    as before. The id is a link too: it is a random uuid, printed only on
--    the deck's own page (and to its owner), and nothing listable carries it
--    once this rule holds.
--      The deck's other tables follow the deck: their policies ask
--    `exists (select 1 from decks d where d.id = deck_id)`, and a policy's
--    subquery reads decks under the CALLER's rules, so the one rule above
--    decides them all — deck_cards and deck_likes reads (redefined below
--    in that shape), and the inserts that already have it (0055's like,
--    0146's feedback). An entry, a like or a feedback row of an unlisted
--    deck is then read or written only by a request that names the deck:
--    the app sends the header from the deck page, its share image, the like
--    and the feedback (lib/decks/deck-link.ts). A private deck is never
--    admitted by the header. The cards' twin (an unlisted card is listable
--    the same way) is a follow-up; cards are untouched here.
--
-- 2. A DECK GUIDE IS READ WHERE THE PAGE SHOWS IT (D4). The page shows a
--    guide's TEXT to a Pro viewer of a deck they can open, and to everyone
--    else who can open it only that one exists (the upgrade teaser); 0085
--    handed the text of every public and unlisted deck's guide to anyone,
--    anonymous included. deck_guides is now read by ONE function,
--    deck_guide_for_viewer(deck): nothing for a deck the caller can't open
--    (public, unlisted — the id is its link — or their own) or with no
--    guide; else one row, `readable` = whether the caller is Pro
--    (viewer_is_pro(): an admin, or an active / trialing Pro subscription,
--    or an unexpired Pro comp — lib/billing/entitlements.ts's
--    effectiveTierForProfile, which a unit test holds it to), and the text
--    only when it is. The table itself is no API role's any more (the
--    select policy goes, the grants are revoked): writes were the service
--    role's already, and a direct read would skip section 3.
--
-- 3. PRIVATE CARDS OUT OF OLD GUIDES (D11 meets D4). A guide was written
--    from the OWNER's view of the deck (lib/decks/guides.ts: each card's
--    title), so its text can name a card that has gone private since — and
--    private cards in public decks are normal now (D11). Deck AI is paused:
--    no guide is written any more, and the stored text is never rewritten.
--    For anyone but the deck's owner the function redacts at READ time:
--    every card of the deck the visitor's list hides (the deck read's rule,
--    listDeckCards: a card is shown when it is public, or the deck owner's
--    and unlisted) loses its names — its title, its entry's own copy of a
--    name when no printing stands behind the entry, and the short form
--    before a comma ("Vael, Gloomforge Tinker" → "Vael") — each replaced by
--    what the visitor's list shows for it: the printing's REAL name when the
--    entry stands for one, else "Private card" (lib/decks/private-card-name
--    .ts PRIVATE_CARD_NAME). Whole words only (a plural keeps its ending),
--    any case, longest name first; a name the visitor's list shows anyway
--    (another entry's) is left alone. Every string of the guide is read,
--    the lists included. What it can't catch: a name the guide spelled
--    otherwise (a nickname, a title the card had before a rename the entry
--    never saw), or a card no longer in the deck.
--    Hiding the whole guide while the deck holds a private card was the
--    other option: it can't miss a name, but it takes D4's guides away from
--    every deck with one private card (D11 makes that common); the
--    redaction keeps them and draws exactly the names the deck's list draws.
--
-- 4. VIEWS: ONE PER VIEWER, DECK AND DAY, BOTS LEFT OUT. The page bumped
--    view_count on every non-owner render (0103's increment_deck_view,
--    callable by anyone, any number of times). Now deck_views logs ONE row
--    per (deck, viewer, UTC day) and view_count grows only when a row is
--    new — the counter stays the server's (0143's guard). record_deck_view
--    (deck, viewer, viewer's user id) is the service role's alone: the page
--    calls it after the response (lib/decks/views.ts), never for a bot
--    (isbot), a prefetch or the owner, so no API caller can feed it keys.
--    Privacy: no address, no user id, no cookie is stored. The app sends a
--    32-hex HMAC of the signed-in user's id, or of the visitor's network
--    and user agent, under the server's secret (0125's rule); the database
--    keys the row by a SHA-256 of (deck, that value) salted with 32 random
--    bytes of the DAY (deck_view_salts) and drops every older salt — once
--    the day is over, nobody (the database's owner included) can tie a row
--    to a person, and two decks' rows of one visitor never match. Core
--    functions only (sha256, gen_random_uuid): no extension. Retention: the
--    weekly prune cron drops rows past 400 days (and any stale salt).
--    increment_deck_view goes: nothing may bump the counter around the log.
--
-- 5. THE OWNER'S VIEWS PER DAY (DK7.4 groundwork, the charts are another
--    PR). deck_views_by_day(deck, days) — the deck's OWNER only (anyone
--    else gets no rows): every day of the last `days` (1–400, default 30),
--    oldest first, with its count of viewers, zeros included. view_count
--    stays the lifetime total (it counts the views before this log).
--
-- Grants: requested_deck_link() is every role's (the decks policy calls it
-- for anon too). deck_guide_for_viewer() is anon's and authenticated's;
-- deck_views_by_day() authenticated's; record_deck_view(), viewer_is_pro()
-- and the redaction helpers the service role's only (the definer calls them
-- as their owner). deck_guides, deck_views and deck_view_salts: no API role;
-- the service role reads and writes them.
--
-- Deploy: Supabase applies this as Vercel builds. Until the new deployment
-- is live, the old one's unlisted-deck pages are a 404 for visitors (it sends
-- no header), its guides read nothing (the table is revoked) and its view
-- bumps fail quietly (the function is gone) — minutes, nothing stored
-- changes. The new code on a database without this migration reads as
-- before (lib/decks/guides.ts falls back to the table; the header is
-- ignored; a view isn't logged).
--
-- Ships through a PR; never applied ad-hoc. Idempotent.

-- ===========================================================================
-- 1. Unlisted decks: by their link, never in a list
-- ===========================================================================

create or replace function public.requested_deck_link()
returns text
language sql
stable
set search_path = ''
as $$
  -- PostgREST's request headers (lower-case names); NULL outside a request.
  select nullif(btrim(
    (nullif(current_setting('request.headers', true), '')::json) ->> 'x-pipglyph-deck'
  ), '');
$$;

comment on function public.requested_deck_link() is
  'The deck a request names in its x-pipglyph-deck header (a slug or an id), or NULL. The decks policy admits an unlisted deck only by it (0150).';

drop policy if exists "Decks: public + unlisted readable, private by owner" on public.decks;
drop policy if exists "Decks: public, the owner's, and an unlisted one by its link" on public.decks;
create policy "Decks: public, the owner's, and an unlisted one by its link"
  on public.decks
  for select
  using (
    visibility = 'public'
    or auth.uid() = owner_id
    or (
      visibility = 'unlisted'
      and (select public.requested_deck_link()) in (slug, id::text)
    )
  );

-- The entries and likes follow the deck: the subquery reads decks under the
-- caller's own rules (above).
drop policy if exists "Deck cards: visible when parent deck is readable" on public.deck_cards;
create policy "Deck cards: visible when parent deck is readable"
  on public.deck_cards
  for select
  using (
    exists (select 1 from public.decks d where d.id = deck_id)
  );

drop policy if exists "Deck likes are readable when their deck is visible" on public.deck_likes;
create policy "Deck likes are readable when their deck is visible"
  on public.deck_likes
  for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.decks d where d.id = deck_id)
  );

-- ===========================================================================
-- 2 + 3. Deck guides: one read, where the page shows them, redacted
-- ===========================================================================

-- The page's "Pro viewer" (lib/billing/entitlements.ts: getEntitlements —
-- an admin is unlocked — and effectiveTierForProfile: a paid tier counts
-- while active or trialing, an unexpired comp counts, the higher wins).
create or replace function public.viewer_is_pro()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.is_admin
        or (p.subscription_tier = 'pro' and p.subscription_status in ('active', 'trialing'))
        or (p.comp_tier = 'pro' and (p.comp_expires_at is null or p.comp_expires_at > now()))
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;

comment on function public.viewer_is_pro() is
  'Whether the caller gets Pro perks: an admin, an active / trialing Pro subscription or an unexpired Pro comp. Mirrors lib/billing/entitlements.ts effectiveTierForProfile (0150).';

-- Every whole-word, any-case occurrence of p_names[i] becomes p_subs[i], in
-- array order (the caller sorts the longest name first). A plural keeps its
-- ending ("two Ember Signets" → "two Sol Rings").
create or replace function public.redact_guide_text(p_text text, p_names text[], p_subs text[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text := p_text;
  i integer;
begin
  if v_out is null or p_names is null then
    return v_out;
  end if;
  for i in 1 .. coalesce(array_length(p_names, 1), 0) loop
    v_out := regexp_replace(
      v_out,
      -- The name as literal text (every character but a letter, a digit or
      -- a space escaped), an optional plural ending, and no letter, digit
      -- or underscore either side.
      '(?<![[:alnum:]_])'
        || regexp_replace(p_names[i], '([^[:alnum:][:space:]])', '\\\1', 'g')
        || '((?:e?s)?)(?![[:alnum:]_])',
      replace(p_subs[i], '\', '\\') || '\1',
      'gi'
    );
  end loop;
  return v_out;
end;
$$;

-- The same through every string of a guide's jsonb (game plan steps, the
-- combos' cards and descriptions, key cards), whatever its shape.
create or replace function public.redact_guide_jsonb(p_value jsonb, p_names text[], p_subs text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_names is null then
    return p_value;
  end if;
  case jsonb_typeof(p_value)
    when 'string' then
      return to_jsonb(public.redact_guide_text(p_value #>> '{}', p_names, p_subs));
    when 'array' then
      return coalesce(
        (select jsonb_agg(public.redact_guide_jsonb(t.value, p_names, p_subs) order by t.ordinality)
           from jsonb_array_elements(p_value) with ordinality as t(value, ordinality)),
        '[]'::jsonb
      );
    when 'object' then
      return coalesce(
        (select jsonb_object_agg(t.key, public.redact_guide_jsonb(t.value, p_names, p_subs))
           from jsonb_each(p_value) as t(key, value)),
        '{}'::jsonb
      );
    else
      return p_value;
  end case;
end;
$$;

create or replace function public.deck_guide_for_viewer(p_deck_id uuid)
returns table (
  deck_id uuid,
  readable boolean,
  overview text,
  game_plan jsonb,
  mulligan text,
  combos jsonb,
  weaknesses text,
  key_cards jsonb,
  source text,
  generated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with deck as (
    -- A deck the caller can open: public, unlisted (its id is its link) or
    -- their own. A private deck of someone else's has no guide for them.
    select d.id, d.owner_id, coalesce(d.owner_id = auth.uid(), false) as is_owner
    from public.decks d
    where d.id = p_deck_id
      and (d.visibility in ('public', 'unlisted') or d.owner_id = auth.uid())
  ),
  viewer as (
    select public.viewer_is_pro() as pro
  ),
  -- A visitor's view of the deck's entries (none for the owner): which
  -- linked cards their list hides — the deck read's rule (listDeckCards,
  -- canLinkIntoDeck + the cards' RLS): shown when public, or the deck
  -- owner's and unlisted.
  entries as (
    select btrim(e.name) as entry_name,
           e.scryfall_id is not null as printed,
           btrim(c.title) as card_title,
           c.id is not null
             and not (c.visibility = 'public'
                      or (c.visibility = 'unlisted' and c.owner_id = deck.owner_id)) as hidden
    from deck
    join public.deck_cards e on e.deck_id = deck.id
    left join public.cards c on c.id = e.card_id
    where not deck.is_owner
  ),
  -- Every name the visitor's list draws (lib/decks/private-card-name.ts:
  -- an entry's own name unless it is a hidden card's with no printing).
  shown as (
    select lower(entry_name) as name from entries where not (hidden and not printed)
    union
    select lower(card_title) from entries where card_title is not null and not hidden
  ),
  -- A hidden card's names, and what the list shows in their place.
  hidden_names as (
    select n.name,
           case when entries.printed then entries.entry_name else 'Private card' end as sub
    from entries
    cross join lateral (
      values (entries.card_title),
             (case when not entries.printed then entries.entry_name end)
    ) as n(name)
    where entries.hidden and n.name is not null and char_length(n.name) >= 2
  ),
  with_short as (
    select name, sub from hidden_names
    union
    -- The short form before a comma (lib/cards/card-names.ts shortNameOf),
    -- never under 3 characters.
    select btrim(split_part(name, ',', 1)), sub
    from hidden_names
    where position(',' in name) > 1
      and char_length(btrim(split_part(name, ',', 1))) >= 3
  ),
  scrub as (
    select array_agg(w.name order by char_length(w.name) desc, w.name) as names,
           array_agg(w.sub order by char_length(w.name) desc, w.name) as subs
    from (
      select distinct on (lower(ws.name)) ws.name, ws.sub
      from with_short ws
      where lower(ws.name) <> lower(ws.sub)
        and not exists (select 1 from shown s where s.name = lower(ws.name))
      order by lower(ws.name), ws.sub
    ) w
  )
  select
    g.deck_id,
    viewer.pro,
    case when not viewer.pro then null
         when deck.is_owner then g.overview
         else public.redact_guide_text(g.overview, scrub.names, scrub.subs) end,
    case when not viewer.pro then null
         when deck.is_owner then g.game_plan
         else public.redact_guide_jsonb(g.game_plan, scrub.names, scrub.subs) end,
    case when not viewer.pro then null
         when deck.is_owner then g.mulligan
         else public.redact_guide_text(g.mulligan, scrub.names, scrub.subs) end,
    case when not viewer.pro then null
         when deck.is_owner then g.combos
         else public.redact_guide_jsonb(g.combos, scrub.names, scrub.subs) end,
    case when not viewer.pro then null
         when deck.is_owner then g.weaknesses
         else public.redact_guide_text(g.weaknesses, scrub.names, scrub.subs) end,
    case when not viewer.pro then null
         when deck.is_owner then g.key_cards
         else public.redact_guide_jsonb(g.key_cards, scrub.names, scrub.subs) end,
    case when viewer.pro then g.source end,
    case when viewer.pro then g.generated_at end
  from deck
  join public.deck_guides g on g.deck_id = deck.id
  cross join viewer
  cross join scrub;
$$;

comment on function public.deck_guide_for_viewer(uuid) is
  'The deck''s AI guide as its page shows it to the caller (0150): no row when they can''t open the deck or it has none; readable = Pro; the text only for Pro, with the deck''s hidden cards'' names redacted for anyone but the owner.';

drop policy if exists "Deck guides follow their deck's visibility" on public.deck_guides;

-- ===========================================================================
-- 4. The view log
-- ===========================================================================

create table if not exists public.deck_views (
  deck_id uuid not null references public.decks (id) on delete cascade,
  day date not null,
  viewer_key text not null check (viewer_key ~ '^[0-9a-f]{32}$'),
  primary key (deck_id, day, viewer_key)
);

comment on table public.deck_views is
  'One row per (deck, viewer, UTC day) of a deck page view (0150). viewer_key is a SHA-256 of (deck, the app''s hashed viewer) under that day''s salt — no address, user id or cookie. Written by record_deck_view (service role) only; read by deck_views_by_day (the owner). Pruned past 400 days.';

create index if not exists deck_views_day_idx on public.deck_views (day);

alter table public.deck_views enable row level security;

create table if not exists public.deck_view_salts (
  day date primary key,
  salt bytea not null
);

comment on table public.deck_view_salts is
  'Today''s random salt for deck_views keys (0150). Older days'' salts are deleted, so an old key can''t be tied to anyone.';

alter table public.deck_view_salts enable row level security;

create or replace function public.record_deck_view(p_deck_id uuid, p_viewer text, p_viewer_id uuid default null)
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
    raise exception 'record_deck_view: the viewer must be 32 hex digits';
  end if;

  -- A deck a visitor can open, and never its owner's own view.
  if not exists (
    select 1 from public.decks d
    where d.id = p_deck_id
      and d.visibility in ('public', 'unlisted')
      and d.owner_id is distinct from p_viewer_id
  ) then
    return false;
  end if;

  -- The day's salt: made by the day's first view (32 random bytes from two
  -- v4 uuids — the core's strong random source, no extension needed), every
  -- older one dropped.
  insert into public.deck_view_salts (day, salt)
  values (v_day, decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'))
  on conflict (day) do nothing;
  delete from public.deck_view_salts s where s.day < v_day;
  select s.salt into v_salt from public.deck_view_salts s where s.day = v_day;

  -- A salted SHA-256 of (deck, viewer): the core's sha256(), no extension.
  v_key := left(encode(
    sha256(v_salt || convert_to(p_deck_id::text || ':' || p_viewer, 'UTF8')),
    'hex'), 32);

  insert into public.deck_views (deck_id, day, viewer_key)
  values (p_deck_id, v_day, v_key)
  on conflict do nothing;
  if not found then
    return false; -- this viewer's view of this deck today is counted already
  end if;

  -- A trusted path (0143's guard keeps the counter from the API roles).
  update public.decks set view_count = view_count + 1 where id = p_deck_id;
  return true;
end;
$$;

comment on function public.record_deck_view(uuid, text, uuid) is
  'Count one view of a public / unlisted deck: one per (deck, viewer, UTC day), never the owner''s (0150). p_viewer = the app''s 32-hex HMAC of the viewer. Service role only.';

drop function if exists public.increment_deck_view(uuid);

comment on column public.decks.view_count is
  'Lifetime detail-page views: one per viewer and UTC day since 0150 (record_deck_view, never the owner, a crawler or a prefetch); before 0150 every non-owner render. Server-owned (0143''s guard).';

-- ===========================================================================
-- 5. The owner's views per day
-- ===========================================================================

create or replace function public.deck_views_by_day(p_deck_id uuid, p_days integer default 30)
returns table (day date, views integer)
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
  select s.day, count(v.viewer_key)::integer as views
  from deck
  cross join span s
  left join public.deck_views v on v.deck_id = deck.id and v.day = s.day
  group by s.day
  order by s.day;
$$;

comment on function public.deck_views_by_day(uuid, integer) is
  'The caller''s OWN deck''s viewers per UTC day for the last p_days (1–400), zeros included, oldest first; no rows for anyone else''s deck (0150).';

-- ===========================================================================
-- Grants
-- ===========================================================================

revoke all on function public.requested_deck_link() from public;
grant execute on function public.requested_deck_link() to anon, authenticated, service_role;

revoke all on function public.viewer_is_pro() from public, anon, authenticated;
grant execute on function public.viewer_is_pro() to service_role;

revoke all on function public.redact_guide_text(text, text[], text[]) from public, anon, authenticated;
grant execute on function public.redact_guide_text(text, text[], text[]) to service_role;
revoke all on function public.redact_guide_jsonb(jsonb, text[], text[]) from public, anon, authenticated;
grant execute on function public.redact_guide_jsonb(jsonb, text[], text[]) to service_role;

revoke all on function public.deck_guide_for_viewer(uuid) from public;
grant execute on function public.deck_guide_for_viewer(uuid) to anon, authenticated, service_role;

revoke all on function public.record_deck_view(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.record_deck_view(uuid, text, uuid) to service_role;

revoke all on function public.deck_views_by_day(uuid, integer) from public, anon;
grant execute on function public.deck_views_by_day(uuid, integer) to authenticated, service_role;

-- deck_guides: no API role (read through deck_guide_for_viewer, written by
-- the service role).
revoke all on table public.deck_guides from anon, authenticated;
grant select, insert, update, delete on table public.deck_guides to service_role;

revoke all on table public.deck_views from public, anon, authenticated;
grant select, insert, update, delete on table public.deck_views to service_role;

revoke all on table public.deck_view_salts from public, anon, authenticated;
grant select, insert, update, delete on table public.deck_view_salts to service_role;

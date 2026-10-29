-- 0151_deck_cover_picks.sql — what a deck's cover shows: the owner's
-- featured cards, and the built-in background they pick (2026-10-28 deck
-- plan: TODO DK6.4, and the shuffle DK6.2 left for a migration; owner
-- decision D12).
--
-- 1. FEATURED CARDS (DK6.4). deck_cards.featured_rank — the owner's "Feature
--    on cover" picks, 1–5 in the order the hero fans them; NULL = not
--    picked. One entry per rank and deck (a partial unique index), so five
--    at most (the CHECK holds the ranks to 1–5). The fan reads them
--    (lib/decks/featured.ts featuredCardsOf): the commanders, then these
--    picks by rank, then the seeded fill (#656's rule) — on the deck page,
--    the tiles (listDeckTileArt) and the share image alike.
--    A rank is the owner's presentation of their own entries, so it is
--    written under the entries' existing rules: 0144's UPDATE policy (the
--    deck's owner, nobody else) and 0143's entry triggers (a change touches
--    the deck's updated_at — the share image's cache-buster). No guard on
--    WHICH entry: what a pick may SHOW is the read side's — a private card,
--    or another creator's card that isn't public, never stands in a fan for
--    any viewer (D11, D3), picked or not; its rank stays, and counts again
--    if the card comes back.
--    set_deck_featured_entries(deck, entry ids) replaces a deck's picks in
--    ONE transaction: under the deck's entry lock (0143), its ownership
--    checked, at most five distinct entries of THAT deck, ranked in the
--    array's order ('{}' clears them). The ranks that change are cleared
--    first and set second: a non-deferrable unique index is checked row by
--    row, so a reorder written in one statement (1 ↔ 2) would meet it half
--    done. SECURITY INVOKER: RLS applies to both updates.
--    The column is new, so the index is built over no rank at all.
--
-- 2. THE BUILT-IN BACKGROUNDS (DK6.2's shuffle, D12). Since 0127 a deck's
--    cover_url holds the owner's own storage objects only
--    (media_url_allowed('deck-cover', …)); a deck without an upload shows
--    the default its colours pick at render time (lib/decks/cover.ts
--    deckCoverOf), and nothing is stored. An owner who shuffles, or picks
--    another of the sixteen, STORES that one. media_url_allowed gains ONE
--    branch: kind 'deck-cover' also accepts exactly the sixteen
--    site-relative paths public/defaults/deck-covers holds,
--      /defaults/deck-covers/<white|blue|black|red|green|multicolor|
--                             colorless|neutral>-<1|2>.webp
--    anchored at both ends — no host (never a wildcard one), no query, no
--    other folder or name, no traversal: the shape of 0127's avatar and
--    banner rule for the profile defaults. The app's twin is
--    isDefaultDeckCover (lib/decks/default-covers.ts); a unit test holds the
--    two to the same sixteen. Every other line of the function is 0127's,
--    word for word, and the guard trigger (guard_deck_media_columns) is
--    unchanged: it calls the function (its refusal still reads "one of
--    your own uploads"; no one sees it — the save actions show their own
--    words, lib/media/media-url-errors.ts). Existing rows are untouched.
--
-- Grants: the new column rides deck_cards' table grants (0097). The RPC is
-- for signed-in users (and the service role, which it refuses: no
-- auth.uid() owns a deck): EXECUTE revoked from PUBLIC and anon, granted to
-- authenticated and service_role. media_url_allowed keeps its signature
-- (`create or replace` keeps its ACL); its grants are restated, 0127's.
--
-- Backward compatible with the code before it: nothing old reads or writes
-- the column, and the widened cover rule only lets more through.
--
-- Ships through a PR; never applied ad-hoc. Idempotent.

-- ===========================================================================
-- 1. Featured cards
-- ===========================================================================

alter table public.deck_cards
  add column if not exists featured_rank smallint;

comment on column public.deck_cards.featured_rank is
  'The owner''s "Feature on cover" pick (TODO DK6.4): 1–5, the order the deck''s card fan shows it after the commanders; NULL = not picked. One entry per rank and deck. Written by set_deck_featured_entries (0151) or the owner''s own UPDATE.';

alter table public.deck_cards drop constraint if exists deck_cards_featured_rank_range;
alter table public.deck_cards
  add constraint deck_cards_featured_rank_range
  check (featured_rank is null or featured_rank between 1 and 5);

create unique index if not exists deck_cards_featured_rank_key
  on public.deck_cards (deck_id, featured_rank)
  where featured_rank is not null;

-- The deck's picks, replaced: `p_entry_ids` in rank order (rank 1 first),
-- every one an entry of the deck, at most five, no repeats. Returns how
-- many are picked.
create or replace function public.set_deck_featured_entries(p_deck_id uuid, p_entry_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_entry_ids is null or array_position(p_entry_ids, null) is not null then
    raise exception 'deck_featured_invalid: pass the picked entries'' ids, rank 1 first'
      using errcode = 'invalid_parameter_value';
  end if;
  v_count := cardinality(p_entry_ids);
  if v_count > 5 then
    raise exception 'deck_featured_limit: a deck''s cover features at most 5 cards'
      using errcode = 'check_violation';
  end if;
  if (select count(distinct x.id) from unnest(p_entry_ids) as x(id)) <> v_count then
    raise exception 'deck_featured_invalid: an entry is picked twice'
      using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('deck_entries:' || p_deck_id::text, 0));

  if not exists (
    select 1 from public.decks d
    where d.id = p_deck_id and d.owner_id = (select auth.uid())
  ) then
    raise exception 'deck_not_owned: deck not found or not yours'
      using errcode = 'insufficient_privilege';
  end if;

  if (
    select count(*) from public.deck_cards dc
    where dc.deck_id = p_deck_id and dc.id = any (p_entry_ids)
  ) <> v_count then
    raise exception 'deck_featured_invalid: every pick must be an entry of this deck'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Clear every rank that changes (an entry no longer picked, or picked at
  -- another rank)…
  update public.deck_cards dc
  set featured_rank = null
  where dc.deck_id = p_deck_id
    and dc.featured_rank is not null
    and not exists (
      select 1
      from unnest(p_entry_ids) with ordinality as pick(entry_id, rank)
      where pick.entry_id = dc.id and pick.rank = dc.featured_rank
    );

  -- …then set the new ones: no rank they take is held any more.
  update public.deck_cards dc
  set featured_rank = pick.rank::smallint
  from unnest(p_entry_ids) with ordinality as pick(entry_id, rank)
  where dc.deck_id = p_deck_id
    and dc.id = pick.entry_id
    and dc.featured_rank is distinct from pick.rank::smallint;

  return v_count;
end;
$$;

revoke all on function public.set_deck_featured_entries(uuid, uuid[]) from public, anon;
grant execute on function public.set_deck_featured_entries(uuid, uuid[]) to authenticated, service_role;

-- ===========================================================================
-- 2. The built-in backgrounds: 0127's media_url_allowed, plus ONE branch
-- ===========================================================================

-- True when `p_url` may be stored in a column of this kind by `p_owner`: a
-- public object URL on one of our storage origins, in a bucket of this kind,
-- directly inside `p_owner`'s folder, under a plain file name (optionally
-- `?v=<digits>`, the pip's cache-buster) — or a built-in profile image, a
-- built-in deck background (0151), or a Scryfall printing image for a deck
-- entry. Mirrors lib/media/media-urls.ts.
create or replace function public.media_url_allowed(p_kind text, p_url text, p_owner uuid)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_buckets text[];
  v_parts text[];
begin
  if p_url is null then
    return false;
  end if;
  if p_kind = 'avatar' and p_url ~ '^/defaults/avatars/avatar-(0[1-9]|1[0-9]|2[0-5])\.webp$' then
    return true;
  end if;
  if p_kind = 'banner' and p_url ~ '^/defaults/banners/banner-(0[1-9]|1[0-9]|2[0-5])\.webp$' then
    return true;
  end if;
  -- The sixteen built-in deck backgrounds (0151, public/defaults/deck-covers):
  -- a default the owner shuffled to or picked.
  if p_kind = 'deck-cover'
     and p_url ~ '^/defaults/deck-covers/(white|blue|black|red|green|multicolor|colorless|neutral)-[12]\.webp$' then
    return true;
  end if;
  -- PipGlyph's own built-in images (public/defaults) as card art — what the
  -- dev / preview seed cards use (supabase/seeds/10_dev_data.sql), so a
  -- remix of one saves.
  if p_kind = 'card-art'
     and p_url ~ '^(https://(www\.)?pipglyph\.com)?/defaults/(avatars/avatar|banners/banner)-(0[1-9]|1[0-9]|2[0-5])\.webp$' then
    return true;
  end if;
  if p_kind = 'deck-card-image' then
    return p_url ~ '^https://cards\.scryfall\.io/[A-Za-z0-9_./-]+(\?[0-9]{1,20})?$'
       and position('..' in p_url) = 0;
  end if;
  v_buckets := case p_kind
    when 'card-art' then array['card-art']
    when 'watermark' then array['card-art']
    when 'set-icon' then array['set-covers', 'card-art']
    when 'deck-cover' then array['set-covers', 'card-art']
    when 'avatar' then array['profile-media']
    when 'banner' then array['profile-media']
    when 'pip' then array['custom-pips']
  end;
  if v_buckets is null or p_owner is null then
    return false;
  end if;
  v_parts := regexp_match(
    p_url,
    '^(https?://[a-z0-9.-]+(?::[0-9]{1,5})?)/storage/v1/object/public/([a-z-]+)/([0-9a-f-]{36})/([A-Za-z0-9][A-Za-z0-9._-]{0,199})(?:\?v=[0-9]{1,20})?$'
  );
  if v_parts is null then
    return false;
  end if;
  return v_parts[2] = any (v_buckets)
     and v_parts[3] = p_owner::text
     and position('..' in v_parts[4]) = 0
     and exists (
       select 1
       from public.storage_origins as o
       where o.origin = v_parts[1]
     );
end;
$$;

revoke all on function public.media_url_allowed(text, text, uuid) from public;
grant execute on function public.media_url_allowed(text, text, uuid)
  to anon, authenticated, service_role;

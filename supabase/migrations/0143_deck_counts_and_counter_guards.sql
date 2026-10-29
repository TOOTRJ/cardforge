-- 0143_deck_counts_and_counter_guards.sql — the deck data layer, hardened
-- (2026-10-28 deck audit: TODO DK0.1, DK0.2, DK0.3, DK0.8).
--
-- 1. STORED COUNTS on decks (DK0.1). Every deck tile (/decks, browse, the
--    format hubs, profiles, My Decks) read ALL the deck_cards rows of every
--    listed deck in one request to sum them, and PostgREST caps a response
--    at 1000 rows (config.toml max_rows): 24 Commander decks are ~2,000
--    rows, so the decks past the cap showed 0 or a partial "N cards". Two
--    columns now hold the sums, kept by the database:
--      card_count         physical cards — quantities summed, the
--                         maybeboard left out (the app's `cards_count`);
--      linked_card_count  the same, entries with a card_id only (the app's
--                         `remixed_count`).
--    ONE trigger function, sync_deck_from_entries(), runs once per STATEMENT
--    on deck_cards (insert / update / delete, through transition tables): it
--    locks each touched deck row, RECOUNTS its two sums and touches
--    updated_at. It replaces 0103's touch_deck_from_entry(), which updated
--    the parent deck once per ROW (a 400-line import = 400 deck updates).
--    Recounting (never adding a delta) makes the columns self-correcting; the
--    row lock taken before the recount makes two writers on one deck count
--    each other's rows (a READ COMMITTED UPDATE re-checks its target row but
--    not an aggregate it joined). Backfilled below from the rows that exist.
--    Hub counts agree (DK0.8): public_deck_format_counts() counts decks with
--    card_count > 0 — the same "non-empty" the lists, the sitemap and the
--    deck page's robots use from now on.
--
-- 2. COUNTERS ARE THE SERVER'S (DK0.2). The decks UPDATE policy (0055) and
--    the table grants (0097) let an owner PATCH likes_count, view_count,
--    created_at and updated_at through PostgREST — the popular, viewed and
--    recent sorts were one request from gamed; an INSERT could start a deck
--    at 99,999 likes. Same shape on cards (likes_count, view_count,
--    share_count, created_at). Two guards in 0126's style
--    (`current_user in ('anon', 'authenticated')` = an API role; anything
--    else is a TRUSTED path: the SECURITY DEFINER counter functions —
--    increment_deck_view, increment_card_view, increment_card_share,
--    sync_deck_likes_count, sync_card_likes_count, sync_deck_from_entries —
--    foreign-key actions, the service role, migrations and seeds):
--      * an API role's INSERT starts the counters at 0 and created_at /
--        updated_at at now();
--      * an API role's UPDATE keeps every counter and created_at as they
--        were (silently, like 0028's billing columns — a client that echoes
--        a row back still saves);
--      * decks.updated_at may not be SET by an API role: set_decks_updated_at
--        makes it now() on a real content change and keeps the old value
--        otherwise; an explicit touch is honoured from a trusted path only
--        (0103 honoured it from anyone).
--    cards.updated_at is untouched (0108's guard already ignores an explicit
--    write) and so is the render guard (0126 / 0134).
--
-- 3. ENTRIES PER DECK AND THE IMPORT (DK0.3).
--      * A deck holds at most 500 entry ROWS. guard_deck_entry_limit(),
--        BEFORE INSERT (or a move to another deck) on deck_cards, refuses
--        the 501st for an API role ('deck_entry_limit', check_violation),
--        under a per-deck advisory lock so two writers can't both take the
--        last slot. Trusted paths are not capped. Decks already past 500
--        (if any) keep their rows; only new rows are refused.
--      * import_deck_entries(deck, entries): the decklist commit in ONE
--        transaction — per-deck advisory lock, ownership check, the cap,
--        then merge-or-insert (one UPDATE for the lines that land on a row
--        the deck already has, one INSERT for the rest, positions after the
--        deck's last). Replaces the app's read-then-write (a double submit
--        read the same rows twice and inserted every line twice; a failed
--        update left the merge half done). SECURITY INVOKER: RLS applies.
--      * add_custom_deck_entry(deck, card, name): the creator's "add this
--        card to my deck" under the same lock (check-then-insert raced the
--        same way, and parallel AI steps tied their positions).
--    No unique index on deck_cards: production may already hold duplicate
--    rows, and an index would fail this migration there.
--
-- Grants: the new columns ride decks' TABLE grants (0097). The two RPCs are
-- for signed-in users (and the service role, which they refuse: no
-- auth.uid() owns a deck); anon may not call them. The trigger functions are
-- invoked by their triggers alone. public_deck_format_counts() keeps its
-- signature (`create or replace` keeps its ACL); its grants are restated.
--
-- Ships through a PR; never applied ad-hoc. Idempotent.

-- ===========================================================================
-- 1. Stored counts
-- ===========================================================================

alter table public.decks
  add column if not exists card_count integer not null default 0,
  add column if not exists linked_card_count integer not null default 0;

comment on column public.decks.card_count is
  'Physical cards in the deck: deck_cards quantities summed, maybeboard excluded. Kept by sync_deck_from_entries (0143); API roles cannot write it.';
comment on column public.decks.linked_card_count is
  'card_count''s share whose entry links one of the owner''s cards (card_id set). Kept by sync_deck_from_entries (0143); API roles cannot write it.';

-- The stored counts are counters, not edits: a recount alone never moves
-- updated_at (the statement trigger touches it explicitly). An explicit
-- updated_at write is honoured from a trusted path only.
create or replace function public.set_decks_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'view_count' - 'likes_count' - 'card_count' - 'linked_card_count' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'view_count' - 'likes_count' - 'card_count' - 'linked_card_count' - 'updated_at') then
    new.updated_at = now();
  elsif new.updated_at is distinct from old.updated_at
        and current_user not in ('anon', 'authenticated') then
    -- A trusted touch (sync_deck_from_entries) — keep it.
    null;
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end;
$$;

create or replace function public.sync_deck_from_entries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deck_ids uuid[];
begin
  -- Each trigger declares only the transition tables its event has; a
  -- branch that names the other one is never planned for that trigger.
  if tg_op = 'INSERT' then
    select array_agg(distinct n.deck_id order by n.deck_id) into v_deck_ids
    from new_entries n;
  elsif tg_op = 'UPDATE' then
    select array_agg(distinct x.deck_id order by x.deck_id) into v_deck_ids
    from (
      select n.deck_id from new_entries n
      union
      select o.deck_id from old_entries o
    ) x;
  else
    select array_agg(distinct o.deck_id order by o.deck_id) into v_deck_ids
    from old_entries o;
  end if;

  if v_deck_ids is null then
    return null;
  end if;

  -- Lock first (id order: no deadlock between two multi-deck statements),
  -- then count with a fresh snapshot: a concurrent writer's committed rows
  -- are seen, never overwritten by a stale sum.
  perform 1
  from public.decks d
  where d.id = any (v_deck_ids)
  order by d.id
  for update;

  update public.decks d
  set card_count = s.card_count,
      linked_card_count = s.linked_card_count,
      updated_at = now()
  from (
    select ids.deck_id,
           coalesce(sum(dc.quantity) filter (where dc.board <> 'maybe'), 0)::integer as card_count,
           coalesce(sum(dc.quantity) filter (where dc.board <> 'maybe' and dc.card_id is not null), 0)::integer
             as linked_card_count
    from unnest(v_deck_ids) as ids(deck_id)
    left join public.deck_cards dc on dc.deck_id = ids.deck_id
    group by ids.deck_id
  ) s
  where d.id = s.deck_id;

  return null;
end;
$$;

revoke all on function public.sync_deck_from_entries() from public, anon, authenticated;

drop trigger if exists deck_cards_touch_deck on public.deck_cards;
drop function if exists public.touch_deck_from_entry();

drop trigger if exists deck_cards_sync_deck_insert on public.deck_cards;
create trigger deck_cards_sync_deck_insert
  after insert on public.deck_cards
  referencing new table as new_entries
  for each statement execute function public.sync_deck_from_entries();

drop trigger if exists deck_cards_sync_deck_update on public.deck_cards;
create trigger deck_cards_sync_deck_update
  after update on public.deck_cards
  referencing old table as old_entries new table as new_entries
  for each statement execute function public.sync_deck_from_entries();

drop trigger if exists deck_cards_sync_deck_delete on public.deck_cards;
create trigger deck_cards_sync_deck_delete
  after delete on public.deck_cards
  referencing old table as old_entries
  for each statement execute function public.sync_deck_from_entries();

-- Backfill (runs as the migration's role: a trusted path; the redefined
-- set_decks_updated_at above leaves updated_at alone for a counts-only write).
update public.decks d
set card_count = s.card_count,
    linked_card_count = s.linked_card_count
from (
  select dk.id as deck_id,
         coalesce(sum(dc.quantity) filter (where dc.board <> 'maybe'), 0)::integer as card_count,
         coalesce(sum(dc.quantity) filter (where dc.board <> 'maybe' and dc.card_id is not null), 0)::integer
           as linked_card_count
  from public.decks dk
  left join public.deck_cards dc on dc.deck_id = dk.id
  group by dk.id
) s
where d.id = s.deck_id
  and (d.card_count is distinct from s.card_count
       or d.linked_card_count is distinct from s.linked_card_count);

-- Hub counts: "non-empty" is card_count > 0, as the lists read it.
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
    and d.card_count > 0
  group by d.format
  order by count(*) desc, d.format asc;
$$;

revoke all on function public.public_deck_format_counts() from public;
grant execute on function public.public_deck_format_counts() to anon, authenticated, service_role;

-- ===========================================================================
-- 2. Counters are the server's
-- ===========================================================================

create or replace function public.guard_deck_counters()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.likes_count := 0;
    new.view_count := 0;
    new.card_count := 0;
    new.linked_card_count := 0;
    new.created_at := now();
    new.updated_at := now();
  else
    new.likes_count := old.likes_count;
    new.view_count := old.view_count;
    new.card_count := old.card_count;
    new.linked_card_count := old.linked_card_count;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_deck_counters() from public, anon, authenticated;

-- Fires before decks_set_updated_at (triggers of one timing fire in name
-- order), so a reverted counter never reads as a content change.
drop trigger if exists decks_guard_counters on public.decks;
create trigger decks_guard_counters
  before insert or update of likes_count, view_count, card_count, linked_card_count, created_at
  on public.decks
  for each row execute function public.guard_deck_counters();

create or replace function public.guard_card_counters()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.likes_count := 0;
    new.view_count := 0;
    new.share_count := 0;
    new.created_at := now();
  else
    new.likes_count := old.likes_count;
    new.view_count := old.view_count;
    new.share_count := old.share_count;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_card_counters() from public, anon, authenticated;

-- Fires before cards_set_updated_at, which does not ignore created_at.
drop trigger if exists cards_guard_counters on public.cards;
create trigger cards_guard_counters
  before insert or update of likes_count, view_count, share_count, created_at
  on public.cards
  for each row execute function public.guard_card_counters();

-- ===========================================================================
-- 3. Entries per deck, and the import
-- ===========================================================================

-- The one lock every entry writer of a deck shares (the cap, the import, the
-- custom-entry add): pg_advisory_xact_lock(hashtextextended('deck_entries:'
-- || deck_id, 0)). Transaction-scoped, re-entrant.

create or replace function public.guard_deck_entry_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.deck_id is not distinct from old.deck_id then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('deck_entries:' || new.deck_id::text, 0));
  -- Earlier rows of the same statement are visible here (a volatile
  -- function in a row-level BEFORE trigger), so a bulk insert is counted
  -- row by row.
  select count(*) into v_count
  from public.deck_cards dc
  where dc.deck_id = new.deck_id;
  if v_count >= 500 then
    raise exception 'deck_entry_limit: a deck holds at most 500 entries'
      using errcode = 'check_violation',
            detail = format('existing=%s,adding=1', v_count);
  end if;
  return new;
end;
$$;

revoke all on function public.guard_deck_entry_limit() from public, anon, authenticated;

drop trigger if exists deck_cards_guard_entry_limit on public.deck_cards;
create trigger deck_cards_guard_entry_limit
  before insert or update of deck_id on public.deck_cards
  for each row execute function public.guard_deck_entry_limit();

-- The decklist commit. `p_entries` is a JSON array of entry objects with
-- deck_cards' own keys (board, quantity, name, scryfall_id, set_code,
-- collector_number, type_line, mana_cost, mana_value, color_identity,
-- rarity, image_url) — the app's server-resolved lines, already merged
-- among themselves (lib/decks/import-plan.ts planImportEntries). A line
-- lands on the deck's row with the same merge key (board + Scryfall id, or
-- board + case-folded name when it has none — importMergeKey) or becomes a
-- new row. Returns {"added": n, "merged": m}.
create or replace function public.import_deck_entries(p_deck_id uuid, p_entries jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing integer;
  v_new integer;
  v_last_position integer;
  v_merged integer := 0;
  v_added integer := 0;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'import_entries_invalid: entries must be a JSON array'
      using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_entries) = 0 then
    return jsonb_build_object('added', 0, 'merged', 0);
  end if;
  if jsonb_array_length(p_entries) > 500 then
    raise exception 'deck_entry_limit: a deck holds at most 500 entries'
      using errcode = 'check_violation',
            detail = format('existing=0,adding=%s', jsonb_array_length(p_entries));
  end if;

  perform pg_advisory_xact_lock(hashtextextended('deck_entries:' || p_deck_id::text, 0));

  if not exists (
    select 1 from public.decks d
    where d.id = p_deck_id and d.owner_id = (select auth.uid())
  ) then
    raise exception 'deck_not_owned: deck not found or not yours'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_entries) as t(x)
    cross join lateral jsonb_populate_record(null::public.deck_cards, t.x) as e
    where e.board is null or e.name is null or e.quantity is null
  ) then
    raise exception 'import_entries_invalid: every entry needs a board, a name and a quantity'
      using errcode = 'invalid_parameter_value';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_entries) as t(x)
    cross join lateral jsonb_populate_record(null::public.deck_cards, t.x) as e
    group by e.board, coalesce(e.scryfall_id, 'name:' || lower(btrim(e.name)))
    having count(*) > 1
  ) then
    raise exception 'import_entries_invalid: two entries share a board and a card'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The cap, counted before anything is written: the deck's rows plus the
  -- lines that match none of them.
  select count(*) into v_existing
  from public.deck_cards dc
  where dc.deck_id = p_deck_id;

  select count(*) into v_new
  from jsonb_array_elements(p_entries) as t(x)
  cross join lateral jsonb_populate_record(null::public.deck_cards, t.x) as e
  where not exists (
    select 1 from public.deck_cards dc
    where dc.deck_id = p_deck_id
      and dc.board = e.board
      and case
            when e.scryfall_id is not null then dc.scryfall_id = e.scryfall_id
            else dc.scryfall_id is null and lower(btrim(dc.name)) = lower(btrim(e.name))
          end
  );

  if v_new > 0 and v_existing + v_new > 500 then
    raise exception 'deck_entry_limit: a deck holds at most 500 entries'
      using errcode = 'check_violation',
            detail = format('existing=%s,adding=%s', v_existing, v_new);
  end if;

  -- Merges: ONE update, each matched row once with every line it takes
  -- summed (two lines on one row must never overwrite each other).
  update public.deck_cards dc
  set quantity = least(dc.quantity + m.added, 250)
  from (
    select hit.row_id, sum(hit.quantity)::integer as added
    from (
      select e.quantity,
             (
               select dc2.id from public.deck_cards dc2
               where dc2.deck_id = p_deck_id
                 and dc2.board = e.board
                 and case
                       when e.scryfall_id is not null then dc2.scryfall_id = e.scryfall_id
                       else dc2.scryfall_id is null and lower(btrim(dc2.name)) = lower(btrim(e.name))
                     end
               order by dc2.position, dc2.created_at, dc2.id
               limit 1
             ) as row_id
      from jsonb_array_elements(p_entries) as t(x)
      cross join lateral jsonb_populate_record(null::public.deck_cards, t.x) as e
    ) hit
    where hit.row_id is not null
    group by hit.row_id
  ) m
  where dc.id = m.row_id
    and dc.deck_id = p_deck_id;
  get diagnostics v_merged = row_count;

  -- New rows: ONE insert, in the list's order, after the deck's last position.
  select coalesce(max(dc.position), -1) into v_last_position
  from public.deck_cards dc
  where dc.deck_id = p_deck_id;

  insert into public.deck_cards (
    deck_id, board, quantity, position, scryfall_id, name, set_code,
    collector_number, type_line, mana_cost, mana_value, color_identity,
    rarity, image_url
  )
  select p_deck_id, e.board, e.quantity,
         v_last_position + (row_number() over (order by t.ord))::integer,
         e.scryfall_id, e.name, e.set_code, e.collector_number, e.type_line,
         e.mana_cost, e.mana_value, coalesce(e.color_identity, '{}'::text[]),
         e.rarity, e.image_url
  from jsonb_array_elements(p_entries) with ordinality as t(x, ord)
  cross join lateral jsonb_populate_record(null::public.deck_cards, t.x) as e
  where not exists (
    select 1 from public.deck_cards dc
    where dc.deck_id = p_deck_id
      and dc.board = e.board
      and case
            when e.scryfall_id is not null then dc.scryfall_id = e.scryfall_id
            else dc.scryfall_id is null and lower(btrim(dc.name)) = lower(btrim(e.name))
          end
  )
  order by t.ord;
  get diagnostics v_added = row_count;

  return jsonb_build_object('added', v_added, 'merged', v_merged);
end;
$$;

revoke all on function public.import_deck_entries(uuid, jsonb) from public, anon;
grant execute on function public.import_deck_entries(uuid, jsonb) to authenticated, service_role;

-- The creator's "add this card to my deck": one main-board copy, skipped
-- when the card is already in the deck on any board. Returns true when a row
-- was added, false when the card was already there.
create or replace function public.add_custom_deck_entry(p_deck_id uuid, p_card_id uuid, p_name text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_position integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('deck_entries:' || p_deck_id::text, 0));

  if not exists (
    select 1 from public.decks d
    where d.id = p_deck_id and d.owner_id = (select auth.uid())
  ) then
    raise exception 'deck_not_owned: deck not found or not yours'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from public.deck_cards dc
    where dc.deck_id = p_deck_id and dc.card_id = p_card_id
  ) then
    return false;
  end if;

  select coalesce(max(dc.position), -1) + 1 into v_position
  from public.deck_cards dc
  where dc.deck_id = p_deck_id;

  insert into public.deck_cards (deck_id, card_id, name, board, quantity, position)
  values (p_deck_id, p_card_id, p_name, 'main', 1, v_position);
  return true;
end;
$$;

revoke all on function public.add_custom_deck_entry(uuid, uuid, text) from public, anon;
grant execute on function public.add_custom_deck_entry(uuid, uuid, text) to authenticated, service_role;

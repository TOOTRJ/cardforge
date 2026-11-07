-- 0185_collection_builder.sql — the Collection Deck Builder beta tool's
-- collection (tool `collection-builder`, lib/tools/catalog.ts;
-- /dashboard/tools/collection-builder).
--
-- A collection is the REAL cards a user owns: which Scryfall printings, in
-- which finish and language, and how many. It is NOT cards: a collection row
-- never counts toward the saved-card limit (0104's trigger reads `cards`
-- only), and neither does the deck a builder makes from it (a deck's
-- printing entries use no card slot) — owner 2026-11-06: "a slot is
-- something you designed".
--
-- 1. collection_cards — one row per (owner, printing, finish, language): a
--    different printing or variation is a different row, the quantity is a
--    column. Each row keeps the printing's data as Scryfall answered it when
--    it was added (name, type line, cost, colours, Oracle text, legality,
--    the "normal" picture), so the collection and the builder read no
--    Scryfall request per card. Written by the tool's server actions only
--    after they fetched the printing through the shared Scryfall client
--    (lib/scryfall/client.ts); a deck made from it is written through the
--    decklist commit (import_deck_entries, 0143), which fetches every
--    printing AGAIN by id — nothing here is trusted outside the collection.
--
-- 2. The safety cap (owner 2026-11-06): 25,000 DIFFERENT cards a user —
--    rows, never copies. `collection_card_cap()` is the number, ONCE in SQL;
--    the app's COLLECTION_CARD_CAP (lib/tools/collection/limits.ts) mirrors
--    it and a unit test holds the two equal. Enforced by a STATEMENT-level
--    trigger after every insert, under a per-owner advisory lock (0104's
--    pattern, one count per statement rather than per row: an import writes
--    hundreds of rows at a time): a statement that leaves an owner past the
--    cap is refused whole with `collection_capacity_exceeded`. The app
--    writes only what fits, so the trigger is the net, never the message.
--
-- 3. add_collection_cards(rows, batch, mode) — ONE write path for the app:
--    insert-or-merge in one statement (mode 'add' adds the quantities;
--    'replace' sets them, but adds onto a row THIS batch already wrote — a
--    file may list one printing on two lines, in two chunks), stamping the
--    import batch a "replace" import deletes everything else by when it
--    finishes. SECURITY DEFINER with its own checks (the caller signed in,
--    the tool open to them, rows written under the caller's id alone): it is
--    the ONLY way a row goes in — the API roles have no INSERT grant and may
--    UPDATE the quantity column alone, so every row's printing data is what
--    the server fetched from Scryfall. Idempotent per import CHUNK: a chunk
--    (batch, index) is applied once (collection_import_chunks), so a chunk
--    sent again after a lost answer adds nothing twice.
--
-- 4. collection_stats() — the meter: different cards, copies, the cap.
--
-- 5. collection_buildable_decks(limit) — "Decks you can build": every
--    PUBLIC, non-empty Commander deck of a real creator
--    (`owner_is_creator`, 0149) but the caller's own, matched against the
--    caller's collection at CARD level (any printing: the front face's name,
--    lower-cased — `name_key`), the commander and main boards only, basic
--    lands left out on both sides, sorted by fewest missing. A deck entry
--    that is a PipGlyph card with no printing is a "proxy" — counted apart,
--    never in the share owned; a deck the caller owns none of is left out.
--    Security INVOKER: the decks and deck_cards
--    read policies decide what the caller sees (a hidden entry is its
--    owner's row alone, 0152), so a private card is never matched or named.
--
-- 6. scryfall_calls gains 'collection_import' (one row per import CHUNK the
--    server resolves) and card_ai_calls 'build_collection_deck' (the AI
--    build, 1 credit, reserved and settled by its route).
--
-- Access: the owner's own rows, and only while the tool is open to them
-- (has_tool_access, 0182) — a tester whose grant ends keeps the rows but
-- reads none until the tool is theirs again. Account deletion cascades.
--
-- Grants are explicit (0097). Idempotent. Ships through a PR; never applied
-- ad-hoc.

-- ===========================================================================
-- 1. collection_cards
-- ===========================================================================

create table if not exists public.collection_cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  scryfall_id uuid not null,
  oracle_id uuid,
  finish text not null default 'nonfoil'
    check (finish in ('nonfoil', 'foil', 'etched')),
  lang text not null default 'en'
    check (lang ~ '^[a-z]{2,3}$'),
  quantity integer not null default 1
    check (quantity between 1 and 9999),
  name text not null
    check (char_length(name) between 1 and 200),
  -- The card-level match key: the front face's name, lower-cased ("Fire //
  -- Ice" → "fire"), the same expression the deck match below applies to a
  -- deck entry's name.
  name_key text generated always as (lower(split_part(name, ' // ', 1))) stored,
  type_line text check (type_line is null or char_length(type_line) <= 300),
  mana_cost text check (mana_cost is null or char_length(mana_cost) <= 200),
  mana_value numeric(6, 2) check (mana_value is null or mana_value between 0 and 9999.99),
  color_identity text[] not null default '{}'
    check (color_identity <@ array['W', 'U', 'B', 'R', 'G']::text[]),
  oracle_text text check (oracle_text is null or char_length(oracle_text) <= 3000),
  rarity text check (rarity is null or char_length(rarity) <= 20),
  set_code text check (set_code is null or char_length(set_code) <= 10),
  set_name text check (set_name is null or char_length(set_name) <= 120),
  collector_number text check (collector_number is null or char_length(collector_number) <= 20),
  -- Scryfall's own picture of the printing only (migration 0127's
  -- deck-card-image rule): never another host.
  image_url text check (image_url is null or (image_url ~ '^https://cards\.scryfall\.io/' and image_url !~ '\.\.')),
  -- Legal in Commander (Scryfall's legalities.commander = 'legal'): the
  -- banlist and the card's own legality, as Scryfall answered.
  commander_legal boolean not null default false,
  -- May lead a Commander deck: a legendary creature, or a card whose text
  -- says it can be your commander.
  can_be_commander boolean not null default false,
  -- The import line the row came from (the raw row kept, for "why is this
  -- here"); null for a card added by hand.
  source_line text check (source_line is null or char_length(source_line) <= 300),
  -- The import that last wrote the row; a "replace" import deletes every
  -- row whose batch is another once it finishes.
  import_batch uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, scryfall_id, finish, lang)
);

create index if not exists collection_cards_owner_name_idx
  on public.collection_cards (owner_id, name_key);
create index if not exists collection_cards_owner_recent_idx
  on public.collection_cards (owner_id, updated_at desc);
create index if not exists collection_cards_owner_commander_idx
  on public.collection_cards (owner_id)
  where can_be_commander;

comment on table public.collection_cards is
  'Collection Deck Builder beta tool (0185): the real printings a user owns — one row per (owner, printing, finish, language), the quantity a column, Scryfall''s data kept. Never cards: no card limit. At most collection_card_cap() rows per owner. Owner rows only, while has_tool_access(''collection-builder'').';

alter table public.collection_cards enable row level security;

drop policy if exists "Collection cards: owner reads" on public.collection_cards;
create policy "Collection cards: owner reads"
  on public.collection_cards for select
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('collection-builder'));

drop policy if exists "Collection cards: owner inserts" on public.collection_cards;
create policy "Collection cards: owner inserts"
  on public.collection_cards for insert
  to authenticated
  with check (owner_id = (select auth.uid()) and public.has_tool_access('collection-builder'));

drop policy if exists "Collection cards: owner updates" on public.collection_cards;
create policy "Collection cards: owner updates"
  on public.collection_cards for update
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('collection-builder'))
  with check (owner_id = (select auth.uid()) and public.has_tool_access('collection-builder'));

drop policy if exists "Collection cards: owner deletes" on public.collection_cards;
create policy "Collection cards: owner deletes"
  on public.collection_cards for delete
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('collection-builder'));

-- updated_at is the server's; an update never moves a row to another owner
-- or printing (the key is the row).
create or replace function public.collection_cards_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.owner_id := old.owner_id;
    new.scryfall_id := old.scryfall_id;
    new.finish := old.finish;
    new.lang := old.lang;
  end if;
  return new;
end;
$$;

drop trigger if exists collection_cards_touch on public.collection_cards;
create trigger collection_cards_touch
  before insert or update on public.collection_cards
  for each row execute function public.collection_cards_touch();

revoke all on function public.collection_cards_touch() from public, anon, authenticated;

revoke all on public.collection_cards from public, anon, authenticated;
-- No INSERT for the API roles: add_collection_cards (below) is the one way in.
-- UPDATE of the quantity alone (the collection's edit dialog).
grant select, delete on public.collection_cards to authenticated;
grant update (quantity) on public.collection_cards to authenticated;
grant select, insert, update, delete on public.collection_cards to service_role;

-- The import chunks add_collection_cards has applied: (owner, batch, chunk)
-- once. Read and written by that function alone; rows older than two days
-- are dropped by it as it goes.
create table if not exists public.collection_import_chunks (
  owner_id uuid not null references auth.users (id) on delete cascade,
  batch uuid not null,
  chunk integer not null check (chunk between 0 and 100000),
  created_at timestamptz not null default now(),
  primary key (owner_id, batch, chunk)
);

comment on table public.collection_import_chunks is
  'Collection Deck Builder (0185): the import chunks add_collection_cards has applied, so a chunk sent twice is written once. That function''s alone; no API role reads it.';

alter table public.collection_import_chunks enable row level security;
revoke all on public.collection_import_chunks from public, anon, authenticated;
grant select, insert, delete on public.collection_import_chunks to service_role;

-- ===========================================================================
-- 2. The safety cap
-- ===========================================================================

-- THE number. lib/tools/collection/limits.ts COLLECTION_CARD_CAP mirrors it
-- (tests/unit/db/collection-builder-migration.test.ts holds them equal).
create or replace function public.collection_card_cap()
returns integer
language sql
immutable
set search_path = ''
as $$ select 25000 $$;

comment on function public.collection_card_cap() is
  'The Collection Deck Builder''s safety cap (0185): different cards (rows) per user — quantity never counts. Mirrored by COLLECTION_CARD_CAP in lib/tools/collection/limits.ts.';

revoke all on function public.collection_card_cap() from public, anon;
grant execute on function public.collection_card_cap() to authenticated, service_role;

-- After each INSERT statement: lock every owner it wrote for (one advisory
-- lock per owner, taken in a fixed order so two writers never deadlock), then
-- count. Under READ COMMITTED each count sees what an earlier holder of the
-- lock committed, so two concurrent imports can't both slip past the cap.
create or replace function public.enforce_collection_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_count integer;
begin
  for v_owner in select distinct n.owner_id from new_rows n order by n.owner_id loop
    perform pg_advisory_xact_lock(hashtextextended('pipglyph.collection:' || v_owner::text, 0));
    select count(*) into v_count from public.collection_cards c where c.owner_id = v_owner;
    if v_count > public.collection_card_cap() then
      raise exception 'collection_capacity_exceeded'
        using errcode = 'P0001',
              detail = format('cap=%s count=%s', public.collection_card_cap(), v_count),
              hint = 'A collection holds at most collection_card_cap() different cards.';
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists collection_cards_enforce_cap on public.collection_cards;
create trigger collection_cards_enforce_cap
  after insert on public.collection_cards
  referencing new table as new_rows
  for each statement execute function public.enforce_collection_cap();

revoke all on function public.enforce_collection_cap() from public, anon, authenticated;

-- ===========================================================================
-- 3. add_collection_cards — the app's one write
-- ===========================================================================

-- p_rows: [{scryfall_id, oracle_id, finish, lang, quantity, name, type_line,
-- mana_cost, mana_value, color_identity, oracle_text, rarity, set_code,
-- set_name, collector_number, image_url, commander_legal, can_be_commander,
-- source_line}], at most 1000 a call. Duplicate keys inside one call are
-- summed first (an insert can't touch one row twice). p_mode: 'add' adds
-- the quantities; 'replace' sets them, adding onto a row p_batch already
-- wrote. p_chunk: the chunk's index in its import (with p_batch) — a chunk
-- already applied writes nothing and answers {"already": true}. Answers
-- {"added": n, "updated": m}.
create or replace function public.add_collection_cards(p_rows jsonb, p_batch uuid, p_mode text, p_chunk integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_added integer := 0;
  v_updated integer := 0;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.has_tool_access('collection-builder') then
    raise exception 'collection_tool_closed' using errcode = '42501';
  end if;
  if p_mode not in ('add', 'replace') then
    raise exception 'collection_bad_mode' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'collection_bad_rows' using errcode = '22023';
  end if;

  if p_batch is not null and p_chunk is not null then
    delete from public.collection_import_chunks
      where owner_id = v_me and created_at < now() - interval '2 days';
    insert into public.collection_import_chunks (owner_id, batch, chunk)
      values (v_me, p_batch, p_chunk)
      on conflict do nothing;
    if not found then
      return jsonb_build_object('added', 0, 'updated', 0, 'already', true);
    end if;
  end if;

  with input as (
    select r.*
    from jsonb_to_recordset(p_rows) as r (
      scryfall_id uuid, oracle_id uuid, finish text, lang text, quantity integer,
      name text, type_line text, mana_cost text, mana_value numeric,
      color_identity text[], oracle_text text, rarity text, set_code text,
      set_name text, collector_number text, image_url text,
      commander_legal boolean, can_be_commander boolean, source_line text
    )
  ),
  merged as (
    select distinct on (i.scryfall_id, coalesce(i.finish, 'nonfoil'), coalesce(i.lang, 'en'))
      i.scryfall_id, i.oracle_id, coalesce(i.finish, 'nonfoil') as finish,
      coalesce(i.lang, 'en') as lang,
      least(9999, sum(greatest(coalesce(i.quantity, 1), 1)) over (
        partition by i.scryfall_id, coalesce(i.finish, 'nonfoil'), coalesce(i.lang, 'en')
      ))::integer as quantity,
      i.name, i.type_line, i.mana_cost, i.mana_value,
      coalesce(i.color_identity, '{}'::text[]) as color_identity, i.oracle_text,
      i.rarity, i.set_code, i.set_name, i.collector_number, i.image_url,
      coalesce(i.commander_legal, false) as commander_legal,
      coalesce(i.can_be_commander, false) as can_be_commander,
      i.source_line
    from input i
    where i.scryfall_id is not null
    order by i.scryfall_id, coalesce(i.finish, 'nonfoil'), coalesce(i.lang, 'en')
  ),
  written as (
    insert into public.collection_cards as c (
      owner_id, scryfall_id, oracle_id, finish, lang, quantity, name,
      type_line, mana_cost, mana_value, color_identity, oracle_text, rarity,
      set_code, set_name, collector_number, image_url, commander_legal,
      can_be_commander, source_line, import_batch
    )
    select v_me, m.scryfall_id, m.oracle_id, m.finish, m.lang, m.quantity, m.name,
      m.type_line, m.mana_cost, m.mana_value, m.color_identity, m.oracle_text,
      m.rarity, m.set_code, m.set_name, m.collector_number, m.image_url,
      m.commander_legal, m.can_be_commander, m.source_line, p_batch
    from merged m
    on conflict (owner_id, scryfall_id, finish, lang) do update set
      quantity = case
        when p_mode = 'add' or (p_batch is not null and c.import_batch = p_batch)
          then least(9999, c.quantity + excluded.quantity)
        else excluded.quantity end,
      oracle_id = excluded.oracle_id,
      name = excluded.name,
      type_line = excluded.type_line,
      mana_cost = excluded.mana_cost,
      mana_value = excluded.mana_value,
      color_identity = excluded.color_identity,
      oracle_text = excluded.oracle_text,
      rarity = excluded.rarity,
      set_code = excluded.set_code,
      set_name = excluded.set_name,
      collector_number = excluded.collector_number,
      image_url = excluded.image_url,
      commander_legal = excluded.commander_legal,
      can_be_commander = excluded.can_be_commander,
      source_line = coalesce(excluded.source_line, c.source_line),
      import_batch = coalesce(excluded.import_batch, c.import_batch)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
    into v_added, v_updated
  from written;

  return jsonb_build_object('added', v_added, 'updated', v_updated);
end;
$$;

comment on function public.add_collection_cards(jsonb, uuid, text, integer) is
  'Collection Deck Builder (0185): the ONE collection insert — insert or merge (mode add: quantities added; replace: set, added onto rows the same batch wrote), stamping the import batch, once per (batch, chunk). Security definer: the caller signed in with has_tool_access(''collection-builder''), rows under auth.uid() only.';

revoke all on function public.add_collection_cards(jsonb, uuid, text, integer) from public, anon;
grant execute on function public.add_collection_cards(jsonb, uuid, text, integer) to authenticated, service_role;

-- ===========================================================================
-- 4. collection_stats — the meter
-- ===========================================================================

create or replace function public.collection_stats()
returns table (cards integer, copies bigint, commanders integer, cap integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer,
         coalesce(sum(c.quantity), 0)::bigint,
         (count(*) filter (where c.can_be_commander and c.commander_legal))::integer,
         public.collection_card_cap()
  from public.collection_cards c
  where c.owner_id = (select auth.uid());
$$;

revoke all on function public.collection_stats() from public, anon;
grant execute on function public.collection_stats() to authenticated, service_role;

-- ===========================================================================
-- 5. collection_buildable_decks — "Decks you can build"
-- ===========================================================================

-- A basic land, on either side: its type line says Basic, or (a placeholder
-- entry with no type line) its name is one of the basics.
create or replace function public.collection_is_basic_land(p_name text, p_type_line text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_type_line ~* '^\s*(legendary\s+)?(snow\s+)?basic\b', false)
      or lower(split_part(coalesce(p_name, ''), ' // ', 1)) in (
        'plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
        'snow-covered plains', 'snow-covered island', 'snow-covered swamp',
        'snow-covered mountain', 'snow-covered forest', 'snow-covered wastes'
      );
$$;

revoke all on function public.collection_is_basic_land(text, text) from public, anon;
grant execute on function public.collection_is_basic_land(text, text) to authenticated, service_role;

create or replace function public.collection_buildable_decks(p_limit integer default 60)
returns table (
  deck_id uuid,
  slug text,
  title text,
  owner_username text,
  color_identity text[],
  commanders text[],
  owns_commander boolean,
  total integer,
  owned integer,
  missing integer,
  proxies integer,
  missing_cards jsonb,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with mine as (
    select c.name_key, sum(c.quantity)::integer as have
    from public.collection_cards c
    where c.owner_id = (select auth.uid())
    group by c.name_key
  ),
  -- The 400 decks that share the MOST cards with the collection (basics
  -- left out) — never the newest 400: an older deck you own nearly all of
  -- must be found.
  candidate_decks as (
    select d.id, d.slug, d.title, d.owner_id, d.updated_at
    from public.decks d
    join public.deck_cards dc on dc.deck_id = d.id and dc.board in ('commander', 'main')
    join mine m on m.name_key = lower(split_part(dc.name, ' // ', 1))
    where d.visibility = 'public'
      and d.format = 'commander'
      and d.card_count > 0
      and d.owner_id <> (select auth.uid())
      and public.owner_is_creator(d.owner_id)
      and public.has_tool_access('collection-builder')
      and not public.collection_is_basic_land(dc.name, dc.type_line)
    group by d.id, d.slug, d.title, d.owner_id, d.updated_at
    order by count(*) desc, d.updated_at desc
    limit 400
  ),
  entries as (
    select dc.deck_id, dc.board, dc.quantity, dc.name, dc.type_line,
           dc.scryfall_id, dc.image_url, dc.color_identity,
           lower(split_part(dc.name, ' // ', 1)) as name_key,
           (dc.card_id is not null and dc.scryfall_id is null) as is_proxy
    from public.deck_cards dc
    join candidate_decks cd on cd.id = dc.deck_id
    where dc.board in ('commander', 'main')
      and not public.collection_is_basic_land(dc.name, dc.type_line)
  ),
  needs as (
    select e.deck_id, e.name_key,
           min(e.name) as name,
           sum(e.quantity)::integer as need,
           bool_or(e.board = 'commander') as is_commander,
           (array_agg(e.image_url order by e.image_url nulls last))[1] as image_url,
           (array_agg(e.scryfall_id order by e.scryfall_id nulls last))[1] as scryfall_id
    from entries e
    where not e.is_proxy
    group by e.deck_id, e.name_key
  ),
  scored as (
    select n.*, least(n.need, coalesce(m.have, 0)) as got
    from needs n
    left join mine m on m.name_key = n.name_key
  ),
  per_deck as (
    select s.deck_id,
           sum(s.need)::integer as total,
           sum(s.got)::integer as owned,
           coalesce(bool_and(s.got >= s.need) filter (where s.is_commander), false) as owns_commander,
           coalesce(array_agg(s.name order by s.name) filter (where s.is_commander), '{}') as commanders,
           coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'name', s.name,
                 'quantity', s.need - s.got,
                 'image_url', s.image_url,
                 'scryfall_id', s.scryfall_id,
                 'commander', s.is_commander
               ) order by s.is_commander desc, s.name
             ) filter (where s.got < s.need),
             '[]'::jsonb
           ) as missing_cards
    from scored s
    group by s.deck_id
  ),
  colours as (
    select e.deck_id, array_agg(distinct ci order by ci) as color_identity
    from entries e, unnest(e.color_identity) as ci
    group by e.deck_id
  ),
  proxy_counts as (
    select e.deck_id, sum(e.quantity)::integer as proxies
    from entries e
    where e.is_proxy
    group by e.deck_id
  )
  select cd.id, cd.slug, cd.title, p.username,
         coalesce(col.color_identity, '{}'),
         pd.commanders, pd.owns_commander,
         pd.total, pd.owned, pd.total - pd.owned,
         coalesce(pc.proxies, 0),
         -- At most 150 names: a Commander deck has 100.
         (select coalesce(jsonb_agg(x), '[]'::jsonb)
            from (select x from jsonb_array_elements(pd.missing_cards) x limit 150) t),
         cd.updated_at
  from candidate_decks cd
  join per_deck pd on pd.deck_id = cd.id
  left join colours col on col.deck_id = cd.id
  left join proxy_counts pc on pc.deck_id = cd.id
  left join public.profiles p on p.id = cd.owner_id
  -- A deck the caller owns none of is not one they can build.
  where pd.total > 0 and pd.owned > 0
  order by pd.total - pd.owned asc, pd.owned desc, cd.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

comment on function public.collection_buildable_decks(integer) is
  'Collection Deck Builder (0185): public Commander decks of real creators (not the caller''s own) matched against the caller''s collection at card level (front-face name), commander + main only, basics left out, fewest missing first. PipGlyph cards with no printing are proxies, outside the share. Security invoker: deck RLS decides what is seen.';

revoke all on function public.collection_buildable_decks(integer) from public, anon;
grant execute on function public.collection_buildable_decks(integer) to authenticated, service_role;

-- ===========================================================================
-- 6. The limiters' labels
-- ===========================================================================

alter table public.scryfall_calls
  drop constraint if exists scryfall_calls_action_check;

alter table public.scryfall_calls
  add constraint scryfall_calls_action_check
  check (action in ('search', 'named', 'import_art', 'deck_import', 'deck_import_commit', 'deck_tokens', 'collection_import'));

alter table public.card_ai_calls
  drop constraint if exists card_ai_calls_action_check;

alter table public.card_ai_calls
  add constraint card_ai_calls_action_check check (
    action = any (array[
      'improve_wording',
      'suggest_cost',
      'suggest_rarity',
      'generate_flavor',
      'generate_art_prompt',
      'check_balance',
      'generate_from_concept',
      'generate_random_card',
      'generate_random_art',
      'fill_card',
      'generate_deck',
      'remix_card',
      'remix_art',
      'generate_set_icon',
      'generate_deck_cards',
      'generate_card_ideas',
      'generate_deck_ideas',
      'analyze_deck',
      'build_collection_deck'
    ])
  );

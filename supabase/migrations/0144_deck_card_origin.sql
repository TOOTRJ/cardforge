-- 0144_deck_card_origin.sql — where a card and a deck entry came from, and
-- other creators' public cards in decks (2026-10-28 deck plan: TODO DK2.5,
-- DK2.6, DK2.9; owner decision D3).
--
-- 1. CARD PROVENANCE (DK2.5). Two INSERT-ONLY columns on cards:
--      import_scryfall_id  the Scryfall printing the card was started from
--                          (uuid; NULL = from scratch, a remix, or any card
--                          saved before this migration — "not tracked");
--      import_fingerprint  "v<version>:<sha-256 hex>" of what the card
--                          printed when it was first saved from that import
--                          (lib/cards/import-fingerprint.ts, the ONE place
--                          the field list lives). NULL beside a source = the
--                          import was already changed when it was saved (an
--                          import altered before the first save, an AI
--                          restyle): "Edited" from the start.
--    Both are written by createCardAction's insert (the user's own client),
--    never by a trigger and never by an edit: platform migrations rewrite
--    cards, and a fingerprint recomputed then would call a changed card
--    unchanged. cards_guard_provenance (0126's style: `current_user in
--    ('anon', 'authenticated')` = an API role, anything else is a trusted
--    path — the service role, SECURITY DEFINER functions, FK actions,
--    migrations, seeds) REFUSES an API role's UPDATE that changes either
--    ('card_provenance_locked', insufficient_privilege); echoing the stored
--    value is fine. Two CHECKs: the fingerprint's format, and no fingerprint
--    without a source. No backfill: an older import is derived where a deck
--    entry knows its printing (lib/decks/entry-status.ts), otherwise it is
--    "not tracked". The user-editable `source_scryfall_id` (0016, the
--    "also remixed by N" link) is untouched and stays editable.
--
-- 2. DECK ENTRY ORIGIN (DK2.6). deck_cards.source — how the entry got into
--    the deck: 'import' (the decklist import), 'creator' (the creator's
--    "add this card to my deck"), 'link' (an existing card added to the
--    deck), 'ai_generate' / 'ai_remix' (the AI deck jobs and the creator's
--    card AI designed for a deck), 'manual' (a real card added by hand —
--    no writer yet: DK5.2's add box). NULL = not known: an entry written
--    before this migration that the backfill can't place, or a card-brought
--    entry whose card its owner unlinked (unlinkDeckCardAction clears it:
--    a plain name, never "No longer available"). Written by every path that
--    INSERTS an entry: import_deck_entries (redefined below: every new row
--    'import', its checks, lock, cap and grants exactly 0143's) and
--    add_custom_deck_entry (redefined below with p_source and p_scryfall_id,
--    so an AI restyle keeps its printing, and refusing a NULL card — 0143
--    let one through). Linking a card onto an existing
--    entry is an UPDATE and keeps the entry's source: the entry still came
--    from where it came from. It is the deck owner's own descriptive data
--    (their RLS lets them PATCH any column of their entries), so no guard.
--    Backfilled where CERTAIN, the rest left NULL:
--      * scryfall_id set → 'import' (the decklist import is the only writer
--        of a Scryfall id, before 0143 and through 0143's RPC);
--      * no scryfall_id, the card an AI job's step created (its steps'
--        card_id), in the deck that job added it to (the job's deck_id; a
--        card job's plan.deck_id) → 'ai_remix' for a deck remix job, else
--        'ai_generate';
--      * left NULL: a card-linked entry no job names (the creator's add, or
--        an AI job its owner deleted — not certain which) and a name-only
--        entry (an import placeholder, or the leftover of a deleted card).
--    The backfill runs with this table's two update triggers disabled: a
--    source is not a content change, so no entry's updated_at and no deck's
--    updated_at / counts move (sync_deck_from_entries touches the deck on
--    every update; the counts it keeps don't read `source`).
--
-- 3. OTHER CREATORS' PUBLIC CARDS (DK2.9, D3). A deck owner may link their
--    OWN card at any visibility, or ANY creator's PUBLIC card — never
--    another creator's private or unlisted one. The insert policy says so
--    (0055's, with the card clause widened); the update policy keeps 0055's
--    deck-ownership check only, and the card rule moves to a BEFORE INSERT
--    OR UPDATE OF card_id guard that sees OLD: a card_id is checked when it
--    is NEW (an insert, or an update that changes it). A policy can't see
--    OLD, and a once-public card that went private would otherwise freeze
--    its entry — every quantity or board change and every import line that
--    merges into it refused by the WITH CHECK. ('deck_card_not_linkable',
--    insufficient_privilege; SECURITY INVOKER, so another creator's private
--    card is not even visible to the check.) Everything else is unchanged:
--    reads follow the deck (0055), deletes need the deck. The READ side of
--    the rule is the app's one deck read (lib/decks/queries.ts
--    listDeckCards): another creator's card shows only while it is public —
--    RLS hands an UNLISTED card to anyone, and a link-only card is never a
--    deck's. When a linked card stops being public its row stays (the card
--    reads as null: "No longer available" to the deck's owner); when it is
--    deleted, 0055's ON DELETE SET NULL keeps the entry's name and printing.
--
-- Grants: the new columns ride the tables' grants (0097). The two guard
-- functions are invoked by their triggers alone (EXECUTE revoked from the
-- API roles). import_deck_entries keeps its signature (`create or replace`
-- keeps its ACL; restated). add_custom_deck_entry gains two parameters with
-- defaults: the 3-argument function is dropped and the 5-argument one is
-- granted to authenticated and service_role only (a NEW function is
-- PUBLIC-executable by default) — a 3-argument call still resolves to it.
--
-- Backward compatible with the code before it: nothing old writes the new
-- columns, the old 3-argument RPC call still works, and the widened policy
-- only lets more through.
--
-- Ships through a PR; never applied ad-hoc. Idempotent.

-- ===========================================================================
-- 1. Card provenance
-- ===========================================================================

alter table public.cards
  add column if not exists import_scryfall_id uuid,
  add column if not exists import_fingerprint text;

comment on column public.cards.import_scryfall_id is
  'The Scryfall printing this card was started from (TODO DK2.5). Written by createCardAction''s insert only; API roles cannot change it (cards_guard_provenance, 0144). NULL = from scratch, a remix, or saved before 0144.';
comment on column public.cards.import_fingerprint is
  'v<version>:<sha-256 hex> of the printed fields at the first save from the import (lib/cards/import-fingerprint.ts). NULL beside import_scryfall_id = changed before that save. Insert-only (0144).';

alter table public.cards drop constraint if exists cards_import_fingerprint_format;
alter table public.cards
  add constraint cards_import_fingerprint_format
  check (import_fingerprint is null or import_fingerprint ~ '^v[1-9][0-9]*:[0-9a-f]{64}$');

alter table public.cards drop constraint if exists cards_import_fingerprint_needs_source;
alter table public.cards
  add constraint cards_import_fingerprint_needs_source
  check (import_fingerprint is null or import_scryfall_id is not null);

create or replace function public.guard_card_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.import_scryfall_id is distinct from old.import_scryfall_id
     or new.import_fingerprint is distinct from old.import_fingerprint then
    raise exception 'card_provenance_locked: a card''s import source and fingerprint are set when it is created'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_card_provenance() from public, anon, authenticated;

drop trigger if exists cards_guard_provenance on public.cards;
create trigger cards_guard_provenance
  before update of import_scryfall_id, import_fingerprint on public.cards
  for each row execute function public.guard_card_provenance();

-- ===========================================================================
-- 2. Deck entry origin
-- ===========================================================================

alter table public.deck_cards
  add column if not exists source text;

comment on column public.deck_cards.source is
  'How the entry got into the deck (TODO DK2.6): import, creator, link, ai_generate, ai_remix, manual. NULL = not known (written before 0144 and not placed by its backfill, or a card-brought entry whose card its owner unlinked).';

alter table public.deck_cards drop constraint if exists deck_cards_source_valid;
alter table public.deck_cards
  add constraint deck_cards_source_valid
  check (source is null or source in ('import', 'creator', 'link', 'ai_generate', 'ai_remix', 'manual'));

-- The backfill is not an edit (header, section 2): the two UPDATE triggers
-- are off for it and back on below, in this transaction.
alter table public.deck_cards disable trigger deck_cards_set_updated_at;
alter table public.deck_cards disable trigger deck_cards_sync_deck_update;

update public.deck_cards
set source = 'import'
where source is null
  and scryfall_id is not null;

update public.deck_cards dc
set source = made.source
from (
  select distinct on (j.target_deck, (s.step ->> 'card_id'))
         j.target_deck as deck_id,
         (s.step ->> 'card_id')::uuid as card_id,
         case when j.kind = 'deck_remix' then 'ai_remix' else 'ai_generate' end as source
  from (
    select job.kind,
           job.steps,
           coalesce(
             job.deck_id,
             case
               when job.kind = 'card'
                and job.plan ->> 'deck_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then (job.plan ->> 'deck_id')::uuid
             end
           ) as target_deck
    from public.ai_generation_jobs job
    where job.kind in ('deck', 'deck_remix', 'card')
      and jsonb_typeof(job.steps) = 'array'
  ) j
  cross join lateral jsonb_array_elements(j.steps) as s(step)
  where j.target_deck is not null
    and jsonb_typeof(s.step) = 'object'
    and s.step ->> 'card_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  order by j.target_deck, (s.step ->> 'card_id'), j.kind
) made
where dc.deck_id = made.deck_id
  and dc.card_id = made.card_id
  and dc.source is null
  and dc.scryfall_id is null;

alter table public.deck_cards enable trigger deck_cards_set_updated_at;
alter table public.deck_cards enable trigger deck_cards_sync_deck_update;

-- ===========================================================================
-- 3. Other creators' public cards (D3)
-- ===========================================================================

drop policy if exists "Deck cards: owners can insert" on public.deck_cards;
create policy "Deck cards: owners can insert"
  on public.deck_cards
  for insert
  with check (
    exists (
      select 1
      from public.decks d
      where d.id = deck_id
        and d.owner_id = (select auth.uid())
    )
    and (
      card_id is null
      or exists (
        select 1
        from public.cards c
        where c.id = card_id
          and (c.owner_id = (select auth.uid()) or c.visibility = 'public')
      )
    )
  );

-- The card rule of an UPDATE is guard_deck_card_link's (it sees OLD).
drop policy if exists "Deck cards: owners can update" on public.deck_cards;
create policy "Deck cards: owners can update"
  on public.deck_cards
  for update
  using (
    exists (
      select 1
      from public.decks d
      where d.id = deck_id
        and d.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.decks d
      where d.id = deck_id
        and d.owner_id = (select auth.uid())
    )
  );

create or replace function public.guard_deck_card_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.card_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.card_id is not distinct from old.card_id then
    return new;
  end if;
  -- SECURITY INVOKER: the caller's RLS on cards applies, so another
  -- creator's private card isn't found at all; an unlisted one is found and
  -- refused by the visibility test.
  if not exists (
    select 1
    from public.cards c
    where c.id = new.card_id
      and (c.owner_id = (select auth.uid()) or c.visibility = 'public')
  ) then
    raise exception 'deck_card_not_linkable: a deck links your own cards or another creator''s public card'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_deck_card_link() from public, anon, authenticated;

drop trigger if exists deck_cards_guard_card_link on public.deck_cards;
create trigger deck_cards_guard_card_link
  before insert or update of card_id on public.deck_cards
  for each row execute function public.guard_deck_card_link();

-- ===========================================================================
-- 4. The decklist commit: 0143's, every new row 'import'
-- ===========================================================================

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
  -- summed (two lines on one row must never overwrite each other). A merged
  -- row keeps its own source.
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

  -- New rows: ONE insert, in the list's order, after the deck's last
  -- position — each an 'import' (an entry's own "source" key is ignored).
  select coalesce(max(dc.position), -1) into v_last_position
  from public.deck_cards dc
  where dc.deck_id = p_deck_id;

  insert into public.deck_cards (
    deck_id, board, quantity, position, scryfall_id, name, set_code,
    collector_number, type_line, mana_cost, mana_value, color_identity,
    rarity, image_url, source
  )
  select p_deck_id, e.board, e.quantity,
         v_last_position + (row_number() over (order by t.ord))::integer,
         e.scryfall_id, e.name, e.set_code, e.collector_number, e.type_line,
         e.mana_cost, e.mana_value, coalesce(e.color_identity, '{}'::text[]),
         e.rarity, e.image_url, 'import'
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

-- ===========================================================================
-- 5. A card added to a deck: 0143's add_custom_deck_entry, with its origin
-- ===========================================================================

-- One main-board copy of a card, skipped when the card is already in the
-- deck on any board. p_source says who adds it (the creator's add, an
-- existing card linked, the AI); p_scryfall_id keeps the printing an AI
-- restyle was made from (p_name is then that printing's name, so the
-- copied decklist still names the real card). Returns true when a row was
-- added, false when the card was already there. SECURITY INVOKER: the
-- insert policy and guard_deck_card_link decide which card may be added.
drop function if exists public.add_custom_deck_entry(uuid, uuid, text);

create or replace function public.add_custom_deck_entry(
  p_deck_id uuid,
  p_card_id uuid,
  p_name text,
  p_source text default 'creator',
  p_scryfall_id text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_position integer;
begin
  -- The RPC adds a CARD (0143 let a NULL through: a name-only row with a
  -- card's source).
  if p_card_id is null then
    raise exception 'deck_entry_card_missing: add_custom_deck_entry adds a card; pass its id'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_source is null or p_source not in ('creator', 'link', 'ai_generate', 'ai_remix') then
    raise exception 'deck_entry_source_invalid: a card is added by the creator, a link or the AI'
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

  if exists (
    select 1 from public.deck_cards dc
    where dc.deck_id = p_deck_id and dc.card_id = p_card_id
  ) then
    return false;
  end if;

  select coalesce(max(dc.position), -1) + 1 into v_position
  from public.deck_cards dc
  where dc.deck_id = p_deck_id;

  insert into public.deck_cards (deck_id, card_id, name, board, quantity, position, source, scryfall_id)
  values (p_deck_id, p_card_id, p_name, 'main', 1, v_position, p_source, nullif(btrim(p_scryfall_id), ''));
  return true;
end;
$$;

revoke all on function public.add_custom_deck_entry(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.add_custom_deck_entry(uuid, uuid, text, text, text) to authenticated, service_role;

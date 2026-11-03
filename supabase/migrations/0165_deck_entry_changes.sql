-- 0165_deck_entry_changes.sql — a deck's change history (TODO DK5.13: "Undo
-- and history — change history with restore, Plus 30 days, Pro full").
--
-- NUMBERING: 0165 — after main's 0163 (#722) and #728's 0164 (decks: clone
-- and similar), which merges first.
--
-- 1. THE LOG. public.deck_entry_changes holds one row per change to a deck's
--    entries: an entry added (insert), taken out (delete), or its count,
--    board, card, printing or name changed (update) — with the entry AS IT
--    WAS (`before`) and AS IT IS (`after`): the fields a line is restored
--    from (lib/decks/entry-batch.ts RemovedEntry: name, board, quantity,
--    scryfall_id, card_id, source, featured_rank). A write that changes none
--    of the five fields a deck's list is made of (quantity, board, card_id,
--    scryfall_id, name) — a cover pick, a position, the printing's cached
--    columns — is not a change of the deck and is not logged.
--
-- 2. EVERY WRITE PATH, ONCE. The log is written by ONE row trigger on
--    deck_cards (log_deck_entry_change, AFTER INSERT / UPDATE / DELETE), not
--    by the actions: the decklist commit (import_deck_entries), a card added
--    (add_custom_deck_entry), the editor's batch updates and removals, the
--    restore of a removal, a link / unlink, a cover pick, a card's deletion
--    (card_id set null), the service role — whatever writes the row is
--    logged by the same code, and nothing can forget to. The actor is
--    auth.uid() (NULL for the service role / a seed).
--
-- 3. APPEND-ONLY, THE OWNER'S. No API role inserts, updates or deletes a
--    row (no grant; the trigger function is SECURITY DEFINER). authenticated
--    may SELECT, and RLS hands out only the rows of a deck the caller owns
--    NOW. No foreign key to decks: a deck being deleted takes its entries
--    with it, and the trigger skips a row whose deck is already gone (an FK
--    would make the cascade's own log rows fail the delete); what a deleted
--    deck leaves behind is pruned (4).
--
-- 4. RETENTION BY PLAN. Plus keeps 30 days, Pro (an admin, an active /
--    trialing Pro subscription, an unexpired Pro comp — viewer_is_pro()'s
--    rule, 0151, for the deck's OWNER: deck_history_owner_is_pro) keeps
--    everything. Free gets the session's undo / redo only (the History view
--    is Plus+), and its rows are kept 30 days like Plus — so an upgrade
--    shows the last month at once. Enforced twice: the read
--    (lib/decks/history-actions.ts reads getEntitlements and never returns
--    or restores past the plan's window) and prune_deck_entry_changes(),
--    which the weekly prune cron (/api/cron/prune-funnel-events) calls with
--    p_by_plan = the app's billing flag (billing off = everyone unlocked:
--    only orphans and the per-deck cap go).
--
-- 5. THE 30-DAY GRACE (owner 2026-11-02). An owner who STOPS being Pro
--    (past_due, cancelled, downgraded to Plus or free, a comp removed or
--    run out, an admin no longer one) keeps the rows older than the lower
--    plan's 30 days for 30 more days after Pro ENDED — back to Pro inside
--    them, the whole history is there again; after them the weekly prune
--    deletes them as for anyone not Pro. "When Pro ended" is never "now":
--    the profile holds no such date (a deleted subscription is written as
--    tier 'free' with no period end, a downgrade as tier 'plus', a past_due
--    one keeps its tier and period — lib/stripe/subscription-sync.ts), so
--    it is RECORDED at the moment it happens: deck_history_pro_ends, one
--    row per owner, stamped by a trigger on profiles
--    (stamp_deck_history_pro_end) on the write that takes the owner from
--    Pro to not-Pro — the Stripe sync's write of past_due / the deletion /
--    the lower tier, the admin's comp or is_admin change — and cleared when
--    the owner is Pro again. A Pro COMP that runs out by the clock changes
--    no row: its end is the profile's own comp_expires_at, read beside the
--    stamp (the later of the two). An owner who was never Pro, or whose Pro
--    ended before this migration, has no stamp: no grace (every history
--    row is younger than this migration, so none is past 30 days yet).
--
-- 6. A CAP PER DECK. However long a plan keeps them, a deck keeps at most
--    its newest DECK_HISTORY_MAX_ROWS (10,000 — lib/decks/deck-history.ts;
--    a unit test holds the two together) changes: a loop of writes can't
--    grow one deck's log without bound. Held in the trigger (every 64th log
--    row, the deck it was written for — amortised, so a write pays for a
--    cap scan 1 time in 64) and by the weekly prune (every deck).
--
-- 7. ONE RESTORE AT A TIME. "Restore this version" plans from the log and
--    writes through the batch actions — several requests, so no one
--    transaction holds the deck's entry lock across them. Instead the
--    restore CLAIMS the deck (claim_deck_restore): under the entry lock
--    (pg_advisory_xact_lock 'deck_entries:<deck>', 0143's) it re-reads the
--    deck's newest change, refuses when it is not the one the plan was made
--    from (another tab, an import, a restore wrote since: 'stale') or when
--    another restore of the deck holds it ('busy'), and else takes a
--    2-minute lease (deck_restore_leases) that the restore releases when
--    it is done (release_deck_restore).
--
-- Grants (CLAUDE.md "Every migration states its grants"; revoke first — a
-- new project grants nothing to anon / authenticated but its DEFAULT
-- PRIVILEGES give service_role everything on a new table, and prod's old
-- project auto-grants to every API role):
--   * deck_entry_changes: SELECT to authenticated (RLS: own decks), SELECT +
--     DELETE to service_role (revoked from it first: no INSERT / UPDATE /
--     TRUNCATE for any API role); nothing to anon.
--   * deck_history_pro_ends, deck_restore_leases: SELECT to service_role
--     only (written by the definer functions alone).
--   * log_deck_entry_change(), stamp_deck_history_pro_end(): no API role
--     (triggers only — revoked from service_role too, which its default
--     privileges would otherwise give EXECUTE). deck_history_owner_is_pro(),
--     cap_deck_entry_changes(), deck_entry_change_snapshot(): service_role.
--   * prune_deck_entry_changes(): service_role only.
--   * claim_deck_restore(), release_deck_restore(): authenticated (each
--     checks the caller owns the deck) and service_role.
--
-- Ships through a PR; never applied ad-hoc. Idempotent.

create table if not exists public.deck_entry_changes (
  id bigint generated always as identity primary key,
  deck_id uuid not null,
  entry_id uuid not null,
  op text not null check (op in ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb,
  actor_id uuid,
  -- The transaction that made it: one statement's rows read as one change.
  tx bigint not null default txid_current(),
  changed_at timestamptz not null default now(),
  constraint deck_entry_changes_shape check (
    (op = 'insert' and before is null and after is not null)
    or (op = 'delete' and before is not null and after is null)
    or (op = 'update' and before is not null and after is not null)
  )
);

comment on table public.deck_entry_changes is
  'A deck''s change history (0165, TODO DK5.13): one row per insert / update / delete of a deck_cards row that changes its list (quantity, board, card, printing, name), with the entry before and after. Written ONLY by the deck_cards trigger log_deck_entry_change; append-only for every API role; the deck owner reads it (RLS). Retention: Plus 30 days, Pro full (30 days more once Pro ends), at most 10,000 per deck — prune_deck_entry_changes().';

create index if not exists deck_entry_changes_deck_id_idx on public.deck_entry_changes (deck_id, id desc);
create index if not exists deck_entry_changes_changed_at_idx on public.deck_entry_changes (changed_at);

alter table public.deck_entry_changes enable row level security;

drop policy if exists "Deck owners read their decks' history" on public.deck_entry_changes;
create policy "Deck owners read their decks' history"
  on public.deck_entry_changes
  for select
  to authenticated
  using (
    exists (
      select 1 from public.decks d
      where d.id = deck_entry_changes.deck_id
        and d.owner_id = (select auth.uid())
    )
  );

-- The entry as a restore needs it.
create or replace function public.deck_entry_change_snapshot(r public.deck_cards)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'name', r.name,
    'board', r.board,
    'quantity', r.quantity,
    'scryfall_id', r.scryfall_id,
    'card_id', r.card_id,
    'source', r.source,
    'featured_rank', r.featured_rank
  );
$$;

-- The cap (6): the deck's newest p_max changes stay, older ones go.
create or replace function public.cap_deck_entry_changes(p_deck_id uuid, p_max integer default 10000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_floor bigint;
  v_deleted integer := 0;
begin
  select c.id into v_floor
  from public.deck_entry_changes c
  where c.deck_id = p_deck_id
  order by c.id desc
  offset greatest(coalesce(p_max, 10000), 1) - 1
  limit 1;
  if v_floor is null then
    return 0;
  end if;
  delete from public.deck_entry_changes c
  where c.deck_id = p_deck_id and c.id < v_floor;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.cap_deck_entry_changes(uuid, integer) is
  'Deck history cap (0165): keeps a deck''s newest p_max (10,000 = DECK_HISTORY_MAX_ROWS) changes and deletes the rest. Called by the log trigger (every 64th row) and the weekly prune.';

create or replace function public.log_deck_entry_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deck uuid := coalesce(new.deck_id, old.deck_id);
  v_id bigint;
begin
  -- A deck being deleted takes its history with it (no FK: see the header).
  if not exists (select 1 from public.decks d where d.id = v_deck) then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    if (new.quantity, new.board, new.card_id, new.scryfall_id, new.name)
       is not distinct from (old.quantity, old.board, old.card_id, old.scryfall_id, old.name)
       and new.deck_id is not distinct from old.deck_id then
      return null;
    end if;
  end if;

  insert into public.deck_entry_changes (deck_id, entry_id, op, before, after, actor_id)
  values (
    v_deck,
    coalesce(new.id, old.id),
    lower(tg_op),
    case when tg_op <> 'INSERT' then public.deck_entry_change_snapshot(old) end,
    case when tg_op <> 'DELETE' then public.deck_entry_change_snapshot(new) end,
    auth.uid()
  )
  returning id into v_id;

  -- The per-deck cap (6), amortised: one log row in 64 pays for the scan.
  if v_id % 64 = 0 then
    perform public.cap_deck_entry_changes(v_deck, 10000);
  end if;
  return null;
end;
$$;

comment on function public.log_deck_entry_change() is
  'deck_cards AFTER row trigger (0165): logs every insert / delete and every update that changes quantity, board, card_id, scryfall_id or name into deck_entry_changes. The ONE writer of the history; every 64th row also caps its deck (cap_deck_entry_changes).';

drop trigger if exists deck_cards_log_change on public.deck_cards;
create trigger deck_cards_log_change
  after insert or update or delete on public.deck_cards
  for each row execute function public.log_deck_entry_change();

-- ===========================================================================
-- 5. When Pro ended: the 30-day grace
-- ===========================================================================

-- viewer_is_pro()'s rule (0151), for any profile's columns.
create or replace function public.deck_history_owner_is_pro(
  p_is_admin boolean,
  p_tier text,
  p_status text,
  p_comp_tier text,
  p_comp_expires_at timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_is_admin
    or (p_tier = 'pro' and p_status in ('active', 'trialing'))
    or (p_comp_tier = 'pro' and (p_comp_expires_at is null or p_comp_expires_at > now())),
    false
  );
$$;

create table if not exists public.deck_history_pro_ends (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  ended_at timestamptz not null
);

comment on table public.deck_history_pro_ends is
  'When an owner stopped being Pro (0165, the 30-day deck-history grace): stamped by stamp_deck_history_pro_end on the profile write that took them from Pro to not-Pro, cleared when they are Pro again. Read by prune_deck_entry_changes only.';

alter table public.deck_history_pro_ends enable row level security;

create or replace function public.stamp_deck_history_pro_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.deck_history_owner_is_pro(new.is_admin, new.subscription_tier, new.subscription_status, new.comp_tier, new.comp_expires_at) then
    delete from public.deck_history_pro_ends e where e.owner_id = new.id;
  elsif public.deck_history_owner_is_pro(old.is_admin, old.subscription_tier, old.subscription_status, old.comp_tier, old.comp_expires_at) then
    insert into public.deck_history_pro_ends (owner_id, ended_at)
    values (new.id, now())
    on conflict (owner_id) do update set ended_at = excluded.ended_at;
  elsif old.comp_tier = 'pro' and old.comp_expires_at is not null and old.comp_expires_at <= now()
    and (new.comp_tier is distinct from old.comp_tier or new.comp_expires_at is distinct from old.comp_expires_at) then
    -- A Pro comp that ran out by the clock is already "not Pro" in OLD, so
    -- the branch above never sees it end; and the write that clears or
    -- changes it takes away the prune's comp_expires_at fallback. Keep its
    -- expiry as the day Pro ended (a later stamp wins).
    insert into public.deck_history_pro_ends as e (owner_id, ended_at)
    values (new.id, old.comp_expires_at)
    on conflict (owner_id) do update set ended_at = greatest(e.ended_at, excluded.ended_at);
  end if;
  return null;
end;
$$;

comment on function public.stamp_deck_history_pro_end() is
  'profiles AFTER UPDATE trigger (0165): stamps deck_history_pro_ends when the write takes the owner from Pro to not-Pro (past_due, a cancellation, a downgrade, a comp or admin change), clears it when they are Pro again.';

drop trigger if exists profiles_stamp_deck_history_pro_end on public.profiles;
create trigger profiles_stamp_deck_history_pro_end
  after update of is_admin, subscription_tier, subscription_status, comp_tier, comp_expires_at on public.profiles
  for each row execute function public.stamp_deck_history_pro_end();

-- ===========================================================================
-- Retention (4, 5, 6). Returns the rows deleted.
-- ===========================================================================

-- An earlier draft of this file had a 2-argument prune (never merged).
drop function if exists public.prune_deck_entry_changes(integer, boolean);

create or replace function public.prune_deck_entry_changes(
  p_keep_days integer default 30,
  p_by_plan boolean default true,
  p_grace_days integer default 30,
  p_max_rows integer default 10000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orphans integer := 0;
  v_aged integer := 0;
  v_capped integer := 0;
  v_deck uuid;
begin
  delete from public.deck_entry_changes c
  where not exists (select 1 from public.decks d where d.id = c.deck_id);
  get diagnostics v_orphans = row_count;

  if p_by_plan then
    delete from public.deck_entry_changes c
    using public.decks d
    left join public.profiles p on p.id = d.owner_id
    left join public.deck_history_pro_ends e on e.owner_id = d.owner_id
    where d.id = c.deck_id
      and c.changed_at < now() - make_interval(days => greatest(coalesce(p_keep_days, 30), 1))
      and not public.deck_history_owner_is_pro(p.is_admin, p.subscription_tier, p.subscription_status, p.comp_tier, p.comp_expires_at)
      -- The grace (5): Pro ended inside the last p_grace_days — the stamp,
      -- or a Pro comp run out by the clock — keeps the older rows.
      and coalesce(
        greatest(
          e.ended_at,
          case when p.comp_tier = 'pro' and p.comp_expires_at <= now() then p.comp_expires_at end
        ),
        '-infinity'::timestamptz
      ) < now() - make_interval(days => greatest(coalesce(p_grace_days, 30), 0));
    get diagnostics v_aged = row_count;
  end if;

  -- The cap (6), for every deck over it.
  for v_deck in
    select c.deck_id from public.deck_entry_changes c
    group by c.deck_id
    having count(*) > greatest(coalesce(p_max_rows, 10000), 1)
  loop
    v_capped := v_capped + public.cap_deck_entry_changes(v_deck, p_max_rows);
  end loop;

  return v_orphans + v_aged + v_capped;
end;
$$;

comment on function public.prune_deck_entry_changes(integer, boolean, integer, integer) is
  'Deck history retention (0165): drops rows of decks that no longer exist; with p_by_plan, rows older than p_keep_days (30) of every deck whose owner is not Pro (viewer_is_pro''s rule, 0151, for the owner) unless Pro ended inside the last p_grace_days (30: deck_history_pro_ends, or a Pro comp''s expiry); and every deck''s changes past its newest p_max_rows (10,000). Service role only — the weekly prune cron.';

-- ===========================================================================
-- 7. One restore at a time
-- ===========================================================================

create table if not exists public.deck_restore_leases (
  deck_id uuid primary key references public.decks (id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null
);

comment on table public.deck_restore_leases is
  'A "Restore this version" in progress (0165): one per deck, 2 minutes at most. Written by claim_deck_restore / release_deck_restore only.';

alter table public.deck_restore_leases enable row level security;

-- Claims the deck for a restore planned from change p_head (NULL: an empty
-- log). {"ok": true, "token": …} | {"ok": false, "reason": "not_found" |
-- "stale" | "busy"}.
create or replace function public.claim_deck_restore(p_deck_id uuid, p_head bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_head bigint;
  v_token uuid := gen_random_uuid();
begin
  if auth.uid() is null
     or not exists (select 1 from public.decks d where d.id = p_deck_id and d.owner_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- The deck's entry lock (0143): no RPC entry write of this deck runs
  -- while the head is read and the lease taken.
  perform pg_advisory_xact_lock(hashtextextended('deck_entries:' || p_deck_id::text, 0));

  if exists (select 1 from public.deck_restore_leases l where l.deck_id = p_deck_id and l.expires_at > now()) then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;

  select max(c.id) into v_head from public.deck_entry_changes c where c.deck_id = p_deck_id;
  if v_head is distinct from p_head then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;

  insert into public.deck_restore_leases (deck_id, token, expires_at)
  values (p_deck_id, v_token, now() + interval '2 minutes')
  on conflict (deck_id) do update set token = excluded.token, expires_at = excluded.expires_at;
  return jsonb_build_object('ok', true, 'token', v_token);
end;
$$;

create or replace function public.release_deck_restore(p_deck_id uuid, p_token uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.deck_restore_leases l
  where l.deck_id = p_deck_id
    and l.token = p_token
    and exists (select 1 from public.decks d where d.id = p_deck_id and d.owner_id = auth.uid());
$$;

comment on function public.claim_deck_restore(uuid, bigint) is
  'Deck history (0165): under the deck''s entry lock, re-reads its newest change and takes a 2-minute restore lease when it is still p_head and no other restore holds the deck. The caller must own the deck.';
comment on function public.release_deck_restore(uuid, uuid) is
  'Deck history (0165): ends the caller''s restore lease (by its token).';

-- ===========================================================================
-- Grants
-- ===========================================================================

revoke all on table public.deck_entry_changes from public, anon, authenticated, service_role;
grant select on table public.deck_entry_changes to authenticated;
grant select, delete on table public.deck_entry_changes to service_role;

revoke all on table public.deck_history_pro_ends from public, anon, authenticated, service_role;
grant select on table public.deck_history_pro_ends to service_role;

revoke all on table public.deck_restore_leases from public, anon, authenticated, service_role;
grant select on table public.deck_restore_leases to service_role;

revoke all on function public.deck_entry_change_snapshot(public.deck_cards) from public, anon, authenticated;
grant execute on function public.deck_entry_change_snapshot(public.deck_cards) to service_role;

revoke all on function public.log_deck_entry_change() from public, anon, authenticated, service_role;
revoke all on function public.stamp_deck_history_pro_end() from public, anon, authenticated, service_role;

revoke all on function public.deck_history_owner_is_pro(boolean, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.deck_history_owner_is_pro(boolean, text, text, text, timestamptz) to service_role;

revoke all on function public.cap_deck_entry_changes(uuid, integer) from public, anon, authenticated;
grant execute on function public.cap_deck_entry_changes(uuid, integer) to service_role;

revoke all on function public.prune_deck_entry_changes(integer, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.prune_deck_entry_changes(integer, boolean, integer, integer) to service_role;

revoke all on function public.claim_deck_restore(uuid, bigint) from public, anon;
grant execute on function public.claim_deck_restore(uuid, bigint) to authenticated, service_role;

revoke all on function public.release_deck_restore(uuid, uuid) from public, anon;
grant execute on function public.release_deck_restore(uuid, uuid) to authenticated, service_role;

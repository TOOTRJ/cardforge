-- 0164_deck_entry_changes.sql — a deck's change history (TODO DK5.13: "Undo
-- and history — change history with restore, Plus 30 days, Pro full").
--
-- NUMBERING: written as 0164 while PR #722 claims 0163; renumbered at merge
-- if another migration lands first.
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
--    rule, 0151, for the deck's OWNER) keeps everything. Free gets the
--    session's undo / redo only (the History view is Plus+), and its rows
--    are kept 30 days like Plus — so an upgrade shows the last month at
--    once. Enforced twice: the read (lib/decks/history-actions.ts reads
--    getEntitlements and never returns or restores past the plan's window)
--    and prune_deck_entry_changes(), which the weekly prune cron
--    (/api/cron/prune-funnel-events) calls with p_by_plan = the app's
--    billing flag (billing off = everyone unlocked: only orphans go).
--
-- Grants (CLAUDE.md "Every migration states its grants"; revoke first — a
-- new project grants nothing, prod's old one auto-grants):
--   * deck_entry_changes: SELECT to authenticated (RLS: own decks), SELECT +
--     DELETE to service_role; nothing to anon; no INSERT / UPDATE anywhere.
--   * log_deck_entry_change(): no API role (trigger only).
--   * prune_deck_entry_changes(): service_role only.
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
  'A deck''s change history (0164, TODO DK5.13): one row per insert / update / delete of a deck_cards row that changes its list (quantity, board, card, printing, name), with the entry before and after. Written ONLY by the deck_cards trigger log_deck_entry_change; append-only for every API role; the deck owner reads it (RLS). Retention: Plus 30 days, Pro full — prune_deck_entry_changes().';

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

create or replace function public.log_deck_entry_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deck uuid := coalesce(new.deck_id, old.deck_id);
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
  );
  return null;
end;
$$;

comment on function public.log_deck_entry_change() is
  'deck_cards AFTER row trigger (0164): logs every insert / delete and every update that changes quantity, board, card_id, scryfall_id or name into deck_entry_changes. The ONE writer of the history.';

drop trigger if exists deck_cards_log_change on public.deck_cards;
create trigger deck_cards_log_change
  after insert or update or delete on public.deck_cards
  for each row execute function public.log_deck_entry_change();

-- Retention (see 4). Returns the rows deleted.
create or replace function public.prune_deck_entry_changes(
  p_keep_days integer default 30,
  p_by_plan boolean default true
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orphans integer := 0;
  v_aged integer := 0;
begin
  delete from public.deck_entry_changes c
  where not exists (select 1 from public.decks d where d.id = c.deck_id);
  get diagnostics v_orphans = row_count;

  if p_by_plan then
    delete from public.deck_entry_changes c
    using public.decks d
    left join public.profiles p on p.id = d.owner_id
    where d.id = c.deck_id
      and c.changed_at < now() - make_interval(days => greatest(coalesce(p_keep_days, 30), 1))
      and not coalesce(
        p.is_admin
        or (p.subscription_tier = 'pro' and p.subscription_status in ('active', 'trialing'))
        or (p.comp_tier = 'pro' and (p.comp_expires_at is null or p.comp_expires_at > now())),
        false
      );
    get diagnostics v_aged = row_count;
  end if;

  return v_orphans + v_aged;
end;
$$;

comment on function public.prune_deck_entry_changes(integer, boolean) is
  'Deck history retention (0164): drops rows of decks that no longer exist and, with p_by_plan, rows older than p_keep_days (30) of every deck whose owner is not Pro (viewer_is_pro''s rule, 0151, for the owner). Service role only — the weekly prune cron.';

-- ===========================================================================
-- Grants
-- ===========================================================================

revoke all on table public.deck_entry_changes from public, anon, authenticated;
grant select on table public.deck_entry_changes to authenticated;
grant select, delete on table public.deck_entry_changes to service_role;

revoke all on function public.deck_entry_change_snapshot(public.deck_cards) from public, anon, authenticated;
grant execute on function public.deck_entry_change_snapshot(public.deck_cards) to service_role;

revoke all on function public.log_deck_entry_change() from public, anon, authenticated;

revoke all on function public.prune_deck_entry_changes(integer, boolean) from public, anon, authenticated;
grant execute on function public.prune_deck_entry_changes(integer, boolean) to service_role;

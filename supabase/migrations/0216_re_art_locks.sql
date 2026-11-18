-- 0216_re_art_locks.sql — Re-art deck (beta tool `re-art-deck`, 0191): a
-- card can be LOCKED on a deck, so nothing the tool does changes its
-- picture.
--
-- A maker who likes one card's picture had no way to keep a run over the
-- deck, a sample, or an undo from touching it. Owner 2026-11-13 (the
-- extras): multi-select, filter and lock.
--
-- deck_reart_locks — one row per locked deck ENTRY (a real card's entry has
-- no card of the maker's until a run makes one, so the lock is the entry's,
-- like a card's own words — 0209). While the row is there the tool leaves
-- that card as it is: a run and a sample skip it (nothing is charged), a
-- re-roll, an earlier picture, "old art back" and an undo of a run are
-- refused until it is unlocked. The card's editor is not the tool: a locked
-- card can still be edited there.
--
--   * Keyed on ONE column (`entry_id`): never a composite primary key over
--     its two foreign keys, which the API would read as a link between
--     decks and deck_cards and refuse every embedded read between them
--     (the 0209 incident; 0210; CLAUDE.md).
--   * Written by the server only, as the tool's other tables are; the owner
--     reads their own while the tool is open to them. The deck is the row
--     owner's own and the entry is one of that deck's, whoever writes.
--   * It goes with its entry, its deck and its owner.
--
-- No stored card, style or painted row changes, and nothing is charged for.
-- Grants are explicit (0097). Idempotent. Ships through a PR; never applied
-- ad-hoc.

create table if not exists public.deck_reart_locks (
  entry_id uuid primary key references public.deck_cards (id) on delete cascade,
  deck_id uuid not null references public.decks (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists deck_reart_locks_deck_idx on public.deck_reart_locks (deck_id);
create index if not exists deck_reart_locks_owner_idx on public.deck_reart_locks (owner_id);

comment on table public.deck_reart_locks is
  'Re-art deck beta tool (0216): the deck entries whose picture the tool leaves as it is (a run and a sample skip them; a re-roll, an earlier picture, old art back and an undo are refused until unlocked). Written by the server only; the owner reads their own while has_tool_access(''re-art-deck'').';

alter table public.deck_reart_locks enable row level security;

drop policy if exists "Deck re-art locks: owner reads" on public.deck_reart_locks;
create policy "Deck re-art locks: owner reads"
  on public.deck_reart_locks for select
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('re-art-deck'));

-- The deck is the row owner's own, and the entry is one of that deck's
-- (deck_reart_prompts' rule, 0209).
create or replace function public.deck_reart_locks_check_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.decks d where d.id = new.deck_id and d.owner_id = new.owner_id
  ) or not exists (
    select 1 from public.deck_cards dc where dc.id = new.entry_id and dc.deck_id = new.deck_id
  ) then
    raise exception 'deck_reart_lock_not_owner'
      using errcode = '42501',
            hint = 'A Re-art lock belongs to an entry of the owner''s own deck.';
  end if;
  return new;
end;
$$;

drop trigger if exists deck_reart_locks_check_owner on public.deck_reart_locks;
create trigger deck_reart_locks_check_owner
  before insert or update on public.deck_reart_locks
  for each row execute function public.deck_reart_locks_check_owner();

revoke all on function public.deck_reart_locks_check_owner() from public, anon, authenticated;

revoke all on public.deck_reart_locks from public, anon, authenticated;
grant select on public.deck_reart_locks to authenticated;
revoke all on public.deck_reart_locks from service_role;
grant select, insert, delete on public.deck_reart_locks to service_role;

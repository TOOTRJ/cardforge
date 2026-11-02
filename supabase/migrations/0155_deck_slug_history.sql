-- 0155_deck_slug_history.sql — a renamed deck's old links keep working
-- (2026-10-28 deck plan: TODO DK5.14, owner-approved 2026-10-30).
--
-- A deck's URL is /deck/<slug>, and a rename gives the deck a new slug
-- (lib/decks/actions.ts updateDeckAction: the slug follows the new title).
-- Every link shared before the rename — a post, a bookmark, a search
-- engine's index — then answered a 404. Now the database remembers each slug
-- a deck gave up, and the deck page answers a 308 to the deck's CURRENT slug
-- (lib/decks/slug-history.ts; one hop however many renames came between).
--
-- 1. deck_slug_history (old_slug PRIMARY KEY, deck_id, created_at). A row is
--    written by ONE trigger, decks_record_slug_change (AFTER UPDATE OF slug):
--    the slug the deck left, and — when the deck takes one of its OWN old
--    slugs back — that row removed (a live slug is never also a redirect).
--    Nothing else writes it: no API role holds a write grant and the table
--    has no write policy. A deleted deck takes its rows with it (cascade):
--    the old links then 404 like the deck's own. A deck keeps its 20 NEWEST
--    old slugs (the trigger drops the oldest past that): renaming a deck over
--    and over can't hoard names — every one of them would be reserved (2).
--
-- 2. AN OLD SLUG IS RESERVED WHILE IT REDIRECTS. decks_reserve_old_slugs
--    (BEFORE INSERT OR UPDATE OF slug) refuses a slug that another deck's
--    history holds, with the unique-violation code (23505) the deck actions
--    already retry with a numeric suffix ("dragons" → "dragons-2"). The
--    alternative — a live slug wins and the history row goes quiet — would
--    let anyone take over every link shared to a renamed deck by naming a
--    new deck the same: the readers of those links would land on a stranger's
--    deck. Reserving costs a name a deck gave up, nothing more; the deck that
--    gave it up may always take it back. The trigger is the database's, so a
--    write that skips the app (the service role, an AI job) is held to it
--    too. The deck page still reads the LIVE slug first, so were a row ever
--    to share a live slug (it can't through these triggers), the live deck
--    wins. Both triggers take a transaction-level advisory lock on the slug
--    they test or record (pg_advisory_xact_lock(hashtext(slug))) BEFORE the
--    test: under READ COMMITTED, deck A renaming x → y while deck B renames
--    → x could otherwise each miss the other's uncommitted row, and A's old
--    links would land on B. With the lock, B's test waits for A's commit and
--    then sees A's row.
--
-- 3. NO ROW IS LISTABLE: EVERY NON-OWNER READ NAMES ITS OLD SLUG.
--    deck_slug_history_readable(deck, old slug) — a definer, since an
--    unlisted deck is invisible to a visitor's own decks read until the
--    request names it — admits a row to the deck's OWNER, and to anyone else
--    only when the deck is PUBLIC or UNLISTED and the request names that
--    row's OLD slug in 0151's `x-pipglyph-deck` header
--    (requested_deck_link()) — the link the visitor already holds. A public
--    deck's history is NOT a list: the slugs a deck had while it was private
--    or unlisted ("my-secret-plan-against-bob", later renamed and made
--    public) would otherwise be handed to anyone. A PRIVATE deck's history is
--    its owner's alone, header or not. The app (lib/decks/slug-history.ts)
--    always sends the old slug, then reads the deck by its id (0151: the id
--    is a link too) to learn the slug to redirect to.
--
-- Grants (new projects auto-grant nothing — CLAUDE.md): deck_slug_history
-- SELECT to anon and authenticated (RLS above), everything to service_role;
-- deck_slug_history_readable() EXECUTE to anon, authenticated and
-- service_role (the policy calls it as the caller); the two trigger functions
-- no API role's.
--
-- Deploy: the new code on a database without this migration reads no history
-- (the query errors, read as "no redirect" — a 404 as before) and the slug
-- still follows a rename; the old code on a database with it never renames a
-- slug (its form re-sent the stored one). Ships through a PR; never applied
-- ad-hoc. Idempotent.

-- ===========================================================================
-- 1. The table
-- ===========================================================================

create table if not exists public.deck_slug_history (
  old_slug text primary key
    check (char_length(old_slug) between 1 and 80 and old_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  deck_id uuid not null references public.decks (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.deck_slug_history is
  'Each slug a deck gave up on a rename, so /deck/<old slug> 308s to the deck''s current slug. Written by decks_record_slug_change only; an old slug is reserved for its deck while it is here (0155).';

create index if not exists deck_slug_history_deck_id_idx
  on public.deck_slug_history (deck_id);

alter table public.deck_slug_history enable row level security;

-- ===========================================================================
-- 2. The triggers
-- ===========================================================================

create or replace function public.reserve_deck_old_slugs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialise every test and record of this slug (see 2. above).
  perform pg_advisory_xact_lock(hashtext(new.slug));
  if exists (
    select 1 from public.deck_slug_history h
    where h.old_slug = new.slug and h.deck_id <> new.id
  ) then
    raise exception 'deck slug "%" still redirects to a renamed deck', new.slug
      using errcode = '23505',
            constraint = 'deck_slug_history_pkey';
  end if;
  return new;
end;
$$;

drop trigger if exists decks_reserve_old_slugs on public.decks;
create trigger decks_reserve_old_slugs
  before insert or update of slug on public.decks
  for each row execute function public.reserve_deck_old_slugs();

create or replace function public.record_deck_slug_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialise against a reservation test of the slug being left (2. above).
  perform pg_advisory_xact_lock(hashtext(old.slug));

  -- The deck took one of its own old slugs back: it is live again.
  delete from public.deck_slug_history
  where old_slug = new.slug and deck_id = new.id;

  -- clock_timestamp, not now(): several renames in one transaction keep
  -- their order for the cap below.
  insert into public.deck_slug_history (old_slug, deck_id, created_at)
  values (old.slug, new.id, clock_timestamp())
  on conflict (old_slug) do update
    set created_at = excluded.created_at
    where public.deck_slug_history.deck_id = excluded.deck_id;

  -- At most 20 old slugs a deck: the oldest go (their links then 404, and
  -- the names are free again).
  delete from public.deck_slug_history h
  where h.deck_id = new.id
    and h.old_slug in (
      select k.old_slug from public.deck_slug_history k
      where k.deck_id = new.id
      order by k.created_at desc, k.old_slug
      offset 20
    );
  return null;
end;
$$;

drop trigger if exists decks_record_slug_change on public.decks;
create trigger decks_record_slug_change
  after update of slug on public.decks
  for each row
  when (old.slug is distinct from new.slug)
  execute function public.record_deck_slug_change();

-- ===========================================================================
-- 3. Who reads a row
-- ===========================================================================

create or replace function public.deck_slug_history_readable(p_deck uuid, p_old_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select d.owner_id = auth.uid()
        or (
          d.visibility in ('public', 'unlisted')
          and public.requested_deck_link() = p_old_slug
        )
    from public.decks d
    where d.id = p_deck
  ), false);
$$;

comment on function public.deck_slug_history_readable(uuid, text) is
  'Whether the caller may read a deck_slug_history row: the deck is theirs, or it is public / unlisted and the request names THAT OLD slug in x-pipglyph-deck (0151''s link rule) — no row is listable. Never a private deck''s for anyone but its owner (0155).';

drop policy if exists "Deck slug history: readable where its deck's link is" on public.deck_slug_history;
create policy "Deck slug history: readable where its deck's link is"
  on public.deck_slug_history
  for select
  using (public.deck_slug_history_readable(deck_id, old_slug));

-- ===========================================================================
-- Grants
-- ===========================================================================

revoke all on table public.deck_slug_history from public, anon, authenticated;
grant select on table public.deck_slug_history to anon, authenticated;
grant select, insert, update, delete on table public.deck_slug_history to service_role;

revoke all on function public.deck_slug_history_readable(uuid, text) from public;
grant execute on function public.deck_slug_history_readable(uuid, text) to anon, authenticated, service_role;

revoke all on function public.reserve_deck_old_slugs() from public, anon, authenticated;
revoke all on function public.record_deck_slug_change() from public, anon, authenticated;

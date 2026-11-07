-- 0184_token_kits.sql — the Token Kit beta tool's saved kits (tool
-- `token-kit`, lib/tools/catalog.ts; /dashboard/tools/token-kit).
--
-- A kit is every token, emblem and helper card a deck (or a pasted list)
-- makes, drawn in one design and printed through the existing print paths.
-- Kit tokens are NOT cards: they never count toward the saved-card limit
-- (0104's trigger reads `cards` only) — "Save to My Cards" makes one a
-- normal card through createCardAction.
--
-- What is stored is only what the maker chose and what they paid for, so a
-- reload keeps it: the kit's look (`settings`) and, per token (keyed by the
-- token's face key, lib/tools/token-kit/collect.ts kitFaceKey), whether it is
-- in the kit, how many copies, and its picture — an upload or a paid AI
-- picture in the owner's own card-art folder (`items`). The tokens
-- themselves are rebuilt from the source on every open (Scryfall's
-- all_parts + the deck's own cards), never stored.
--
-- One row per (owner, source): `deck:<uuid>` for one of the owner's decks
-- (deck_id kept beside it; a deleted deck leaves the kit, deck_id NULL) or
-- `list:<hash>` for a pasted list (`source_text` holds the list).
--
-- Access: the owner's own rows, and only while the tool is open to them
-- (has_tool_access, 0182) — a tester whose grant ends keeps the rows but
-- reads none until the tool is theirs again. The art URLs are read by the
-- storage orphan sweep like every other text column
-- (scripts/lib/storage-orphans.mjs URL_SOURCES lists the table).
--
-- Grants are explicit (0097). Idempotent. Ships through a PR; never applied
-- ad-hoc.

create table if not exists public.token_kits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  source_key text not null
    check (source_key ~ '^(deck:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|list:[0-9a-f]{16,64})$'),
  deck_id uuid references public.decks (id) on delete set null,
  title text check (title is null or char_length(title) between 1 and 120),
  source_text text check (source_text is null or char_length(source_text) <= 100000),
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 4000),
  items jsonb not null default '{}'::jsonb
    check (jsonb_typeof(items) = 'object' and octet_length(items::text) <= 200000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_key)
);

create index if not exists token_kits_owner_recent_idx
  on public.token_kits (owner_id, updated_at desc);
create index if not exists token_kits_deck_idx
  on public.token_kits (deck_id)
  where deck_id is not null;

comment on table public.token_kits is
  'Token Kit beta tool (0184): one saved kit per (owner, source) — its look (settings) and per-token choices and pictures (items, keyed by the token''s face key). Tokens are rebuilt from the source on every open. Never cards: no card limit. Owner rows only, while has_tool_access(''token-kit'').';

alter table public.token_kits enable row level security;

drop policy if exists "Token kits: owner reads" on public.token_kits;
create policy "Token kits: owner reads"
  on public.token_kits for select
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('token-kit'));

-- A kit's deck is one of the owner's own.
drop policy if exists "Token kits: owner inserts" on public.token_kits;
create policy "Token kits: owner inserts"
  on public.token_kits for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.has_tool_access('token-kit')
    and (deck_id is null or exists (
      select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())
    ))
  );

drop policy if exists "Token kits: owner updates" on public.token_kits;
create policy "Token kits: owner updates"
  on public.token_kits for update
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('token-kit'))
  with check (
    owner_id = (select auth.uid())
    and public.has_tool_access('token-kit')
    and (deck_id is null or exists (
      select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())
    ))
  );

drop policy if exists "Token kits: owner deletes" on public.token_kits;
create policy "Token kits: owner deletes"
  on public.token_kits for delete
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('token-kit'));

-- updated_at is the server's (the app's "recent kits" order).
create or replace function public.token_kits_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.owner_id := old.owner_id;
    new.source_key := old.source_key;
  end if;
  return new;
end;
$$;

drop trigger if exists token_kits_touch on public.token_kits;
create trigger token_kits_touch
  before insert or update on public.token_kits
  for each row execute function public.token_kits_touch();

revoke all on function public.token_kits_touch() from public, anon, authenticated;

revoke all on public.token_kits from public, anon, authenticated;
grant select, insert, update, delete on public.token_kits to authenticated;
grant select, insert, update, delete on public.token_kits to service_role;

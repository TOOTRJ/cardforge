-- 0187_set_symbols.sql — the Set Symbol Studio beta tool's symbols (tool
-- `set-symbol-studio`, lib/tools/catalog.ts; /dashboard/tools/set-symbol-studio).
--
-- (0186 is held for the Bulk Customize tool, built in another branch; if it
-- ships with no migration this file is renamed 0186 before merge.)
--
-- A symbol is one cut-out shape — drawn by FLUX from a prompt, or brought by
-- its maker with the background keyed away (no model) — and the files the
-- studio painted from it: the four rarity looks, a "follows the rarity"
-- file, a plain one, a watermark and the source picture. The files live in
-- the maker's own storage folders (set-covers, card-art; written by the
-- service role through lib/media/user-storage.ts) under ONE version id
-- (`version`): a re-cut writes a new version and points the row at it, so
-- a card already using an older version keeps drawing it (a card holds its
-- own URL — `cards.set_icon_url` / `cards.watermark`). `files` holds the
-- current version's public URLs, which the storage orphan sweep reads like
-- every other text column (scripts/lib/storage-orphans.mjs URL_SOURCES).
--
-- A symbol is NOT a card and never counts toward the saved-card limit.
--
-- Access: the owner's own rows, and only while the tool is open to them
-- (has_tool_access, 0182) — a tester whose grant ends keeps the rows (and
-- every card keeps its pictures) but reads none until the tool is theirs
-- again. Rows are WRITTEN by the server alone (the generate route and the
-- upload / re-cut actions, after their own access, credit and moderation
-- checks): the URLs in `files` must be the server's own uploads. The owner
-- may rename (the `name` column alone) and delete a row; deleting a row
-- never deletes a file a card uses (the sweep decides, by reference).
--
-- Grants are explicit (0097). Idempotent. Ships through a PR; never applied
-- ad-hoc.

create table if not exists public.set_symbols (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  source text not null check (source in ('ai', 'upload')),
  prompt text check (prompt is null or char_length(prompt) between 1 and 400),
  style text check (style is null or style in ('bold', 'geometric', 'ornate', 'runic')),
  cutout jsonb not null default '{}'::jsonb
    check (jsonb_typeof(cutout) = 'object' and octet_length(cutout::text) <= 1000),
  version uuid not null,
  files jsonb not null
    check (jsonb_typeof(files) = 'object' and octet_length(files::text) <= 6000),
  legibility numeric(4, 3) check (legibility is null or (legibility >= 0 and legibility <= 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists set_symbols_owner_recent_idx
  on public.set_symbols (owner_id, updated_at desc);

comment on table public.set_symbols is
  'Set Symbol Studio beta tool (0187): a maker''s set symbols — the current version''s painted files (files: auto/common/uncommon/rare/mythic/plain in set-covers, watermark in card-art, the source) and how they were cut (cutout). Written by the server only; the owner reads, renames and deletes while has_tool_access(''set-symbol-studio''). Never cards: no card limit.';

alter table public.set_symbols enable row level security;

drop policy if exists "Set symbols: owner reads" on public.set_symbols;
create policy "Set symbols: owner reads"
  on public.set_symbols for select
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('set-symbol-studio'));

drop policy if exists "Set symbols: owner renames" on public.set_symbols;
create policy "Set symbols: owner renames"
  on public.set_symbols for update
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('set-symbol-studio'))
  with check (owner_id = (select auth.uid()) and public.has_tool_access('set-symbol-studio'));

drop policy if exists "Set symbols: owner deletes" on public.set_symbols;
create policy "Set symbols: owner deletes"
  on public.set_symbols for delete
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('set-symbol-studio'));

-- No insert policy: an API role never writes a row (the service role does).

-- updated_at is the server's (the library's "recent first" order); an
-- update never moves a row to another owner or rewrites its birth.
create or replace function public.set_symbols_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.owner_id := old.owner_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_symbols_touch on public.set_symbols;
create trigger set_symbols_touch
  before insert or update on public.set_symbols
  for each row execute function public.set_symbols_touch();

revoke all on function public.set_symbols_touch() from public, anon, authenticated;

revoke all on public.set_symbols from public, anon, authenticated;
grant select, delete on public.set_symbols to authenticated;
grant update (name) on public.set_symbols to authenticated;
grant select, insert, update, delete on public.set_symbols to service_role;

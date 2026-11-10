-- 0193_custom_symbols.sql — new mana symbols (tool `custom-symbols`,
-- lib/tools/catalog.ts; /dashboard/tools/custom-symbols). PR 1 of the "new
-- pips" series: the table and its manager. Nothing draws a symbol yet.
--
-- A custom symbol is a mana symbol beyond the six, written {*CODE} in a cost
-- or in rules text (CODE: a letter, then up to five letters or digits —
-- stored uppercase). It is its maker's: {*CODE} on a card always means the
-- CARD OWNER's row with that code, so every viewer of the card draws the
-- owner's picture (the read policy is open to everyone, like custom_pips',
-- 0039). Its rules meaning is declared, never guessed: a mana value (a whole
-- number, 0–20) and a base colour (W U B R G) or none (colourless).
--
-- The picture is a 256 px PNG in the owner's custom-pips folder,
-- `sym-<uuid>.png` (a NEW name on every replace, so no CDN copy of an older
-- picture answers for it), written by the server through
-- lib/media/user-storage.ts after the upload rules (rate limit, byte sniff,
-- prepareUploadBytes, the image scan). `image_url` passes 0127's media guard
-- as kind 'pip' — the owner's own custom-pips objects only.
--
-- A code is never re-pointed while a card names it: (owner_id, code) is
-- unique across EVERY row, removed ones too, and the code can't change after
-- insert. "Remove" is a TOMBSTONE (`deleted_at`) whenever one of the owner's
-- cards still names {*CODE} — the row stays readable, so those cards keep
-- drawing it and the maker can restore it — and a real delete only when no
-- card does: the delete trigger below refuses an API role's delete of a
-- symbol a card names (`custom_symbol_in_use`). That check is not a lock: a
-- card saved naming the code in the same instant as its delete (or from a
-- tab opened before it) can still name a code that is gone, so the renderers
-- draw an unknown code as a placeholder (PR 2), and a symbol made later with
-- that code is the one the card then draws.
--
-- Caps: 20 live symbols per owner and 60 rows in all, tombstones included
-- (lib/symbols/symbols.ts LIVE_SYMBOL_CAP / SYMBOL_ROW_CAP — a unit test
-- holds the two together), checked under a per-owner advisory lock on every
-- insert and every restore.
--
-- Access: anyone reads (a card that uses a symbol draws for every viewer,
-- whatever the tool's stage); the owner inserts, edits, removes and restores
-- only while the tool is open to them (has_tool_access, 0182). A tester
-- whose grant ends keeps every symbol drawing but can't change one.
--
-- No tool_releases row: like every new tool it ships admin-only on
-- production plus the testers an admin grants at /admin/tools, until an
-- admin releases it (tester grants for previews live in the seed alone).
--
-- Grants are explicit (0097). Idempotent. Ships through a PR; never applied
-- ad-hoc.

-- ===========================================================================
-- 1. custom_symbols
-- ===========================================================================

create table if not exists public.custom_symbols (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  code text not null check (code ~ '^[A-Z][A-Z0-9]{0,5}$'),
  name text not null check (char_length(name) between 1 and 40 and name = btrim(name)),
  mana_value smallint not null default 1 check (mana_value between 0 and 20),
  base_color text check (base_color in ('W', 'U', 'B', 'R', 'G')),
  image_url text not null check (char_length(image_url) between 1 and 600),
  source text not null default 'upload' check (source in ('upload', 'forge')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_symbols_owner_code_key unique (owner_id, code)
);

comment on table public.custom_symbols is
  'New mana symbols (0193): {*CODE} in a card''s text draws the CARD OWNER''s row with that code. A declared mana value and base colour (NULL = colourless); the picture is the owner''s custom-pips sym-<uuid>.png. deleted_at = removed but kept for the cards that still name it. Everyone reads; the owner writes while has_tool_access(''custom-symbols'').';

-- ===========================================================================
-- 2. Row rules: immutable code / owner / birth, the caps, updated_at
-- ===========================================================================

create or replace function public.custom_symbols_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_live integer;
  v_rows integer;
  v_check boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.code is distinct from old.code then
      raise exception 'custom_symbol_code_locked: a symbol''s code can''t change'
        using errcode = 'check_violation';
    end if;
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
    new.source := old.source;
  end if;
  new.updated_at := now();

  -- A new row, or a removed one restored: count under the owner's lock.
  if tg_op = 'INSERT' then
    v_check := true;
  elsif old.deleted_at is not null and new.deleted_at is null then
    v_check := true;
  end if;
  if v_check then
    perform pg_advisory_xact_lock(hashtext('pipglyph.custom_symbols'), hashtext(new.owner_id::text));
    select count(*) filter (where s.deleted_at is null), count(*)
      into v_live, v_rows
      from public.custom_symbols s
     where s.owner_id = new.owner_id
       and s.id <> new.id;
    if new.deleted_at is null and v_live >= 20 then
      raise exception 'custom_symbol_limit: at most 20 symbols'
        using errcode = 'check_violation';
    end if;
    if tg_op = 'INSERT' and v_rows >= 60 then
      raise exception 'custom_symbol_row_limit: at most 60 symbols, removed ones included'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists custom_symbols_guard on public.custom_symbols;
create trigger custom_symbols_guard
  before insert or update on public.custom_symbols
  for each row execute function public.custom_symbols_guard();

-- The picture: the owner's own custom-pips objects only (0127's 'pip' kind).
create or replace function public.guard_custom_symbol_media_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old_image text;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_old_image := old.image_url;
  end if;
  if not public.media_url_change_allowed('pip', v_old_image, new.image_url) then
    raise exception 'media_url_not_allowed: custom_symbols.image_url must be one of your own uploads'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists custom_symbols_guard_media_columns on public.custom_symbols;
create trigger custom_symbols_guard_media_columns
  before insert or update of image_url
  on public.custom_symbols
  for each row execute function public.guard_custom_symbol_media_columns();

-- ===========================================================================
-- 3. A symbol a card names is never deleted (tombstoned instead)
-- ===========================================================================

-- Whether one of the owner's cards names {*CODE} anywhere a symbol can be
-- written: the cost, the rules text, the rows (walker / saga / station) and
-- the back face or second part (its cost, text and rows). Case-insensitive,
-- as the parsers read it. A code holds only [A-Z0-9], so it is no LIKE
-- pattern character (and a code that isn't one answers false, so no caller
-- can hand it a pattern). SECURITY INVOKER: the delete guard calls it as the
-- deleting owner, whose own cards (private ones too) RLS hands them; any
-- other caller sees only what it may read anyway.
create or replace function public.custom_symbol_in_use(p_owner uuid, p_code text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_code ~* '^[A-Z][A-Z0-9]{0,5}$'
     and exists (
    select 1
      from public.cards c
     where c.owner_id = p_owner
       and concat_ws(' ', c.cost, c.rules_text, c.face_content::text, c.back_face::text)
           ilike '%{*' || p_code || '}%'
  );
$$;

comment on function public.custom_symbol_in_use(uuid, text) is
  'Whether one of the owner''s cards names {*CODE} (cost, rules text, rows, back face / second part) — the delete guard of custom_symbols (0193). Security invoker: it sees what the caller''s RLS shows.';

revoke all on function public.custom_symbol_in_use(uuid, text) from public, anon;
grant execute on function public.custom_symbol_in_use(uuid, text) to authenticated, service_role;

create or replace function public.custom_symbols_guard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The service role (the server's own checks), postgres and the account
  -- deletion's cascade are not checked here.
  if current_user not in ('anon', 'authenticated') then
    return old;
  end if;
  if public.custom_symbol_in_use(old.owner_id, old.code) then
    raise exception 'custom_symbol_in_use: a card still uses {*%}', old.code
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists custom_symbols_guard_delete on public.custom_symbols;
create trigger custom_symbols_guard_delete
  before delete on public.custom_symbols
  for each row execute function public.custom_symbols_guard_delete();

-- ===========================================================================
-- 4. RLS
-- ===========================================================================

alter table public.custom_symbols enable row level security;

drop policy if exists "Custom symbols: everyone reads" on public.custom_symbols;
create policy "Custom symbols: everyone reads"
  on public.custom_symbols for select
  to anon, authenticated
  using (true);

drop policy if exists "Custom symbols: owner adds" on public.custom_symbols;
create policy "Custom symbols: owner adds"
  on public.custom_symbols for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and deleted_at is null
    and public.has_tool_access('custom-symbols')
  );

drop policy if exists "Custom symbols: owner edits" on public.custom_symbols;
create policy "Custom symbols: owner edits"
  on public.custom_symbols for update
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('custom-symbols'))
  with check (owner_id = (select auth.uid()) and public.has_tool_access('custom-symbols'));

drop policy if exists "Custom symbols: owner deletes" on public.custom_symbols;
create policy "Custom symbols: owner deletes"
  on public.custom_symbols for delete
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('custom-symbols'));

-- ===========================================================================
-- 5. Grants
-- ===========================================================================

revoke all on public.custom_symbols from public, anon, authenticated;
grant select on public.custom_symbols to anon, authenticated;
grant insert (owner_id, code, name, mana_value, base_color, image_url, source)
  on public.custom_symbols to authenticated;
grant update (name, mana_value, base_color, image_url, deleted_at)
  on public.custom_symbols to authenticated;
grant delete on public.custom_symbols to authenticated;
grant select, insert, update, delete on public.custom_symbols to service_role;

revoke all on function public.custom_symbols_guard() from public, anon, authenticated;
revoke all on function public.guard_custom_symbol_media_columns() from public, anon, authenticated;
revoke all on function public.custom_symbols_guard_delete() from public, anon, authenticated;

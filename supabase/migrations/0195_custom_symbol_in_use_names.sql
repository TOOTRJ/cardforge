-- 0195_custom_symbol_in_use_names.sql — new mana symbols, PR 3: the
-- in-use check sees a code a card reaches through its NAME.
--
-- Since layout v76 (PR 2) a `~` or CARDNAME in rules text draws the name the
-- title bar prints — the card's `title`, or its `nickname` where the frame
-- prints one (lib/cards/self-name.ts) — and a `{*CODE}` in that name draws
-- the owner's symbol there. 0193's `custom_symbol_in_use` read the cost, the
-- rules text, the rows and the back face, never the front's title or
-- nickname, so a symbol a card used only through its name could be deleted
-- for good and that card then drew the placeholder disc. It now reads both
-- (the back face's own title was already read, inside `back_face`).
--
-- Read wider than drawn, like the layout scope (customSymbolsChanged) and
-- the re-bake (lib/symbols/rebake.ts cardNamesSymbol): a name that holds a
-- code keeps the symbol whether or not its rules say `~`. The cost is a kept
-- tombstone, never a refused delete.
--
-- Only the function body changes: same signature, SECURITY INVOKER, the
-- same answer for anything but a real code. Grants restated (0097).
-- Idempotent. Ships through a PR; never applied ad-hoc.

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
       and concat_ws(' ', c.title, c.nickname, c.cost, c.rules_text, c.face_content::text, c.back_face::text)
           ilike '%{*' || p_code || '}%'
  );
$$;

comment on function public.custom_symbol_in_use(uuid, text) is
  'Whether one of the owner''s cards names {*CODE} (name, nickname, cost, rules text, rows, back face / second part) — the delete guard of custom_symbols (0193; the name and nickname since 0195). Security invoker: it sees what the caller''s RLS shows.';

revoke all on function public.custom_symbol_in_use(uuid, text) from public, anon;
grant execute on function public.custom_symbol_in_use(uuid, text) to authenticated, service_role;

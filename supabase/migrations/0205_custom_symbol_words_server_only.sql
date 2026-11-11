-- 0205_custom_symbol_words_server_only.sql — a custom symbol's NAME and CODE
-- are written by the server alone (owner decision 2026-11-11).
--
-- A symbol's name and code are public: {*CODE} on a card draws for every
-- viewer, and the name is read wherever the symbol is listed. Neither may
-- hold strong language (owner decision 7, 2026-11-09) — but the only check
-- was the server action's (lib/symbols/actions.ts, the card detector
-- lib/moderation/profanity.ts). 0193 granted the API role INSERT (code,
-- name, …) and UPDATE (name, …) on its own rows, so an account with the tool
-- open could write either straight through the database API and skip the
-- check.
--
-- This takes those two writes away from the API role, instead of teaching
-- the database the word list (a second detector to keep in step with the
-- app's):
--   * no API role INSERTs a symbol — a new row names its code and its name,
--     so the whole insert is the server's (the service role, after the
--     action's checks: the tool's gate, the words, the upload rules);
--   * no API role UPDATEs `name`.
-- What the owner's own role still does, under the RLS 0193 gave it (the
-- owner, while the tool is open to them): change the meaning (mana_value,
-- base_color), the picture (image_url, behind 0127's media guard) and
-- deleted_at (remove / restore), and delete a symbol no card names.
--
-- The caps, the fixed code and updated_at are custom_symbols_guard's, which
-- runs for EVERY role: the server's inserts are counted like anyone's. The
-- insert policy goes with the grant — a policy no role can use says a thing
-- that is not true.
--
-- ROLLOUT: between this migration and the deployment that writes through
-- the server (minutes apart), a create or a rename sent by the OLD
-- deployment is refused (42501, "isn't open to your account right now");
-- nothing is lost, and the tool is admins and testers only. The new
-- deployment works before and after this migration.
--
-- Grants are explicit (0097). Idempotent. Ships through a PR; never applied
-- ad-hoc.

-- Revoking a table privilege revokes it on every column as well, so 0193's
-- column-level INSERT grant goes with this.
revoke insert on public.custom_symbols from authenticated;
revoke update (name) on public.custom_symbols from authenticated;

drop policy if exists "Custom symbols: owner adds" on public.custom_symbols;

-- The table's grants as they now stand, in full.
grant select on public.custom_symbols to anon, authenticated;
grant update (mana_value, base_color, image_url, deleted_at)
  on public.custom_symbols to authenticated;
grant delete on public.custom_symbols to authenticated;
grant select, insert, update, delete on public.custom_symbols to service_role;

comment on table public.custom_symbols is
  'New mana symbols (0193): {*CODE} in a card''s text draws the CARD OWNER''s row with that code. A declared mana value and base colour (NULL = colourless); the picture is the owner''s custom-pips sym-<uuid>.png. deleted_at = removed but kept for the cards that still name it. Everyone reads. The SERVER alone inserts a row and writes its name (0205: the code and the name are public words, checked by the app before it writes them); the owner''s own role changes the meaning, the picture and deleted_at, and deletes, while has_tool_access(''custom-symbols'').';

-- The proof, on every database this runs on (a preview branch, dev,
-- production): the two writes are really gone. `revoke update (name)` is a
-- silent no-op where a role holds UPDATE on the whole table — by 0193 it
-- does not, but a grant made by hand would leave the door open under a green
-- check. One statement (a DO block), so it runs as the branch runner sends it.
do $$
begin
  if has_any_column_privilege('authenticated', 'public.custom_symbols', 'INSERT')
     or has_any_column_privilege('anon', 'public.custom_symbols', 'INSERT')
     or has_column_privilege('authenticated', 'public.custom_symbols', 'name', 'UPDATE')
     or has_column_privilege('authenticated', 'public.custom_symbols', 'code', 'UPDATE')
     or has_any_column_privilege('anon', 'public.custom_symbols', 'UPDATE')
  then
    raise exception '0205: an API role can still write a custom symbol''s code or name'
      using errcode = 'insufficient_privilege';
  end if;
end
$$;

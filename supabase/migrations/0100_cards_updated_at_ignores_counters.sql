-- 0100_cards_updated_at_ignores_counters.sql — a view is not an edit.
--
-- set_cards_updated_at (0003) stamped now() on EVERY update, and the counter
-- RPCs (increment_card_view 0042, increment_card_share 0086) and the like
-- triggers (0043) all UPDATE the row. So `updated_at` meant "most recently
-- looked at", and everything sorted on it lied: the gallery's "Recent", the
-- creator profile grid, and My Cards' default "Recently edited" order — a
-- card someone merely opened jumped to the top of its owner's library.
--
-- Same guard 0057 gave decks: compare the row minus the counters (and
-- updated_at itself); if nothing else moved, keep the old timestamp.
-- search_vector is trigger-maintained from the text columns, so it can only
-- differ when a real field did — no need to exclude it. color_count (0044) IS
-- excluded: it is a GENERATED column, and PostgreSQL computes those after
-- BEFORE triggers run — inside this function NEW.color_count is still NULL
-- while OLD holds the value, so the rows would always "differ". (decks has
-- no generated columns, which is why 0057 never hit this.)

create or replace function public.set_cards_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'view_count' - 'likes_count' - 'share_count' - 'updated_at' - 'color_count')
     is distinct from
     (to_jsonb(old) - 'view_count' - 'likes_count' - 'share_count' - 'updated_at' - 'color_count') then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end;
$$;

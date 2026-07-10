-- 0057 — two decks fixes from the post-launch audit:
--
-- 1. updated_at guard: the unconditional BEFORE UPDATE trigger from 0055
--    let the view-counter RPC and the likes-count sync bump
--    decks.updated_at, so the /decks "recent" sort really meant "recently
--    viewed or liked" (and liking a deck floated it to the top of the
--    browse). The trigger now ignores writes that only touch the counter
--    columns.
-- 2. decks.cover_position: focal point for the cover image so owners can
--    drag-center wide covers (mirrors cards.art_position). {focalX, focalY}
--    in 0..1; NULL = centered.

-- 1. Counter-aware updated_at ------------------------------------------------
create or replace function public.set_decks_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Compare everything EXCEPT the counters (and updated_at itself). If only
  -- counters moved, preserve the old timestamp — views/likes aren't edits.
  -- deck_cards rows (which share this trigger function) simply never have
  -- these keys, so the subtraction is a no-op there.
  if (to_jsonb(new) - 'view_count' - 'likes_count' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'view_count' - 'likes_count' - 'updated_at') then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end;
$$;

-- 2. Cover focal point --------------------------------------------------------
alter table public.decks
  add column if not exists cover_position jsonb;

comment on column public.decks.cover_position is
  'Cover focal point {focalX, focalY} in 0..1 (app-validated, lib/validation/deck.ts). NULL = centered.';

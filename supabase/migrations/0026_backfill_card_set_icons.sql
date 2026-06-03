-- Backfill set icons onto cards that joined a set before the icon was
-- denormalized onto the card row (migration 0025). Those cards kept a null
-- primary_set_id / set_icon_*, so they render the default Spellwright mark
-- instead of their set's symbol.
--
-- Heal them by adopting each card's OLDEST set membership as its primary set and
-- copying that set's icon onto the card — the same "the first set a card joins
-- becomes its home" rule the app now applies on add (lib/sets/actions.ts).
--
-- Idempotent: only rows whose primary_set_id is still null are touched, so
-- re-running (e.g. via the normal migration pipeline after this was applied
-- out-of-band) is a no-op. No re-bake happens here — SQL can't render PNGs — but
-- affected cards either have no stored render (they fall back to the live
-- preview, which reads these columns directly) or will re-bake on their next
-- save.

update public.cards c
set primary_set_id = first_membership.set_id,
    set_icon_url   = s.icon_url,
    set_icon_code  = s.icon_code
from (
  select distinct on (i.card_id)
    i.card_id,
    i.set_id
  from public.card_set_items i
  order by i.card_id, i.created_at asc, i.position asc
) as first_membership
join public.card_sets s on s.id = first_membership.set_id
where c.id = first_membership.card_id
  and c.primary_set_id is null;

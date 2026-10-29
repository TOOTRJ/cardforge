-- 0147_remove_deck_capacity.sql — decks are unlimited on every plan again.
--
-- Owner decision 2026-10-29, after 0145 shipped: "there is not going to be
-- a deck cap because that is what other sites do. Where paid conversion
-- happens is with card limits." 0145 capped PRIVATE + UNLISTED decks per
-- plan (Free 1, Plus 3, Pro unlimited) with a BEFORE INSERT / UPDATE OF
-- visibility, owner_id trigger; this drops it, its trigger function and the
-- cap helper. Nothing else read them: the app's pre-check and error mapping
-- go in the same PR.
--
-- Nothing to restore: 0145 never changed or locked a row (its trigger only
-- refused new private / unlisted decks), so every deck made under it, and
-- every deck it grandfathered, is simply a deck again.
--
-- What stays is not a plan cap: 0143's 500-entry safety limit per deck
-- (deck_entry_limit) and 0104's saved-card capacity, which is where the
-- plans differ.
--
-- 0145 is never edited (supabase/migrations/README.md has the erratum).
-- Grants: nothing is created — the dropped functions take their ACLs with
-- them. Ships through a PR; never applied ad-hoc. Idempotent.

drop trigger if exists decks_enforce_capacity on public.decks;
drop function if exists public.enforce_deck_capacity();
drop function if exists public.deck_capacity_for(uuid);

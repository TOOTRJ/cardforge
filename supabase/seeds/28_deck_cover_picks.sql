-- ---------------------------------------------------------------------------
-- 28_deck_cover_picks.sql — the owner's cover picks and a stored built-in
-- background (TODO DK6.4, migration 0150), so a preview branch, the dev
-- database and the local stack show each case on dev_pro's decks:
--
--   Cinderwing Dragonstorm (seed 10, Commander) — the fan is the commander
--     (Cinderwing Matriarch, once it has a bake), then the owner's picks by
--     rank: 1. Dragon's Hoard, 2. Shivan Dragon (seed 27's printings — the
--     seeded custom cards have no bake on a fresh database, so a printing
--     is what a pick can show there); then the seeded fill. Its cover stays
--     AUTOMATIC: the red default its colours pick.
--   Every Status Sampler (seed 26) — rank 1 is Tidecaller Apprentice,
--     dev_free's PRIVATE card: picked, and never shown on the cover for
--     anyone (D11) — the fan starts at rank 2, Fire // Ice. Its cover is a
--     STORED built-in background (multicolor-2), as "Shuffle" or a pick in
--     the cover editor stores one.
--
-- Runs after 27_deck_tiles_trending.sql (config.toml → [db.seed] sql_paths,
-- filename order). Never against production. Idempotent and never over a
-- tester's choice: a deck's picks are written only while it has none, a
-- cover only while it has none. No credential in here (the repo is public).
-- Rows whose decks or entries are missing are skipped.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

update public.deck_cards dc
set featured_rank = p.rank
from (values
  ('a0000000-0000-4000-a000-0000000006cd'::uuid, 'b0000000-0000-4000-a000-000000000001'::uuid, 1::smallint),
  ('a0000000-0000-4000-a000-0000000006cc'::uuid, 'b0000000-0000-4000-a000-000000000001'::uuid, 2::smallint),
  ('a0000000-0000-4000-a000-0000000006b8'::uuid, 'b0000000-0000-4000-a000-000000000003'::uuid, 1::smallint),
  ('a0000000-0000-4000-a000-0000000006b1'::uuid, 'b0000000-0000-4000-a000-000000000003'::uuid, 2::smallint)
) as p (entry_id, deck_id, rank)
where dc.id = p.entry_id
  and dc.deck_id = p.deck_id
  and not exists (
    select 1 from public.deck_cards other
    where other.deck_id = p.deck_id and other.featured_rank is not null
  );

update public.decks
set cover_url = '/defaults/deck-covers/multicolor-2.webp'
where id = 'b0000000-0000-4000-a000-000000000003'
  and cover_url is null;

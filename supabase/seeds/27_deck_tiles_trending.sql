-- ---------------------------------------------------------------------------
-- 27_deck_tiles_trending.sql — trending decks, "In N decks" and the two deck
-- notifications (TODO DK8.2, DK8.4, DK8.6; migration 0149), so a preview
-- branch, the dev database and the local stack show each case:
--
--   Trending now (/decks, the gallery's "Trending decks") — likes of the
--     last 7 days, the owner's own left out, admin-owned decks left out:
--       1. Cinderwing Dragonstorm (dev_pro): 3 this week (+ dev_pro's own,
--          which doesn't count);
--       2. Artificer's Arsenal (dev_artist, NEW): 1 this week, 2 in all;
--       3. Every Status Sampler (dev_pro, seed 26): 1 this week, 1 in all;
--       —  Forge Staff Picks (dev_admin, NEW): 3 this week, never listed.
--   In N decks (gallery tiles, a card's "Decks with this card") — 0149's
--     rule: Archivist of Lost Hours is in Artificer's Arsenal (dev_artist's,
--     a creator) and the Sampler (dev_pro's own) = 2; Cinderwing Matriarch
--     is in dev_pro's two decks = 2, never Forge Staff Picks (an admin's).
--   Notifications — the likes above notify each deck's owner ("deck_like",
--     once per liker and deck); Artificer's Arsenal linking dev_pro's
--     PUBLIC Archivist notifies dev_pro ("deck_card_added"); Forge Staff
--     Picks linking dev_artist's Matriarch notifies nobody (an admin's
--     deck). They are written by 0149's triggers as the rows land — on a
--     database that already held seeds 10 / 26 only these new rows fire.
--
-- The new decks are PUBLIC (what trending and the counts read) and carry
-- real Scryfall printings with images, so the tiles' card fans have
-- something to draw where the seeded custom cards have no bake yet; two
-- printings join Cinderwing Dragonstorm for the same reason. Runs after
-- 26_deck_card_origin.sql (config.toml → [db.seed] sql_paths, filename
-- order). Never against production. Idempotent: fixed ids + ON CONFLICT DO
-- NOTHING (deck_likes on its (user_id, deck_id) key). No credential in here
-- (the repo is public). Rows whose accounts or decks are missing are
-- skipped. Deck ids …004 / …005, entry ids …6c1–…6cd.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.decks (id, owner_id, title, slug, description, format, visibility)
select d.id, d.owner_id, d.title, d.slug, d.description, 'casual', 'public'
from (values
  ('b0000000-0000-4000-a000-000000000004'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid,
     'Artificer''s Arsenal', 'artificers-arsenal',
     'Seeded: dev_artist''s constructs and soldiers, with dev_pro''s Archivist borrowed (D3) — a trending deck.'),
  ('b0000000-0000-4000-a000-000000000005'::uuid, 'd0000000-0000-4000-a000-000000000001'::uuid,
     'Forge Staff Picks', 'forge-staff-picks',
     'Seeded: an admin''s public deck — liked this week, yet never trending, never counted on a card.')
) as d (id, owner_id, title, slug, description)
where exists (select 1 from public.profiles where id = d.owner_id)
on conflict (id) do nothing;

insert into public.deck_cards (
  id, deck_id, board, quantity, position, card_id, source, scryfall_id, name,
  set_code, collector_number, type_line, mana_cost, mana_value, color_identity,
  rarity, image_url
)
select e.id, e.deck_id, 'main', e.quantity, e.position, e.card_id, e.source,
       e.scryfall_id, e.name, e.set_code, e.collector_number, e.type_line,
       e.mana_cost, e.mana_value, e.colors, e.rarity, e.image_url
from (values
  -- Artificer's Arsenal: dev_artist's own cards…
  ('a0000000-0000-4000-a000-0000000006c1'::uuid, 'b0000000-0000-4000-a000-000000000004'::uuid, 4, 0,
     'c0000000-0000-4000-a000-000000000004'::uuid, 'creator', null, 'Sunlit Vanguard',
     null, null, 'Creature — Human Soldier', '{1}{W}', 2::numeric, array['W'], 'common', null),
  ('a0000000-0000-4000-a000-0000000006c2'::uuid, 'b0000000-0000-4000-a000-000000000004'::uuid, 4, 1,
     'c0000000-0000-4000-a000-000000000003'::uuid, 'creator', null, 'Gravebloom Shade',
     null, null, 'Creature — Shade', '{2}{B}', 3::numeric, array['B'], 'uncommon', null),
  ('a0000000-0000-4000-a000-0000000006c3'::uuid, 'b0000000-0000-4000-a000-000000000004'::uuid, 2, 2,
     'c0000000-0000-4000-a000-000000000008'::uuid, 'creator', null, 'Clockwork Orrery',
     null, null, 'Artifact', '{3}', 3::numeric, array[]::text[], 'uncommon', null),
  -- …dev_pro's PUBLIC card, linked (D3): notifies dev_pro.
  ('a0000000-0000-4000-a000-0000000006c4'::uuid, 'b0000000-0000-4000-a000-000000000004'::uuid, 1, 3,
     'c0000000-0000-4000-a000-000000000016'::uuid, 'link', null, 'Archivist of Lost Hours',
     null, null, 'Creature — Human Wizard', '{2}{U}', 3::numeric, array['U'], 'rare', null),
  -- …and three printings.
  ('a0000000-0000-4000-a000-0000000006c5'::uuid, 'b0000000-0000-4000-a000-000000000004'::uuid, 4, 4,
     null, 'import', 'cc9ece2f-7eda-4fc5-a562-3e16e71560e9', 'Swords to Plowshares',
     'sta', '10', 'Instant', '{W}', 1::numeric, array['W'], 'rare',
     'https://cards.scryfall.io/normal/front/c/c/cc9ece2f-7eda-4fc5-a562-3e16e71560e9.jpg?1783927441'),
  ('a0000000-0000-4000-a000-0000000006c6'::uuid, 'b0000000-0000-4000-a000-000000000004'::uuid, 1, 5,
     null, 'import', '4cbc6901-6a4a-4d0a-83ea-7eefa3b35021', 'Sol Ring',
     'c21', '263', 'Artifact', '{1}', 1::numeric, array[]::text[], 'uncommon',
     'https://cards.scryfall.io/normal/front/4/c/4cbc6901-6a4a-4d0a-83ea-7eefa3b35021.jpg?1783927506'),
  ('a0000000-0000-4000-a000-0000000006c7'::uuid, 'b0000000-0000-4000-a000-000000000004'::uuid, 12, 6,
     null, 'import', '4be96696-aff8-4ef9-97dc-8221ef745de9', 'Plains',
     'm21', '260', 'Basic Land — Plains', null, 0::numeric, array['W'], 'common',
     'https://cards.scryfall.io/normal/front/4/b/4be96696-aff8-4ef9-97dc-8221ef745de9.jpg?1783930647'),
  -- Forge Staff Picks (an admin's): dev_artist's PUBLIC card — no
  -- notification, never counted on the card.
  ('a0000000-0000-4000-a000-0000000006c8'::uuid, 'b0000000-0000-4000-a000-000000000005'::uuid, 1, 0,
     'c0000000-0000-4000-a000-000000000001'::uuid, 'link', null, 'Cinderwing Matriarch',
     null, null, 'Legendary Creature — Dragon', '{3}{R}{R}', 5::numeric, array['R'], 'mythic', null),
  ('a0000000-0000-4000-a000-0000000006c9'::uuid, 'b0000000-0000-4000-a000-000000000005'::uuid, 1, 1,
     'c0000000-0000-4000-a000-000000000022'::uuid, 'creator', null, 'Forgemaster''s Decree',
     null, null, 'Legendary Sorcery', '{W}{U}{B}{R}{G}', 5::numeric, array['W','U','B','R','G'], 'mythic', null),
  ('a0000000-0000-4000-a000-0000000006ca'::uuid, 'b0000000-0000-4000-a000-000000000005'::uuid, 4, 2,
     null, 'import', 'e768c957-3a1f-42f5-853a-96942f645df5', 'Lightning Bolt',
     'm11', '149', 'Instant', '{R}', 1::numeric, array['R'], 'common',
     'https://cards.scryfall.io/normal/front/e/7/e768c957-3a1f-42f5-853a-96942f645df5.jpg?1783941805'),
  ('a0000000-0000-4000-a000-0000000006cb'::uuid, 'b0000000-0000-4000-a000-000000000005'::uuid, 4, 3,
     null, 'import', '1920dae4-fb92-4f19-ae4b-eb3276b8dac7', 'Counterspell',
     'mh2', '267', 'Instant', '{U}{U}', 2::numeric, array['U'], 'uncommon',
     'https://cards.scryfall.io/normal/front/1/9/1920dae4-fb92-4f19-ae4b-eb3276b8dac7.jpg?1783926788'),
  -- Cinderwing Dragonstorm (seed 10): two printings, so its fan draws.
  ('a0000000-0000-4000-a000-0000000006cc'::uuid, 'b0000000-0000-4000-a000-000000000001'::uuid, 1, 5,
     null, 'import', '227cf1b5-f85b-41fe-be98-66e383652039', 'Shivan Dragon',
     'm20', '335', 'Creature — Dragon', '{4}{R}{R}', 6::numeric, array['R'], 'rare',
     'https://cards.scryfall.io/normal/front/2/2/227cf1b5-f85b-41fe-be98-66e383652039.jpg?1783932902'),
  ('a0000000-0000-4000-a000-0000000006cd'::uuid, 'b0000000-0000-4000-a000-000000000001'::uuid, 1, 6,
     null, 'import', '5b441fc8-bc89-47d4-8745-2525aeb6d98d', 'Dragon''s Hoard',
     'm19', '232', 'Artifact', '{3}', 3::numeric, array[]::text[], 'rare',
     'https://cards.scryfall.io/normal/front/5/b/5b441fc8-bc89-47d4-8745-2525aeb6d98d.jpg?1783934514')
) as e (id, deck_id, quantity, position, card_id, source, scryfall_id, name, set_code,
        collector_number, type_line, mana_cost, mana_value, colors, rarity, image_url)
where exists (select 1 from public.decks where id = e.deck_id)
  and (e.card_id is null or exists (select 1 from public.cards where id = e.card_id))
on conflict (id) do nothing;

-- Likes, dated: the trending window is the last 7 days.
insert into public.deck_likes (user_id, deck_id, created_at)
select l.user_id, l.deck_id, now() - l.age
from (values
  -- Cinderwing Dragonstorm: three this week, and its owner's own (not counted).
  ('d0000000-0000-4000-a000-000000000004'::uuid, 'b0000000-0000-4000-a000-000000000001'::uuid, interval '1 day'),
  ('d0000000-0000-4000-a000-000000000003'::uuid, 'b0000000-0000-4000-a000-000000000001'::uuid, interval '2 days'),
  ('d0000000-0000-4000-a000-000000000001'::uuid, 'b0000000-0000-4000-a000-000000000001'::uuid, interval '3 days'),
  ('d0000000-0000-4000-a000-000000000002'::uuid, 'b0000000-0000-4000-a000-000000000001'::uuid, interval '1 day'),
  -- Artificer's Arsenal: one this week, one twelve days ago.
  ('d0000000-0000-4000-a000-000000000002'::uuid, 'b0000000-0000-4000-a000-000000000004'::uuid, interval '1 day'),
  ('d0000000-0000-4000-a000-000000000003'::uuid, 'b0000000-0000-4000-a000-000000000004'::uuid, interval '12 days'),
  -- Every Status Sampler: one this week.
  ('d0000000-0000-4000-a000-000000000004'::uuid, 'b0000000-0000-4000-a000-000000000003'::uuid, interval '4 days'),
  -- Forge Staff Picks: three this week — an admin's deck never trends.
  ('d0000000-0000-4000-a000-000000000002'::uuid, 'b0000000-0000-4000-a000-000000000005'::uuid, interval '1 day'),
  ('d0000000-0000-4000-a000-000000000004'::uuid, 'b0000000-0000-4000-a000-000000000005'::uuid, interval '1 day'),
  ('d0000000-0000-4000-a000-000000000003'::uuid, 'b0000000-0000-4000-a000-000000000005'::uuid, interval '2 days')
) as l (user_id, deck_id, age)
where exists (select 1 from public.profiles where id = l.user_id)
  and exists (select 1 from public.decks where id = l.deck_id)
on conflict (user_id, deck_id) do nothing;

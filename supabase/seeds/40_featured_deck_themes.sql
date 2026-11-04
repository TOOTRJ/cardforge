-- ---------------------------------------------------------------------------
-- 40_featured_deck_themes.sql — the /decks landing's "Featured themed decks"
-- and "Discover" (migration 0167), so a preview branch, the dev database and
-- the local stack show each case:
--
--   Featured themed decks (/decks top, the home page) — themes in order:
--     1. Dragons ascendant (live): Cinderwing Dragonstorm (seed 10), Ember
--        Wyrm Tribal, Mono-Red Sprint;
--     2. Artifacts & constructs (live): Artificer's Arsenal (seed 27),
--        Clockwork Cavalcade, Thopter Skirmish — plus two picks a visitor
--        never sees, marked "Hidden" in /admin/featured: Forge Staff Picks
--        (seed 27, an admin's deck) and Empty Shell (no cards);
--     3. Haunted season (RESTING): Hollow Crown Haunt — not on the pages
--        until an admin presses "Go live".
--   Trending (/decks, under the themes): likes at four ages (below), so
--     Week / Month / Year / All time each show a different row.
--   Discover (/decks bottom) — every public, non-empty deck of a real
--     creator, shuffled per ISR bake; the 10+ card decks below (Ember Wyrm
--     Tribal 12, Clockwork Cavalcade 14, Azure Tempo Lab 10, White Weenie
--     Rally 20, Five-Colour Pile 10, Hollow Crown Haunt 10) come up about
--     3× as often as the small ones (Thopter Skirmish 3, Mono-Red Sprint 5,
--     Gravebloom Grindhouse 4). Never shown: Empty Shell (public, no
--     cards) and dev_new's First Brew (12 cards, but dev_new has no public
--     card — not a creator).
--
-- Every deck is PUBLIC and holds real Scryfall printings with images, so the
-- tiles' fans draw where the seeded custom cards have no bake. A custom card
-- here is its deck owner's own (D3). Some decks get views so the engagement
-- half of the weight has something to read. Runs after 36_*.sql
-- (config.toml → [db.seed] sql_paths, filename order). Never against
-- production. Idempotent: fixed ids + ON CONFLICT DO NOTHING. No credential
-- in here (the repo is public). Rows whose accounts, decks or cards are
-- missing are skipped. Deck ids b…040001–b…04000b, entry ids a…0400xx,
-- theme ids e4000000-…-000000000001–3.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

-- The decks (dev_pro = …002, dev_artist = …004, dev_new = …005).
insert into public.decks (id, owner_id, title, slug, description, format, visibility)
select d.id, d.owner_id, d.title, d.slug, d.description, 'casual', 'public'
from (values
  ('b0000000-0000-4000-a000-000000040001'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid,
     'Ember Wyrm Tribal', 'ember-wyrm-tribal', 'Seeded: dragons and burn — featured under "Dragons ascendant".'),
  ('b0000000-0000-4000-a000-000000040002'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
     'Clockwork Cavalcade', 'clockwork-cavalcade', 'Seeded: artifacts and counters — featured under "Artifacts & constructs".'),
  ('b0000000-0000-4000-a000-000000040003'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid,
     'Thopter Skirmish', 'thopter-skirmish', 'Seeded: a small deck (3 cards) — featured, and rarer in Discover.'),
  ('b0000000-0000-4000-a000-000000040004'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
     'Azure Tempo Lab', 'azure-tempo-lab', 'Seeded: a 10-card deck for Discover.'),
  ('b0000000-0000-4000-a000-000000040005'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid,
     'White Weenie Rally', 'white-weenie-rally', 'Seeded: a 20-card deck for Discover.'),
  ('b0000000-0000-4000-a000-000000040006'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
     'Mono-Red Sprint', 'mono-red-sprint', 'Seeded: a small deck (5 cards) — featured under "Dragons ascendant".'),
  ('b0000000-0000-4000-a000-000000040007'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid,
     'Gravebloom Grindhouse', 'gravebloom-grindhouse', 'Seeded: a small deck (4 cards) for Discover.'),
  ('b0000000-0000-4000-a000-000000040008'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
     'Five-Colour Pile', 'five-colour-pile', 'Seeded: a 10-card deck for Discover.'),
  ('b0000000-0000-4000-a000-000000040009'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
     'Empty Shell', 'empty-shell', 'Seeded: a public deck with no cards — never in Discover or a featured theme.'),
  ('b0000000-0000-4000-a000-00000004000a'::uuid, 'd0000000-0000-4000-a000-000000000005'::uuid,
     'First Brew', 'dev-new-first-brew', 'Seeded: dev_new has no public card, so this deck never shows in Discover.'),
  ('b0000000-0000-4000-a000-00000004000b'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid,
     'Hollow Crown Haunt', 'hollow-crown-haunt', 'Seeded: the resting theme''s deck — in Discover, not featured.')
) as d (id, owner_id, title, slug, description)
where exists (select 1 from public.profiles where id = d.owner_id)
on conflict (id) do nothing;

insert into public.deck_cards (
  id, deck_id, board, quantity, position, card_id, source, scryfall_id, name,
  set_code, collector_number, type_line, mana_cost, mana_value, color_identity,
  rarity, image_url
)
select e.id, e.deck_id, 'main', e.quantity, e.position, e.card_id, e.source,
       p.scryfall_id, coalesce(e.name, p.name), p.set_code, p.collector_number,
       coalesce(e.type_line, p.type_line), coalesce(e.mana_cost, p.mana_cost),
       coalesce(e.mana_value, p.mana_value), coalesce(e.colors, p.colors),
       coalesce(e.rarity, p.rarity), p.image_url
from (values
  -- Ember Wyrm Tribal (12): dev_artist's own dragons + printings.
  ('a0000000-0000-4000-a000-000000040001'::uuid, 'b0000000-0000-4000-a000-000000040001'::uuid, 1, 0,
     'c0000000-0000-4000-a000-000000000001'::uuid, 'creator', null, 'Cinderwing Matriarch',
     'Legendary Creature — Dragon', '{3}{R}{R}', 5::numeric, array['R'], 'mythic'),
  ('a0000000-0000-4000-a000-000000040002'::uuid, 'b0000000-0000-4000-a000-000000040001'::uuid, 4, 1,
     'c0000000-0000-4000-a000-000000000006'::uuid, 'creator', null, 'Emberlash',
     'Instant', '{1}{R}', 2::numeric, array['R'], 'common'),
  ('a0000000-0000-4000-a000-000000040003'::uuid, 'b0000000-0000-4000-a000-000000040001'::uuid, 2, 2,
     null, 'import', 'shivan', null, null, null, null, null, null),
  ('a0000000-0000-4000-a000-000000040004'::uuid, 'b0000000-0000-4000-a000-000000040001'::uuid, 4, 3,
     null, 'import', 'bolt', null, null, null, null, null, null),
  ('a0000000-0000-4000-a000-000000040005'::uuid, 'b0000000-0000-4000-a000-000000040001'::uuid, 1, 4,
     null, 'import', 'hoard', null, null, null, null, null, null),
  -- Clockwork Cavalcade (14): dev_pro's own Archivist + printings.
  ('a0000000-0000-4000-a000-000000040011'::uuid, 'b0000000-0000-4000-a000-000000040002'::uuid, 1, 0,
     'c0000000-0000-4000-a000-000000000016'::uuid, 'creator', null, 'Archivist of Lost Hours',
     'Creature — Human Wizard', '{2}{U}', 3::numeric, array['U'], 'rare'),
  ('a0000000-0000-4000-a000-000000040012'::uuid, 'b0000000-0000-4000-a000-000000040002'::uuid, 1, 1,
     null, 'import', 'solring', null, null, null, null, null, null),
  ('a0000000-0000-4000-a000-000000040013'::uuid, 'b0000000-0000-4000-a000-000000040002'::uuid, 2, 2,
     null, 'import', 'hoard', null, null, null, null, null, null),
  ('a0000000-0000-4000-a000-000000040014'::uuid, 'b0000000-0000-4000-a000-000000040002'::uuid, 4, 3,
     null, 'import', 'counterspell', null, null, null, null, null, null),
  ('a0000000-0000-4000-a000-000000040015'::uuid, 'b0000000-0000-4000-a000-000000040002'::uuid, 6, 4,
     null, 'import', 'plains', null, null, null, null, null, null),
  -- Thopter Skirmish (3).
  ('a0000000-0000-4000-a000-000000040021'::uuid, 'b0000000-0000-4000-a000-000000040003'::uuid, 2, 0,
     'c0000000-0000-4000-a000-000000000008'::uuid, 'creator', null, 'Clockwork Orrery',
     'Artifact', '{3}', 3::numeric, array[]::text[], 'uncommon'),
  ('a0000000-0000-4000-a000-000000040022'::uuid, 'b0000000-0000-4000-a000-000000040003'::uuid, 1, 1,
     null, 'import', 'solring', null, null, null, null, null, null),
  -- Azure Tempo Lab (10).
  ('a0000000-0000-4000-a000-000000040031'::uuid, 'b0000000-0000-4000-a000-000000040004'::uuid, 4, 0,
     null, 'import', 'counterspell', null, null, null, null, null, null),
  ('a0000000-0000-4000-a000-000000040032'::uuid, 'b0000000-0000-4000-a000-000000040004'::uuid, 4, 1,
     null, 'import', 'bolt', null, null, null, null, null, null),
  ('a0000000-0000-4000-a000-000000040033'::uuid, 'b0000000-0000-4000-a000-000000040004'::uuid, 2, 2,
     null, 'import', 'fireice', null, null, null, null, null, null),
  -- White Weenie Rally (20).
  ('a0000000-0000-4000-a000-000000040041'::uuid, 'b0000000-0000-4000-a000-000000040005'::uuid, 4, 0,
     'c0000000-0000-4000-a000-000000000004'::uuid, 'creator', null, 'Sunlit Vanguard',
     'Creature — Human Soldier', '{1}{W}', 2::numeric, array['W'], 'common'),
  ('a0000000-0000-4000-a000-000000040042'::uuid, 'b0000000-0000-4000-a000-000000040005'::uuid, 4, 1,
     null, 'import', 'swords', null, null, null, null, null, null),
  ('a0000000-0000-4000-a000-000000040043'::uuid, 'b0000000-0000-4000-a000-000000040005'::uuid, 12, 2,
     null, 'import', 'plains', null, null, null, null, null, null),
  -- Mono-Red Sprint (5).
  ('a0000000-0000-4000-a000-000000040051'::uuid, 'b0000000-0000-4000-a000-000000040006'::uuid, 4, 0,
     null, 'import', 'bolt', null, null, null, null, null, null),
  ('a0000000-0000-4000-a000-000000040052'::uuid, 'b0000000-0000-4000-a000-000000040006'::uuid, 1, 1,
     null, 'import', 'shivan', null, null, null, null, null, null),
  -- Gravebloom Grindhouse (4).
  ('a0000000-0000-4000-a000-000000040061'::uuid, 'b0000000-0000-4000-a000-000000040007'::uuid, 3, 0,
     'c0000000-0000-4000-a000-000000000003'::uuid, 'creator', null, 'Gravebloom Shade',
     'Creature — Shade', '{2}{B}', 3::numeric, array['B'], 'uncommon'),
  ('a0000000-0000-4000-a000-000000040062'::uuid, 'b0000000-0000-4000-a000-000000040007'::uuid, 1, 1,
     null, 'import', 'swords', null, null, null, null, null, null),
  -- Five-Colour Pile (10).
  ('a0000000-0000-4000-a000-000000040071'::uuid, 'b0000000-0000-4000-a000-000000040008'::uuid, 2, 0,
     null, 'import', 'fireice', null, null, null, null, null, null),
  ('a0000000-0000-4000-a000-000000040072'::uuid, 'b0000000-0000-4000-a000-000000040008'::uuid, 1, 1,
     null, 'import', 'solring', null, null, null, null, null, null),
  ('a0000000-0000-4000-a000-000000040073'::uuid, 'b0000000-0000-4000-a000-000000040008'::uuid, 3, 2,
     null, 'import', 'counterspell', null, null, null, null, null, null),
  ('a0000000-0000-4000-a000-000000040074'::uuid, 'b0000000-0000-4000-a000-000000040008'::uuid, 2, 3,
     null, 'import', 'bolt', null, null, null, null, null, null),
  ('a0000000-0000-4000-a000-000000040075'::uuid, 'b0000000-0000-4000-a000-000000040008'::uuid, 2, 4,
     null, 'import', 'swords', null, null, null, null, null, null),
  -- First Brew (12, dev_new — not a creator).
  ('a0000000-0000-4000-a000-000000040091'::uuid, 'b0000000-0000-4000-a000-00000004000a'::uuid, 4, 0,
     null, 'import', 'bolt', null, null, null, null, null, null),
  ('a0000000-0000-4000-a000-000000040092'::uuid, 'b0000000-0000-4000-a000-00000004000a'::uuid, 8, 1,
     null, 'import', 'plains', null, null, null, null, null, null),
  -- Hollow Crown Haunt (10).
  ('a0000000-0000-4000-a000-0000000400a1'::uuid, 'b0000000-0000-4000-a000-00000004000b'::uuid, 4, 0,
     'c0000000-0000-4000-a000-000000000003'::uuid, 'creator', null, 'Gravebloom Shade',
     'Creature — Shade', '{2}{B}', 3::numeric, array['B'], 'uncommon'),
  ('a0000000-0000-4000-a000-0000000400a2'::uuid, 'b0000000-0000-4000-a000-00000004000b'::uuid, 2, 1,
     null, 'import', 'swords', null, null, null, null, null, null),
  ('a0000000-0000-4000-a000-0000000400a3'::uuid, 'b0000000-0000-4000-a000-00000004000b'::uuid, 4, 2,
     null, 'import', 'plains', null, null, null, null, null, null)
) as e (id, deck_id, quantity, position, card_id, source, printing, name, type_line,
        mana_cost, mana_value, colors, rarity)
left join (values
  ('shivan', '227cf1b5-f85b-41fe-be98-66e383652039', 'Shivan Dragon', 'm20', '335', 'Creature — Dragon',
     '{4}{R}{R}', 6::numeric, array['R'], 'rare',
     'https://cards.scryfall.io/normal/front/2/2/227cf1b5-f85b-41fe-be98-66e383652039.jpg?1783932902'),
  ('bolt', 'e768c957-3a1f-42f5-853a-96942f645df5', 'Lightning Bolt', 'm11', '149', 'Instant',
     '{R}', 1::numeric, array['R'], 'common',
     'https://cards.scryfall.io/normal/front/e/7/e768c957-3a1f-42f5-853a-96942f645df5.jpg?1783941805'),
  ('hoard', '5b441fc8-bc89-47d4-8745-2525aeb6d98d', 'Dragon''s Hoard', 'm19', '232', 'Artifact',
     '{3}', 3::numeric, array[]::text[], 'rare',
     'https://cards.scryfall.io/normal/front/5/b/5b441fc8-bc89-47d4-8745-2525aeb6d98d.jpg?1783934514'),
  ('solring', '4cbc6901-6a4a-4d0a-83ea-7eefa3b35021', 'Sol Ring', 'c21', '263', 'Artifact',
     '{1}', 1::numeric, array[]::text[], 'uncommon',
     'https://cards.scryfall.io/normal/front/4/c/4cbc6901-6a4a-4d0a-83ea-7eefa3b35021.jpg?1783927506'),
  ('counterspell', '1920dae4-fb92-4f19-ae4b-eb3276b8dac7', 'Counterspell', 'mh2', '267', 'Instant',
     '{U}{U}', 2::numeric, array['U'], 'uncommon',
     'https://cards.scryfall.io/normal/front/1/9/1920dae4-fb92-4f19-ae4b-eb3276b8dac7.jpg?1783926788'),
  ('plains', '4be96696-aff8-4ef9-97dc-8221ef745de9', 'Plains', 'm21', '260', 'Basic Land — Plains',
     null, 0::numeric, array['W'], 'common',
     'https://cards.scryfall.io/normal/front/4/b/4be96696-aff8-4ef9-97dc-8221ef745de9.jpg?1783930647'),
  ('swords', 'cc9ece2f-7eda-4fc5-a562-3e16e71560e9', 'Swords to Plowshares', 'sta', '10', 'Instant',
     '{W}', 1::numeric, array['W'], 'rare',
     'https://cards.scryfall.io/normal/front/c/c/cc9ece2f-7eda-4fc5-a562-3e16e71560e9.jpg?1783927441'),
  ('fireice', '18303862-4726-4136-814f-157aa7006579', 'Fire // Ice', 'dmr', '215', 'Instant // Instant',
     '{1}{R} // {1}{U}', 4::numeric, array['R','U'], 'uncommon',
     'https://cards.scryfall.io/normal/front/1/8/18303862-4726-4136-814f-157aa7006579.jpg?1783918420')
) as p (key, scryfall_id, name, set_code, collector_number, type_line, mana_cost, mana_value, colors, rarity, image_url)
  on p.key = e.printing
where exists (select 1 from public.decks where id = e.deck_id)
  and (e.card_id is null or exists (select 1 from public.cards where id = e.card_id))
on conflict (id) do nothing;

-- Views, so the engagement half of Discover's weight has something to read
-- (a counter is the server's: an API role's write is reverted, the seed's
-- is not).
update public.decks d
set view_count = v.views
from (values
  ('b0000000-0000-4000-a000-000000040001'::uuid, 140),
  ('b0000000-0000-4000-a000-000000040002'::uuid, 60),
  ('b0000000-0000-4000-a000-000000040005'::uuid, 25),
  ('b0000000-0000-4000-a000-000000040007'::uuid, 8)
) as v (id, views)
where d.id = v.id and d.view_count < v.views;

-- Likes at different ages, so each trending range ("Hot this week / month /
-- year / all time", 0167's list_trending_decks_by_range — one deck per
-- creator) shows a different row next to seed 27's week:
--   week  — Cinderwing Dragonstorm, Artificer's Arsenal (seed 27);
--   month — Cinderwing Dragonstorm, Ember Wyrm Tribal (8–10 days ago);
--   year  — Clockwork Cavalcade (20–60 days ago), Ember Wyrm Tribal;
--   all   — Clockwork Cavalcade, Gravebloom Grindhouse (400–600 days ago).
-- Never the deck owner's own like (it would not count anyway).
insert into public.deck_likes (user_id, deck_id, created_at)
select l.user_id, l.deck_id, now() - l.age
from (values
  ('d0000000-0000-4000-a000-000000000001'::uuid, 'b0000000-0000-4000-a000-000000040001'::uuid, interval '8 days'),
  ('d0000000-0000-4000-a000-000000000002'::uuid, 'b0000000-0000-4000-a000-000000040001'::uuid, interval '9 days'),
  ('d0000000-0000-4000-a000-000000000003'::uuid, 'b0000000-0000-4000-a000-000000040001'::uuid, interval '10 days'),
  ('d0000000-0000-4000-a000-000000000001'::uuid, 'b0000000-0000-4000-a000-000000040002'::uuid, interval '20 days'),
  ('d0000000-0000-4000-a000-000000000003'::uuid, 'b0000000-0000-4000-a000-000000040002'::uuid, interval '30 days'),
  ('d0000000-0000-4000-a000-000000000004'::uuid, 'b0000000-0000-4000-a000-000000040002'::uuid, interval '45 days'),
  ('d0000000-0000-4000-a000-000000000005'::uuid, 'b0000000-0000-4000-a000-000000040002'::uuid, interval '60 days'),
  ('d0000000-0000-4000-a000-000000000001'::uuid, 'b0000000-0000-4000-a000-000000040007'::uuid, interval '400 days'),
  ('d0000000-0000-4000-a000-000000000002'::uuid, 'b0000000-0000-4000-a000-000000040007'::uuid, interval '450 days'),
  ('d0000000-0000-4000-a000-000000000003'::uuid, 'b0000000-0000-4000-a000-000000040007'::uuid, interval '500 days'),
  ('d0000000-0000-4000-a000-000000000005'::uuid, 'b0000000-0000-4000-a000-000000040007'::uuid, interval '600 days')
) as l (user_id, deck_id, age)
where exists (select 1 from auth.users where id = l.user_id)
  and exists (select 1 from public.decks where id = l.deck_id)
on conflict (user_id, deck_id) do nothing;

-- The themes.
insert into public.deck_themes (id, title, blurb, position, is_live)
values
  ('e4000000-0000-4000-a000-000000000001', 'Dragons ascendant',
     'Fire-breathing tribal decks, from a mono-red sprint to a hoard of wyrms.', 0, true),
  ('e4000000-0000-4000-a000-000000000002', 'Artifacts & constructs',
     'Clockwork armies, thopters and the engines that run them.', 1, true),
  ('e4000000-0000-4000-a000-000000000003', 'Haunted season',
     'Shades, crowns and graveyard grinders — resting until an admin puts it live.', 2, false)
on conflict (id) do nothing;

insert into public.deck_theme_decks (theme_id, deck_id, position)
select t.theme_id, t.deck_id, t.position
from (values
  ('e4000000-0000-4000-a000-000000000001'::uuid, 'b0000000-0000-4000-a000-000000000001'::uuid, 0),
  ('e4000000-0000-4000-a000-000000000001'::uuid, 'b0000000-0000-4000-a000-000000040001'::uuid, 1),
  ('e4000000-0000-4000-a000-000000000001'::uuid, 'b0000000-0000-4000-a000-000000040006'::uuid, 2),
  ('e4000000-0000-4000-a000-000000000002'::uuid, 'b0000000-0000-4000-a000-000000000004'::uuid, 0),
  ('e4000000-0000-4000-a000-000000000002'::uuid, 'b0000000-0000-4000-a000-000000040002'::uuid, 1),
  ('e4000000-0000-4000-a000-000000000002'::uuid, 'b0000000-0000-4000-a000-000000040003'::uuid, 2),
  ('e4000000-0000-4000-a000-000000000002'::uuid, 'b0000000-0000-4000-a000-000000000005'::uuid, 3),
  ('e4000000-0000-4000-a000-000000000002'::uuid, 'b0000000-0000-4000-a000-000000040009'::uuid, 4),
  ('e4000000-0000-4000-a000-000000000003'::uuid, 'b0000000-0000-4000-a000-00000004000b'::uuid, 0)
) as t (theme_id, deck_id, position)
where exists (select 1 from public.deck_themes where id = t.theme_id)
  and exists (select 1 from public.decks where id = t.deck_id)
on conflict (theme_id, deck_id) do nothing;

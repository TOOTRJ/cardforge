-- ---------------------------------------------------------------------------
-- 51_table_sheets.sql — the Rule 0 table sheet beta tool (migration 0190),
-- so a preview branch, the dev database and the local stack can open a
-- sheet with everything on it:
--
--   * dev_pro is a tester of `rule0-sheet` (admins see every tool);
--   * "Rule 0 sampler" — an UNLISTED Commander deck of dev_pro's, its
--     bracket set to 2 (Core), holding three Game Changers (Rhystic Study,
--     Smothering Tithe, Cyclonic Rift — the estimate says "Bracket 3 or
--     higher", so the sheet flags the mismatch), real cards, and dev_pro's
--     own cards of every custom kind: an unchanged import (a proxy — Llanowar
--     Elves, 26's …6b1), an Edited import (Solemn Sentinel, …6b2), a Remix
--     (Cinderwing Broodling, …017) and an Original (Archivist of Lost Hours,
--     …016), plus a pasted name that matched nothing;
--   * its SHARED sheet: a game plan, three win conditions and a table note,
--     so /deck/rule-0-sampler/table-sheet opens for a visitor with the link.
--
-- Runs after 26_deck_card_origin.sql (filename order). Never against
-- production. Idempotent (fixed ids / ON CONFLICT DO NOTHING). No
-- credential (the repo is public). Rows whose accounts or cards are missing
-- are skipped. Deck id …0190, entry ids …01901–…0190c.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.tool_access_grants (tool_slug, user_id, granted_by, granted_at, expires_at, note)
select 'rule0-sheet', 'd0000000-0000-4000-a000-000000000002'::uuid, 'd0000000-0000-4000-a000-000000000001'::uuid,
       now() - interval '1 day', null::timestamptz, 'Seeded tester'
where exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000002'::uuid)
  and exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000001'::uuid)
on conflict do nothing;

insert into public.decks (id, owner_id, title, slug, description, format, visibility, bracket)
select 'b0000000-0000-4000-a000-000000000190'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
       'Rule 0 sampler', 'rule-0-sampler',
       'Seeded for the Rule 0 table sheet beta tool: Game Changers, proxies and custom cards of every kind.',
       'commander', 'unlisted', 2
where exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000002'::uuid)
on conflict (id) do nothing;

insert into public.deck_cards (
  id, deck_id, board, quantity, position, card_id, source, scryfall_id, name,
  type_line, mana_cost, mana_value, color_identity, rarity
)
select e.id, 'b0000000-0000-4000-a000-000000000190'::uuid, e.board, 1, e.position,
       e.card_id, e.source, e.scryfall_id, e.name, e.type_line, e.mana_cost, e.mana_value, e.colors, e.rarity
from (values
  ('a0000000-0000-4000-a000-000000001901'::uuid, 'commander', 0, null::uuid, 'import', '0e259db1-14db-4314-998c-6a076a28d8cb', 'Kenrith, the Returned King',
     'Legendary Creature — Human Noble', '{4}{W}', 5::numeric, array['W','U','B','R','G'], 'mythic'),
  ('a0000000-0000-4000-a000-000000001902'::uuid, 'main', 1, null, 'import', '9f37c5b6-a59c-45cd-9a99-e9357fe9ea1b', 'Rhystic Study',
     'Enchantment', '{2}{U}', 3, array['U'], 'rare'),
  ('a0000000-0000-4000-a000-000000001903'::uuid, 'main', 2, null, 'import', '861b5889-0183-4bee-afeb-a4b2aa700a8e', 'Smothering Tithe',
     'Enchantment', '{3}{W}', 4, array['W'], 'rare'),
  ('a0000000-0000-4000-a000-000000001904'::uuid, 'main', 3, null, 'import', 'dfb7c4b9-f2f4-4d4e-baf2-86551c8150fe', 'Cyclonic Rift',
     'Instant', '{1}{U}', 2, array['U'], 'mythic'),
  ('a0000000-0000-4000-a000-000000001905'::uuid, 'main', 4, null, 'import', 'fc817e07-c1f3-469f-9cf7-0945dea7400f', 'Sol Ring',
     'Artifact', '{1}', 1, array[]::text[], 'uncommon'),
  ('a0000000-0000-4000-a000-000000001906'::uuid, 'main', 5, null, 'import', 'a73297d2-580c-4174-a427-265f6916d09f', 'Command Tower',
     'Land', '', 0, array[]::text[], 'common'),
  ('a0000000-0000-4000-a000-000000001907'::uuid, 'main', 6, 'c0000000-0000-4000-a000-0000000006b1'::uuid, 'import', '581b7327-3215-4a4f-b4ae-d9d4002ba882', 'Llanowar Elves',
     'Creature — Elf Druid', '{G}', 1, array['G'], 'common'),
  ('a0000000-0000-4000-a000-000000001908'::uuid, 'main', 7, 'c0000000-0000-4000-a000-0000000006b2'::uuid, 'import', '7bbd2cab-538e-4932-a828-150e3e9d52ad', 'Solemn Simulacrum',
     'Artifact Creature — Golem', '{4}', 4, array[]::text[], 'rare'),
  ('a0000000-0000-4000-a000-000000001909'::uuid, 'main', 8, 'c0000000-0000-4000-a000-000000000017'::uuid, 'creator', null, 'Cinderwing Broodling',
     null, null, null, array[]::text[], null),
  ('a0000000-0000-4000-a000-00000000190a'::uuid, 'main', 9, 'c0000000-0000-4000-a000-000000000016'::uuid, 'creator', null, 'Archivist of Lost Hours',
     null, null, null, array[]::text[], null),
  ('a0000000-0000-4000-a000-00000000190b'::uuid, 'main', 10, null, 'import', null, 'Zqx Unknown Relic',
     null, null, null, array[]::text[], null),
  -- The maybeboard never counts: a Game Changer here is no Game Changer.
  ('a0000000-0000-4000-a000-00000000190c'::uuid, 'maybe', 11, null, 'import', 'a24b4cb6-cebb-428b-8654-74347a6a8d63', 'Demonic Tutor',
     'Sorcery', '{1}{B}', 2, array['B'], 'uncommon')
) as e (id, board, position, card_id, source, scryfall_id, name, type_line, mana_cost, mana_value, colors, rarity)
where exists (select 1 from public.decks d where d.id = 'b0000000-0000-4000-a000-000000000190'::uuid)
  and (e.card_id is null or exists (select 1 from public.cards c where c.id = e.card_id))
on conflict (id) do nothing;

insert into public.deck_table_sheets (deck_id, owner_id, game_plan, win_conditions, table_notes, shared)
select 'b0000000-0000-4000-a000-000000000190'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
       'Ramp early, draw a lot through Rhystic Study and the Archivist, then take over the board with Kenrith''s abilities. Plays slow and grindy; happy to be the table''s politician.',
       E'Combat damage with a wide board\nKenrith handing out +1/+1 counters and haste\nOut-valuing the table in a long game',
       'Three Game Changers: happy to swap them out at a Bracket 2 table.',
       true
where exists (select 1 from public.decks d where d.id = 'b0000000-0000-4000-a000-000000000190'::uuid)
on conflict (deck_id) do nothing;

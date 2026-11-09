-- ---------------------------------------------------------------------------
-- 52_re_art_deck.sql — the Re-art deck beta tool (migration 0191), so a
-- preview branch, the dev database and the local stack can run it:
--
--   * dev_pro is a Re-art deck tester (no end);
--   * "Re-art sampler", a private deck of dev_pro's with every kind of entry
--     the tool meets: a commander and four more REAL printings (each becomes
--     dev_pro's own card with the new art), two of dev_pro's OWN cards (they
--     get new art on them, and their old art can be put back), another
--     creator's public card (left as it is) and a maybeboard card (not part
--     of the deck);
--   * a saved style for it (deck_art_styles, version 1), so the studio opens
--     ready to paint a sample. Nothing is painted yet (no deck_reart_cards).
--
-- Never against production. Idempotent (ON CONFLICT). No credential. Rows
-- whose accounts are missing are skipped.
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
select 're-art-deck', 'd0000000-0000-4000-a000-000000000002'::uuid,
       'd0000000-0000-4000-a000-000000000001'::uuid, now() - interval '1 day', null, 'Seeded tester'
where exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000002'::uuid)
  and exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000001'::uuid)
on conflict do nothing;

-- "Re-art sampler": deck id …0000d1, entry ids …00d101 on. The printings are
-- Scryfall's real ids and pictures (the ones 48_bulk_customize.sql uses).
insert into public.decks (id, owner_id, title, slug, description, format, visibility)
select 'b0000000-0000-4000-a000-0000000000d1'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
       'Re-art sampler', 're-art-sampler',
       'Seeded for the Re-art deck beta tool: real printings, two of your own cards, another creator''s card and a maybeboard card.',
       'commander', 'private'
where exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000002'::uuid)
on conflict (id) do nothing;

-- The real printings (no PipGlyph card yet).
insert into public.deck_cards (
  id, deck_id, board, quantity, position, card_id, source, scryfall_id, name,
  set_code, collector_number, type_line, mana_cost, mana_value, color_identity,
  rarity, image_url
)
select e.id, 'b0000000-0000-4000-a000-0000000000d1'::uuid, e.board, e.quantity, e.position,
       null, 'import', e.scryfall_id, e.name, e.set_code, e.collector_number,
       e.type_line, e.mana_cost, e.mana_value, e.colors, e.rarity, e.image_url
from (values
  ('a0000000-0000-4000-a000-00000000d101'::uuid, 'commander', 1, 0, '824b2d73-2151-4e5e-9f05-8f63e2bdcaa9', 'Krenko, Mob Boss',
     'fdn', '204', 'Legendary Creature — Goblin Warrior', '{2}{R}{R}', 4::numeric, array['R'], 'rare',
     'https://cards.scryfall.io/normal/front/8/2/824b2d73-2151-4e5e-9f05-8f63e2bdcaa9.jpg'),
  ('a0000000-0000-4000-a000-00000000d102'::uuid, 'main', 1, 1, '89fcc35b-76fa-4408-8620-a1e11b2caf1f', 'Goblin Chieftain',
     'jmp', '324', 'Creature — Goblin', '{1}{R}{R}', 3, array['R'], 'rare',
     'https://cards.scryfall.io/normal/front/8/9/89fcc35b-76fa-4408-8620-a1e11b2caf1f.jpg'),
  ('a0000000-0000-4000-a000-00000000d103'::uuid, 'main', 1, 2, 'a78f5d3f-74d6-4ec1-89c4-e24639d3f4ba', 'Cultivate',
     'trc', '460', 'Sorcery', '{2}{G}', 3, array['G'], 'uncommon',
     'https://cards.scryfall.io/normal/front/a/7/a78f5d3f-74d6-4ec1-89c4-e24639d3f4ba.jpg'),
  ('a0000000-0000-4000-a000-00000000d104'::uuid, 'main', 1, 3, 'fc817e07-c1f3-469f-9cf7-0945dea7400f', 'Sol Ring',
     'trc', '499', 'Artifact', '{1}', 1, array[]::text[], 'uncommon',
     'https://cards.scryfall.io/normal/front/f/c/fc817e07-c1f3-469f-9cf7-0945dea7400f.jpg'),
  ('a0000000-0000-4000-a000-00000000d105'::uuid, 'main', 1, 4, 'a73297d2-580c-4174-a427-265f6916d09f', 'Command Tower',
     'trc', '521', 'Land', null, 0, array[]::text[], 'common',
     'https://cards.scryfall.io/normal/front/a/7/a73297d2-580c-4174-a427-265f6916d09f.jpg'),
  ('a0000000-0000-4000-a000-00000000d106'::uuid, 'maybe', 1, 5, '6a0b230b-d391-4998-a3f7-7b158a0ec2cd', 'Llanowar Elves',
     'fdn', '227', 'Creature — Elf Druid', '{G}', 1, array['G'], 'common',
     'https://cards.scryfall.io/normal/front/6/a/6a0b230b-d391-4998-a3f7-7b158a0ec2cd.jpg')
) as e (id, board, quantity, position, scryfall_id, name, set_code, collector_number, type_line,
        mana_cost, mana_value, colors, rarity, image_url)
where exists (select 1 from public.decks where id = 'b0000000-0000-4000-a000-0000000000d1'::uuid)
on conflict (id) do nothing;

-- dev_pro's own cards (10_dev_data.sql) and dev_artist's public Cinderwing
-- Matriarch (another creator's card: left as it is).
insert into public.deck_cards (
  id, deck_id, board, quantity, position, card_id, source, name, type_line, mana_cost, mana_value,
  color_identity, rarity
)
select e.id, 'b0000000-0000-4000-a000-0000000000d1'::uuid, 'main', 1, e.position, e.card_id, 'link',
       e.name, e.type_line, e.mana_cost, e.mana_value, e.colors, e.rarity
from (values
  ('a0000000-0000-4000-a000-00000000d107'::uuid, 6, 'c0000000-0000-4000-a000-000000000016'::uuid, 'Archivist of Lost Hours',
     'Creature — Human Wizard', '{2}{U}', 3::numeric, array['U'], 'rare'),
  ('a0000000-0000-4000-a000-00000000d108'::uuid, 7, 'c0000000-0000-4000-a000-000000000018'::uuid, 'Unfinished Masterwork',
     'Artifact', '{4}', 4, array[]::text[], 'rare'),
  ('a0000000-0000-4000-a000-00000000d109'::uuid, 8, 'c0000000-0000-4000-a000-000000000001'::uuid, 'Cinderwing Matriarch',
     'Legendary Creature — Dragon', '{3}{R}{R}', 5, array['R'], 'mythic')
) as e (id, position, card_id, name, type_line, mana_cost, mana_value, colors, rarity)
where exists (select 1 from public.decks where id = 'b0000000-0000-4000-a000-0000000000d1'::uuid)
  and exists (select 1 from public.cards c where c.id = e.card_id)
on conflict (id) do nothing;

-- The deck's style: a storybook look in a goblin warren.
insert into public.deck_art_styles (deck_id, owner_id, preset, theme, version)
select 'b0000000-0000-4000-a000-0000000000d1'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
       'storybook', 'a cosy goblin warren at dusk, lantern light, mossy stone and copper pots, warm oranges and deep greens', 1
where exists (select 1 from public.decks where id = 'b0000000-0000-4000-a000-0000000000d1'::uuid)
on conflict (deck_id) do nothing;

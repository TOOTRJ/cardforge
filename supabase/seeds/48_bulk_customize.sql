-- ---------------------------------------------------------------------------
-- 48_bulk_customize.sql — the Bulk Customize beta tool (migration 0186), so a
-- preview branch, the dev database and the local stack can run a batch:
--
--   * dev_pro is a Bulk Customize tester (no end). dev_pro already owns a
--     collection (47_collection_builder.sql), so the Collection page has
--     cards to tick;
--   * "Bulk Customize sampler", a private deck of dev_pro's with six real
--     printings and no PipGlyph card, for the deck page's selection.
--
-- The tool adds no table of its own: a batch is an ai_generation_jobs row
-- (kind 'bulk_customize') and the cards it makes are ordinary cards.
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
select 'bulk-customize', 'd0000000-0000-4000-a000-000000000002'::uuid,
       'd0000000-0000-4000-a000-000000000001'::uuid, now() - interval '1 day', null, 'Seeded tester'
where exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000002'::uuid)
  and exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000001'::uuid)
on conflict do nothing;

-- "Bulk Customize sampler": a PRIVATE deck of dev_pro's holding six real
-- printings and no PipGlyph card yet — every entry "Imported", so the deck
-- page's selection offers Customize on all six (two creatures and a
-- legendary one, a sorcery, an artifact and a land: each a different
-- frame). The printings are Scryfall's real ids and pictures (the ones
-- 47_collection_builder.sql uses). Deck id …0000c1, entry ids …00bc01 on.
insert into public.decks (id, owner_id, title, slug, description, format, visibility)
select 'b0000000-0000-4000-a000-0000000000c1'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
       'Bulk Customize sampler', 'bulk-customize-sampler',
       'Seeded for the Bulk Customize beta tool: real printings with no PipGlyph card yet.',
       'casual', 'private'
where exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000002'::uuid)
on conflict (id) do nothing;

insert into public.deck_cards (
  id, deck_id, board, quantity, position, card_id, source, scryfall_id, name,
  set_code, collector_number, type_line, mana_cost, mana_value, color_identity,
  rarity, image_url
)
select e.id, 'b0000000-0000-4000-a000-0000000000c1'::uuid, 'main', e.quantity, e.position,
       null, 'import', e.scryfall_id, e.name, e.set_code, e.collector_number,
       e.type_line, e.mana_cost, e.mana_value, e.colors, e.rarity, e.image_url
from (values
  ('a0000000-0000-4000-a000-00000000bc01'::uuid, 1, 0, '824b2d73-2151-4e5e-9f05-8f63e2bdcaa9', 'Krenko, Mob Boss',
     'fdn', '204', 'Legendary Creature — Goblin Warrior', '{2}{R}{R}', 4::numeric, array['R'], 'rare',
     'https://cards.scryfall.io/normal/front/8/2/824b2d73-2151-4e5e-9f05-8f63e2bdcaa9.jpg'),
  ('a0000000-0000-4000-a000-00000000bc02'::uuid, 1, 1, '89fcc35b-76fa-4408-8620-a1e11b2caf1f', 'Goblin Chieftain',
     'jmp', '324', 'Creature — Goblin', '{1}{R}{R}', 3, array['R'], 'rare',
     'https://cards.scryfall.io/normal/front/8/9/89fcc35b-76fa-4408-8620-a1e11b2caf1f.jpg'),
  ('a0000000-0000-4000-a000-00000000bc03'::uuid, 4, 2, '6a0b230b-d391-4998-a3f7-7b158a0ec2cd', 'Llanowar Elves',
     'fdn', '227', 'Creature — Elf Druid', '{G}', 1, array['G'], 'common',
     'https://cards.scryfall.io/normal/front/6/a/6a0b230b-d391-4998-a3f7-7b158a0ec2cd.jpg'),
  ('a0000000-0000-4000-a000-00000000bc04'::uuid, 1, 3, 'a78f5d3f-74d6-4ec1-89c4-e24639d3f4ba', 'Cultivate',
     'trc', '460', 'Sorcery', '{2}{G}', 3, array['G'], 'uncommon',
     'https://cards.scryfall.io/normal/front/a/7/a78f5d3f-74d6-4ec1-89c4-e24639d3f4ba.jpg'),
  ('a0000000-0000-4000-a000-00000000bc05'::uuid, 1, 4, 'fc817e07-c1f3-469f-9cf7-0945dea7400f', 'Sol Ring',
     'trc', '499', 'Artifact', '{1}', 1, array[]::text[], 'uncommon',
     'https://cards.scryfall.io/normal/front/f/c/fc817e07-c1f3-469f-9cf7-0945dea7400f.jpg'),
  ('a0000000-0000-4000-a000-00000000bc06'::uuid, 1, 5, 'a73297d2-580c-4174-a427-265f6916d09f', 'Command Tower',
     'trc', '521', 'Land', null, 0, array[]::text[], 'common',
     'https://cards.scryfall.io/normal/front/a/7/a73297d2-580c-4174-a427-265f6916d09f.jpg')
) as e (id, quantity, position, scryfall_id, name, set_code, collector_number, type_line,
        mana_cost, mana_value, colors, rarity, image_url)
where exists (select 1 from public.decks where id = 'b0000000-0000-4000-a000-0000000000c1'::uuid)
on conflict (id) do nothing;

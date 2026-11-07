-- ---------------------------------------------------------------------------
-- 46_token_kits.sql — the Token Kit beta tool (migration 0184), so a preview
-- branch, the dev database and the local stack can open a kit with something
-- in it:
--
--   * "Token Kit sampler" — a PRIVATE deck of dev_pro's (a seeded Token Kit
--     tester, 45_beta_tools.sql) whose real cards make tokens of every kind
--     the kit reads: creature and artifact tokens, a doubler (Parallel
--     Lives), the Monarch (Palace Jailer), the Initiative (Seasoned
--     Dungeoneer), Day // Night (Brutal Cathar), a venture dungeon (Nadaar)
--     and an emblem maker (Chandra, Torch of Defiance). Entries by NAME only:
--     the kit resolves them through Scryfall like a pasted list.
--   * dev_pro's saved kit of that deck: its look (the arch design, centred
--     text, a set symbol) and one token's copies, so a reload shows a kit
--     that kept its choices.
--
-- Never against production. Idempotent (fixed ids / ON CONFLICT). No
-- credential. Rows whose accounts are missing are skipped.
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
select 'b0000000-0000-4000-a000-0000000000f1'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
       'Token Kit sampler', 'token-kit-sampler',
       'Seeded for the Token Kit beta tool: real cards that make tokens, emblems and helper cards.',
       'commander', 'private'
where exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000002'::uuid)
on conflict (id) do nothing;

insert into public.deck_cards (id, deck_id, board, quantity, position, card_id, name, type_line, mana_cost, mana_value, color_identity, rarity)
select v.id, 'b0000000-0000-4000-a000-0000000000f1'::uuid, v.board, v.quantity, v.position, null, v.name, v.type_line, v.mana_cost, v.mana_value, v.color_identity, v.rarity
from (values
  ('a0000000-0000-4000-a000-0000000000f1'::uuid, 'commander', 1, 0, 'Chandra, Torch of Defiance', 'Legendary Planeswalker — Chandra', '{2}{R}{R}', 4, array['R'], 'mythic'),
  ('a0000000-0000-4000-a000-0000000000f2'::uuid, 'main', 1, 1, 'Goldspan Dragon', 'Creature — Dragon', '{3}{R}{R}', 5, array['R'], 'mythic'),
  ('a0000000-0000-4000-a000-0000000000f3'::uuid, 'main', 1, 2, 'Smothering Tithe', 'Enchantment', '{3}{W}', 4, array['W'], 'rare'),
  ('a0000000-0000-4000-a000-0000000000f4'::uuid, 'main', 1, 3, 'Parallel Lives', 'Enchantment', '{3}{G}', 4, array['G'], 'rare'),
  ('a0000000-0000-4000-a000-0000000000f5'::uuid, 'main', 1, 4, 'Palace Jailer', 'Creature — Human Soldier', '{2}{W}{W}', 4, array['W'], 'uncommon'),
  ('a0000000-0000-4000-a000-0000000000f6'::uuid, 'main', 1, 5, 'Seasoned Dungeoneer', 'Creature — Human Warrior', '{3}{W}', 4, array['W'], 'uncommon'),
  ('a0000000-0000-4000-a000-0000000000f7'::uuid, 'main', 1, 6, 'Brutal Cathar', 'Creature — Human Soldier Werewolf', '{2}{W}', 3, array['W'], 'rare'),
  ('a0000000-0000-4000-a000-0000000000f8'::uuid, 'main', 1, 7, 'Nadaar, Selfless Paladin', 'Legendary Creature — Dragon Knight', '{2}{W}', 3, array['W'], 'rare'),
  ('a0000000-0000-4000-a000-0000000000f9'::uuid, 'main', 1, 8, 'Raise the Alarm', 'Instant', '{1}{W}', 2, array['W'], 'common'),
  ('a0000000-0000-4000-a000-0000000000fa'::uuid, 'main', 1, 9, 'Tireless Provisioner', 'Creature — Elf Scout', '{2}{G}', 3, array['G'], 'uncommon')
) as v (id, board, quantity, position, name, type_line, mana_cost, mana_value, color_identity, rarity)
where exists (select 1 from public.decks d where d.id = 'b0000000-0000-4000-a000-0000000000f1'::uuid)
on conflict (id) do nothing;

insert into public.token_kits (owner_id, source_key, deck_id, title, settings, items)
select 'd0000000-0000-4000-a000-000000000002'::uuid,
       'deck:b0000000-0000-4000-a000-0000000000f1',
       'b0000000-0000-4000-a000-0000000000f1'::uuid,
       'Token Kit sampler',
       jsonb_build_object(
         'design', 'arch',
         'nyx', true,
         'setIconCode', 'dmu',
         'watermark', 'none',
         'rulesAlign', 'center',
         'artStyle', 'classic-oil'
       ),
       '{}'::jsonb
where exists (select 1 from public.decks d where d.id = 'b0000000-0000-4000-a000-0000000000f1'::uuid)
on conflict (owner_id, source_key) do nothing;

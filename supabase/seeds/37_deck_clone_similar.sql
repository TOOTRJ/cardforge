-- ---------------------------------------------------------------------------
-- 37_deck_clone_similar.sql — tokens, a copied deck and similar decks (TODO
-- DK5.16, migration 0164), so a preview branch, the dev database and the
-- local stack show each case:
--
--   Dragonstorm, Rekindled (dev_artist, PUBLIC) — a COPY of dev_pro's
--     Cinderwing Dragonstorm (deck_remix_sources): its page says "Remixed
--     from Cinderwing Dragonstorm by @dev_pro". Its commander is the same
--     public card (dev_artist's Cinderwing Matriarch), so each deck lists
--     the other under "Similar decks". It holds The Sundering of Aldmoor
--     (its chapter III makes a 4/4 green Beast) and Veyra, Stormbound (an
--     emblem), so "Tokens & emblems" lists both from PipGlyph cards' words.
--   dev_pro's bell: "dev_artist copied your deck "Cinderwing Dragonstorm"
--     to remix it." (deck_cloned, once).
--
-- Runs after the earlier deck seeds (config.toml → [db.seed] sql_paths,
-- filename order) and touches none of their rows. Never against production.
-- Idempotent: fixed ids + ON CONFLICT DO NOTHING. No credential in here (the
-- repo is public). Rows whose accounts, cards or decks are missing are
-- skipped. Deck id …020, entry ids …801–…806.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.decks (id, owner_id, title, slug, description, format, visibility, deck_type, bracket)
select 'b0000000-0000-4000-a000-000000000020'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid,
       'Dragonstorm, Rekindled', 'dragonstorm-rekindled',
       'Seeded: dev_artist''s copy of Cinderwing Dragonstorm (TODO DK5.16) — credited, similar, with tokens.',
       'commander', 'public', 'Dragons', 3
where exists (select 1 from public.profiles where id = 'd0000000-0000-4000-a000-000000000004')
on conflict (id) do nothing;

insert into public.deck_cards (
  id, deck_id, board, quantity, position, card_id, source, scryfall_id, name,
  set_code, collector_number, type_line, mana_cost, mana_value, color_identity,
  rarity, image_url
)
select e.id, 'b0000000-0000-4000-a000-000000000020'::uuid, e.board, e.quantity, e.position, e.card_id,
       e.source, e.scryfall_id, e.name, e.set_code, e.collector_number, e.type_line,
       e.mana_cost, e.mana_value, e.colors, e.rarity, e.image_url
from (values
  -- The commander both decks share: dev_artist's PUBLIC card.
  ('a0000000-0000-4000-a000-000000000801'::uuid, 'commander', 1, 0,
     'c0000000-0000-4000-a000-000000000001'::uuid, 'creator', null, 'Cinderwing Matriarch',
     null, null, 'Legendary Creature — Dragon', '{3}{R}{R}', 5::numeric, array['R'], 'mythic', null),
  -- A saga whose chapter III makes a 4/4 green Beast token.
  ('a0000000-0000-4000-a000-000000000802'::uuid, 'main', 1, 1,
     'c0000000-0000-4000-a000-000000000012'::uuid, 'creator', null, 'The Sundering of Aldmoor',
     null, null, 'Enchantment — Saga', '{2}{B}{G}', 4::numeric, array['B','G'], 'rare', null),
  -- A walker whose −7 gives an emblem.
  ('a0000000-0000-4000-a000-000000000803'::uuid, 'main', 1, 2,
     'c0000000-0000-4000-a000-000000000011'::uuid, 'creator', null, 'Veyra, Stormbound',
     null, null, 'Legendary Planeswalker — Veyra', '{2}{U}{R}', 4::numeric, array['U','R'], 'mythic', null),
  -- Printings (seed 27's), shared with Cinderwing Dragonstorm.
  ('a0000000-0000-4000-a000-000000000804'::uuid, 'main', 1, 3,
     null, 'import', '227cf1b5-f85b-41fe-be98-66e383652039', 'Shivan Dragon',
     'm20', '335', 'Creature — Dragon', '{4}{R}{R}', 6::numeric, array['R'], 'rare',
     'https://cards.scryfall.io/normal/front/2/2/227cf1b5-f85b-41fe-be98-66e383652039.jpg?1783932902'),
  ('a0000000-0000-4000-a000-000000000805'::uuid, 'main', 1, 4,
     null, 'import', '5b441fc8-bc89-47d4-8745-2525aeb6d98d', 'Dragon''s Hoard',
     'm19', '232', 'Artifact', '{3}', 3::numeric, array[]::text[], 'rare',
     'https://cards.scryfall.io/normal/front/5/b/5b441fc8-bc89-47d4-8745-2525aeb6d98d.jpg?1783934514'),
  ('a0000000-0000-4000-a000-000000000806'::uuid, 'main', 30, 5,
     null, 'import', null, 'Mountain',
     null, null, 'Basic Land — Mountain', null, 0::numeric, array['R'], 'common', null)
) as e (id, board, quantity, position, card_id, source, scryfall_id, name, set_code,
        collector_number, type_line, mana_cost, mana_value, colors, rarity, image_url)
where exists (select 1 from public.decks where id = 'b0000000-0000-4000-a000-000000000020')
  and (e.card_id is null or exists (select 1 from public.cards where id = e.card_id))
on conflict (id) do nothing;

-- The lineage: a copy of Cinderwing Dragonstorm (dev_pro's).
insert into public.deck_remix_sources (deck_id, source_deck_id, source_owner_id)
select 'b0000000-0000-4000-a000-000000000020'::uuid, 'b0000000-0000-4000-a000-000000000001'::uuid,
       'd0000000-0000-4000-a000-000000000002'::uuid
where exists (select 1 from public.decks where id = 'b0000000-0000-4000-a000-000000000020')
  and exists (select 1 from public.decks where id = 'b0000000-0000-4000-a000-000000000001')
on conflict (deck_id) do nothing;

-- dev_pro hears about it once (0164's dedupe index).
insert into public.notifications (recipient_id, actor_id, type, payload)
select 'd0000000-0000-4000-a000-000000000002'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'deck_cloned',
       jsonb_build_object('deckId', d.id, 'slug', d.slug, 'title', d.title)
from public.decks d
where d.id = 'b0000000-0000-4000-a000-000000000001'
  and exists (select 1 from public.decks where id = 'b0000000-0000-4000-a000-000000000020')
on conflict (actor_id, (payload ->> 'deckId')) where type = 'deck_cloned' do nothing;

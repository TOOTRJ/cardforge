-- ---------------------------------------------------------------------------
-- 26_deck_card_origin.sql — "Every Status Sampler": one deck entry per deck
-- status (TODO DK2.6, migration 0144), plus another creator's cards in it
-- (DK2.9, owner decision D3), so a preview branch, the dev database and the
-- local stack show every case:
--
--   Imported      Fire // Ice — a printing, no card;
--                 Llanowar Elves — a linked card still as imported (its
--                 fingerprint matches, lib/cards/import-fingerprint.ts);
--   Edited        Solemn Simulacrum → dev_pro's "Solemn Sentinel" (renamed
--                 since its import); Thought-Knot Seer → "Thicket Seer", an
--                 AI restyle that kept its printing (source ai_remix);
--   Remix         Cinderwing Broodling (dev_pro's remix of the Matriarch);
--   Original      Archivist of Lost Hours (dev_pro's own);
--   by @dev_artist  Cinderwing Matriarch — another creator's PUBLIC card;
--   No longer available
--                 Tidecaller Apprentice — dev_free's card, PRIVATE (RLS
--                 hides it); Void Tithe — dev_artist's card, UNLISTED (RLS
--                 shows it, the deck read withholds it: a link-only card is
--                 never a deck's); and "Ashen Prototype", the entry of a card
--                 whose row is gone;
--   Not found     a pasted name that matched nothing.
--
-- The three provenance cards are dev_pro's, UNLISTED (as 22 / 24 / 25: the
-- seeded public gallery stays on one page); each fingerprint is the JS
-- helper's hash of the row, held there by
-- tests/unit/decks/seed-deck-card-origin.test.ts. The deck is dev_pro's and
-- PUBLIC, so a visitor sees it too. Runs after 25_card_self_name.sql
-- (config.toml → [db.seed] sql_paths, filename order). Never against
-- production. Idempotent: fixed ids + ON CONFLICT DO NOTHING. No credential in
-- here (the repo is public). Rows whose accounts are missing (this file run
-- on its own) are skipped. Card ids …6b1–…6b3, entry ids …6b1–…6bb
-- (tests/unit/devops/seed-card-ids.test.ts).
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.cards (
  id, owner_id, game_system_id, title, slug, cost, color_identity, supertype,
  card_type, subtypes, rarity, rules_text, flavor_text, power, toughness,
  artist_credit, art_url, frame_style, visibility, source_scryfall_id,
  import_scryfall_id, import_fingerprint, created_at, updated_at
)
select
  c.id, 'd0000000-0000-4000-a000-000000000002'::uuid,
  (select id from public.game_systems order by created_at limit 1),
  c.title, c.slug, c.cost, c.colors, c.supertype, c.card_type, c.subtypes,
  c.rarity, c.rules_text, null, c.power, c.toughness, c.artist_credit,
  'https://pipglyph.com/defaults/avatars/avatar-' || lpad(c.art::text, 2, '0') || '.webp',
  jsonb_build_object('template', c.template, 'finish', 'regular'), 'unlisted',
  c.source_scryfall_id, c.import_scryfall_id, c.import_fingerprint,
  now() - interval '3 days', now() - interval '3 days'
from (values
  -- Saved straight from its import (DOM #168).
  ('c0000000-0000-4000-a000-0000000006b1'::uuid, 'Llanowar Elves', 'llanowar-elves', '{G}', array['green'], null, 'creature', array['Elf','Druid'], 'common',
     E'{T}: Add {G}.', '1', '1', 'Chris Rahn', 7, 'm15',
     '581b7327-3215-4a4f-b4ae-d9d4002ba882'::uuid, '581b7327-3215-4a4f-b4ae-d9d4002ba882'::uuid, 'v1:dee024fd1d55c97f5a5dfb15ee30737f92f9b62427a5de41040ddfaff767170c'),
  -- Renamed since its import (M21 #239): the fingerprint is the printing's.
  ('c0000000-0000-4000-a000-0000000006b2'::uuid, 'Solemn Sentinel', 'solemn-sentinel', '{4}', array['colorless'], 'Artifact', 'creature', array['Golem'], 'rare',
     E'When Solemn Sentinel enters, you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\nWhen Solemn Sentinel dies, you may draw a card.', '2', '2', 'Donato Giancola', 12, 'm15artifact',
     '7bbd2cab-538e-4932-a828-150e3e9d52ad'::uuid, '7bbd2cab-538e-4932-a828-150e3e9d52ad'::uuid, 'v1:a464b438a96e7c8130f8147742d75f24eeaaffb62b897df6fcdac79b5050d03b'),
  -- An AI restyle of OGW #9: saved changed, so no fingerprint.
  ('c0000000-0000-4000-a000-0000000006b3'::uuid, 'Thicket Seer', 'thicket-seer', '{3}{C}', array['colorless'], null, 'creature', array['Eldrazi'], 'rare',
     E'When Thicket Seer enters, target opponent reveals their hand. You choose a nonland card from it and exile that card.\nWhen Thicket Seer leaves the battlefield, target opponent draws a card.', '4', '4', 'PipGlyph AI', 19, 'm15',
     'bffc360e-db41-48f3-9365-680d55046e04'::uuid, 'bffc360e-db41-48f3-9365-680d55046e04'::uuid, null)
) as c (id, title, slug, cost, colors, supertype, card_type, subtypes, rarity,
        rules_text, power, toughness, artist_credit, art, template,
        source_scryfall_id, import_scryfall_id, import_fingerprint)
where exists (select 1 from public.profiles where id = 'd0000000-0000-4000-a000-000000000002'::uuid)
on conflict (id) do nothing;

insert into public.decks (id, owner_id, title, slug, description, format, visibility)
select 'b0000000-0000-4000-a000-000000000003', 'd0000000-0000-4000-a000-000000000002',
       'Every Status Sampler', 'every-status-sampler',
       'Seeded: one card of every deck status — Imported, Edited, Remix, Original, Not found — and another creator''s cards.',
       'casual', 'public'
where exists (select 1 from public.profiles where id = 'd0000000-0000-4000-a000-000000000002'::uuid)
on conflict (id) do nothing;

insert into public.deck_cards (
  id, deck_id, board, quantity, position, card_id, source, scryfall_id, name,
  set_code, collector_number, type_line, mana_cost, mana_value, color_identity,
  rarity, image_url
)
select e.id, 'b0000000-0000-4000-a000-000000000003'::uuid, 'main', e.quantity, e.position,
       e.card_id, e.source, e.scryfall_id, e.name, e.set_code, e.collector_number,
       e.type_line, e.mana_cost, e.mana_value, e.colors, e.rarity, e.image_url
from (values
  ('a0000000-0000-4000-a000-0000000006b1'::uuid, 1, 0, null::uuid, 'import', '18303862-4726-4136-814f-157aa7006579', 'Fire // Ice',
     'dmr', '215', 'Instant // Instant', '{1}{R} // {1}{U}', 4::numeric, array['R','U'], 'uncommon',
     'https://cards.scryfall.io/normal/front/1/8/18303862-4726-4136-814f-157aa7006579.jpg?1783918420'),
  ('a0000000-0000-4000-a000-0000000006b2'::uuid, 4, 1, 'c0000000-0000-4000-a000-0000000006b1'::uuid, 'import', '581b7327-3215-4a4f-b4ae-d9d4002ba882', 'Llanowar Elves',
     'dom', '168', 'Creature — Elf Druid', '{G}', 1, array['G'], 'common', null),
  ('a0000000-0000-4000-a000-0000000006b3'::uuid, 1, 2, 'c0000000-0000-4000-a000-0000000006b2'::uuid, 'import', '7bbd2cab-538e-4932-a828-150e3e9d52ad', 'Solemn Simulacrum',
     'm21', '239', 'Artifact Creature — Golem', '{4}', 4, array[]::text[], 'rare', null),
  -- What add_custom_deck_entry writes for an AI restyle: the printing's id
  -- and name, nothing else of it.
  ('a0000000-0000-4000-a000-0000000006b4'::uuid, 1, 3, 'c0000000-0000-4000-a000-0000000006b3'::uuid, 'ai_remix', 'bffc360e-db41-48f3-9365-680d55046e04', 'Thought-Knot Seer',
     null, null, null, null, null, array[]::text[], null, null),
  ('a0000000-0000-4000-a000-0000000006b5'::uuid, 1, 4, 'c0000000-0000-4000-a000-000000000017'::uuid, 'creator', null, 'Cinderwing Broodling',
     null, null, null, null, null, array[]::text[], null, null),
  ('a0000000-0000-4000-a000-0000000006b6'::uuid, 1, 5, 'c0000000-0000-4000-a000-000000000016'::uuid, 'creator', null, 'Archivist of Lost Hours',
     null, null, null, null, null, array[]::text[], null, null),
  -- dev_artist's PUBLIC card, linked into dev_pro's deck (D3).
  ('a0000000-0000-4000-a000-0000000006b7'::uuid, 1, 6, 'c0000000-0000-4000-a000-000000000001'::uuid, 'link', null, 'Cinderwing Matriarch',
     null, null, null, null, null, array[]::text[], null, null),
  -- dev_free's PRIVATE card: "No longer available" to dev_pro.
  ('a0000000-0000-4000-a000-0000000006b8'::uuid, 1, 7, 'c0000000-0000-4000-a000-000000000021'::uuid, 'link', null, 'Tidecaller Apprentice',
     null, null, null, null, null, array[]::text[], null, null),
  -- A card added by the creator and deleted since (its card_id set null).
  ('a0000000-0000-4000-a000-0000000006b9'::uuid, 1, 8, null, 'creator', null, 'Ashen Prototype',
     null, null, null, null, null, array[]::text[], null, null),
  ('a0000000-0000-4000-a000-0000000006ba'::uuid, 1, 9, null, 'import', null, 'Zqx Unknown Relic',
     null, null, null, null, null, array[]::text[], null, null),
  -- dev_artist's UNLISTED card (linked while it was public, say): withheld
  -- by listDeckCards, "No longer available" to dev_pro, a name to visitors.
  ('a0000000-0000-4000-a000-0000000006bb'::uuid, 1, 10, 'c0000000-0000-4000-a000-000000000014'::uuid, 'link', null, 'Void Tithe',
     null, null, null, null, null, array[]::text[], null, null)
) as e (id, quantity, position, card_id, source, scryfall_id, name, set_code,
        collector_number, type_line, mana_cost, mana_value, colors, rarity, image_url)
where exists (select 1 from public.decks where id = 'b0000000-0000-4000-a000-000000000003'::uuid)
  and (e.card_id is null or exists (select 1 from public.cards where id = e.card_id))
on conflict (id) do nothing;

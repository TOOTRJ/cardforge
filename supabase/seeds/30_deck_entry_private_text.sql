-- ---------------------------------------------------------------------------
-- 30_deck_entry_private_text.sql — a private card's text never leaves its
-- deck entry (migration 0152), so a preview branch, the dev database and the
-- local stack show each case on dev_pro's decks:
--
--   Workbench Secrets (dev_pro, PUBLIC):
--     * "Quillon, Hidden Cogwright" — dev_pro's PRIVATE card, no printing
--       behind its entry, which holds its type line and cost the way older
--       writers and the seeds wrote them: a visitor's list says
--       "Private card" with no cost, and the API hands a visitor neither the
--       row (`deck_cards`) nor its text (`deck_entries_for_viewer`);
--     * "Unfinished Masterwork" (seed 10's private card) — linked the way
--       the creator's "add to deck" writes it today (its title alone);
--     * "Brass Hoard Signet" — dev_pro's PRIVATE card standing for a Sol
--       Ring printing: a visitor sees "Private card" beside "Sol Ring", and
--       the API hands them the row (the real card's name, by design);
--     * Archivist of Lost Hours (dev_pro's public card) and Lightning Bolt (a
--       printing) — shown to everyone as they are.
--     dev_pro (the owner) sees every name, cost and type line as before.
--   Workbench Secrets (link only) (dev_pro, UNLISTED) — the same private
--     Quillon and a Counterspell printing, for the link-header read (0151:
--     an unlisted deck's rows reach a request that names it).
--
-- Runs after the earlier deck seeds (config.toml → [db.seed] sql_paths,
-- filename order) and touches none of their rows. Never against production.
-- Idempotent: fixed ids + ON CONFLICT DO NOTHING. No credential in here (the
-- repo is public). Rows whose accounts, cards or decks are missing are
-- skipped. Card ids …6e1–…6e2, deck ids …008 / …009, entry ids …6e1–…6e7.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

-- dev_pro's two PRIVATE cards.
insert into public.cards (
  id, owner_id, game_system_id, title, slug, cost, color_identity, supertype,
  card_type, subtypes, rarity, rules_text, flavor_text, power, toughness,
  artist_credit, art_url, frame_style, visibility, created_at, updated_at
)
select
  c.id, c.owner_id,
  (select id from public.game_systems order by created_at limit 1),
  c.title, c.slug, c.cost, c.colors, c.supertype, c.card_type, c.subtypes,
  c.rarity, c.rules_text, null, c.power, c.toughness, 'PipGlyph Studio',
  'https://pipglyph.com/defaults/avatars/avatar-' || lpad(c.art::text, 2, '0') || '.webp',
  jsonb_build_object('template', c.template, 'finish', 'regular'), 'private',
  now() - interval '3 days', now() - interval '3 days'
from (values
  ('c0000000-0000-4000-a000-0000000006e1'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'Quillon, Hidden Cogwright', 'quillon-hidden-cogwright', '{1}{U}{R}', array['blue','red'], 'Legendary', 'creature', array['Vedalken','Artificer'], 'rare',
     E'Whenever you cast an artifact spell, scry 1.', '2', '3', 11, 'm15'),
  ('c0000000-0000-4000-a000-0000000006e2'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'Brass Hoard Signet', 'brass-hoard-signet', '{1}', array['colorless'], null, 'artifact', array[]::text[], 'uncommon',
     E'{T}: Add {C}{C}.', null, null, 12, 'm15artifact')
) as c (id, owner_id, title, slug, cost, colors, supertype, card_type, subtypes, rarity,
        rules_text, power, toughness, art, template)
where exists (select 1 from public.profiles where id = c.owner_id)
on conflict (id) do nothing;

insert into public.decks (id, owner_id, title, slug, description, format, visibility)
select d.id, d.owner_id, d.title, d.slug, d.description, 'casual', d.visibility
from (values
  ('b0000000-0000-4000-a000-000000000008'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
     'Workbench Secrets', 'workbench-secrets',
     'Seeded: a public deck holding private cards — visitors see "Private card", the API hands them no private text.', 'public'),
  ('b0000000-0000-4000-a000-000000000009'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
     'Workbench Secrets (link only)', 'workbench-secrets-link-only',
     'Seeded: an UNLISTED deck holding a private card — opens by its link, still no private text.', 'unlisted')
) as d (id, owner_id, title, slug, description, visibility)
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
  -- Workbench Secrets: a private card with no printing, its text on the entry…
  ('a0000000-0000-4000-a000-0000000006e1'::uuid, 'b0000000-0000-4000-a000-000000000008'::uuid, 1, 0,
     'c0000000-0000-4000-a000-0000000006e1'::uuid, 'creator', null, 'Quillon, Hidden Cogwright',
     null, null, 'Legendary Creature — Vedalken Artificer', '{1}{U}{R}', 3::numeric, array['U','R'], 'rare', null),
  -- …one with its title alone (today's "add to deck")…
  ('a0000000-0000-4000-a000-0000000006e2'::uuid, 'b0000000-0000-4000-a000-000000000008'::uuid, 1, 1,
     'c0000000-0000-4000-a000-000000000018'::uuid, 'creator', null, 'Unfinished Masterwork',
     null, null, null, null, null, array[]::text[], null, null),
  -- …a private card standing for a Sol Ring printing…
  ('a0000000-0000-4000-a000-0000000006e3'::uuid, 'b0000000-0000-4000-a000-000000000008'::uuid, 1, 2,
     'c0000000-0000-4000-a000-0000000006e2'::uuid, 'import', '4cbc6901-6a4a-4d0a-83ea-7eefa3b35021', 'Sol Ring',
     'c21', '263', 'Artifact', '{1}', 1::numeric, array[]::text[], 'uncommon',
     'https://cards.scryfall.io/normal/front/4/c/4cbc6901-6a4a-4d0a-83ea-7eefa3b35021.jpg?1783927506'),
  -- …a public card and a printing.
  ('a0000000-0000-4000-a000-0000000006e4'::uuid, 'b0000000-0000-4000-a000-000000000008'::uuid, 2, 3,
     'c0000000-0000-4000-a000-000000000016'::uuid, 'creator', null, 'Archivist of Lost Hours',
     null, null, 'Creature — Human Wizard', '{2}{U}', 3::numeric, array['U'], 'rare', null),
  ('a0000000-0000-4000-a000-0000000006e5'::uuid, 'b0000000-0000-4000-a000-000000000008'::uuid, 8, 4,
     null, 'import', 'e768c957-3a1f-42f5-853a-96942f645df5', 'Lightning Bolt',
     'm11', '149', 'Instant', '{R}', 1::numeric, array['R'], 'common',
     'https://cards.scryfall.io/normal/front/e/7/e768c957-3a1f-42f5-853a-96942f645df5.jpg?1783941805'),
  -- Workbench Secrets (link only): the private card and a printing.
  ('a0000000-0000-4000-a000-0000000006e6'::uuid, 'b0000000-0000-4000-a000-000000000009'::uuid, 1, 0,
     'c0000000-0000-4000-a000-0000000006e1'::uuid, 'creator', null, 'Quillon, Hidden Cogwright',
     null, null, 'Legendary Creature — Vedalken Artificer', '{1}{U}{R}', 3::numeric, array['U','R'], 'rare', null),
  ('a0000000-0000-4000-a000-0000000006e7'::uuid, 'b0000000-0000-4000-a000-000000000009'::uuid, 4, 1,
     null, 'import', '1920dae4-fb92-4f19-ae4b-eb3276b8dac7', 'Counterspell',
     'mh2', '267', 'Instant', '{U}{U}', 2::numeric, array['U'], 'uncommon',
     'https://cards.scryfall.io/normal/front/1/9/1920dae4-fb92-4f19-ae4b-eb3276b8dac7.jpg?1783926788')
) as e (id, deck_id, quantity, position, card_id, source, scryfall_id, name, set_code,
        collector_number, type_line, mana_cost, mana_value, colors, rarity, image_url)
where exists (select 1 from public.decks where id = e.deck_id)
  and (e.card_id is null or exists (select 1 from public.cards where id = e.card_id))
on conflict (id) do nothing;

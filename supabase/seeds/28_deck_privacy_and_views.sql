-- ---------------------------------------------------------------------------
-- 28_deck_privacy_and_views.sql — what the API hands out about a deck matches
-- its page (TODO DK0.11, migration 0150), so a preview branch, the dev
-- database and the local stack show each case:
--
--   Gloomforge Workshop (dev_artist, PUBLIC) — an old AI guide that names
--     two of dev_artist's cards that are PRIVATE now (D11):
--       * "Vael, Gloomforge Tinker" — no printing behind its entry: a
--         visitor's guide says "Private card" (its short form "Vael" too);
--       * "Ember Signet" — its entry stands for a Sol Ring printing: a
--         visitor's guide says "Sol Ring", as the list does;
--       * "Clockwork Orrery" — public: named as it is.
--     dev_pro (Pro) and dev_admin read the guide redacted; dev_free and a
--     signed-out visitor see the Pro teaser; dev_artist (the owner, on the
--     free plan) sees the teaser too — the page shows a guide's text to Pro
--     viewers only, owner or not.
--   Hidden Tech (dev_pro, UNLISTED) — link-only: /deck/hidden-tech opens
--     for anyone, and no API list holds it (`decks?visibility=eq.unlisted`
--     answers nothing without the deck's x-pipglyph-deck header).
--   Views per day (DK7.4 groundwork) — three weeks of deck_views rows on
--     Cinderwing Dragonstorm (dev_pro's) for deck_views_by_day(); its
--     lifetime view_count is raised to at least the log's total.
--
-- Runs after 27_deck_tiles_trending.sql (config.toml → [db.seed] sql_paths,
-- filename order). Never against production. Idempotent: fixed ids + ON
-- CONFLICT DO NOTHING. No credential in here (the repo is public). Rows whose
-- accounts, cards or decks are missing are skipped. Card ids …6d1–…6d2, deck
-- ids …006 / …007, entry ids …6d1–…6d6.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

-- dev_artist's two PRIVATE cards.
insert into public.cards (
  id, owner_id, game_system_id, title, slug, cost, color_identity, supertype,
  card_type, subtypes, rarity, rules_text, flavor_text, power, toughness,
  artist_credit, art_url, frame_style, visibility, created_at, updated_at
)
select
  c.id, 'd0000000-0000-4000-a000-000000000004'::uuid,
  (select id from public.game_systems order by created_at limit 1),
  c.title, c.slug, c.cost, c.colors, c.supertype, c.card_type, c.subtypes,
  c.rarity, c.rules_text, null, c.power, c.toughness, 'PipGlyph Studio',
  'https://pipglyph.com/defaults/avatars/avatar-' || lpad(c.art::text, 2, '0') || '.webp',
  jsonb_build_object('template', c.template, 'finish', 'regular'), 'private',
  now() - interval '4 days', now() - interval '4 days'
from (values
  ('c0000000-0000-4000-a000-0000000006d1'::uuid, 'Vael, Gloomforge Tinker', 'vael-gloomforge-tinker', '{2}{R}', array['red'], 'Legendary', 'creature', array['Dwarf','Artificer'], 'rare',
     E'Whenever you cast an artifact spell, Vael, Gloomforge Tinker deals 1 damage to any target.', '2', '3', 9, 'm15'),
  ('c0000000-0000-4000-a000-0000000006d2'::uuid, 'Ember Signet', 'ember-signet', '{1}', array['colorless'], null, 'artifact', array[]::text[], 'uncommon',
     E'{T}: Add {C}{C}.', null, null, 10, 'm15artifact')
) as c (id, title, slug, cost, colors, supertype, card_type, subtypes, rarity,
        rules_text, power, toughness, art, template)
where exists (select 1 from public.profiles where id = 'd0000000-0000-4000-a000-000000000004'::uuid)
on conflict (id) do nothing;

insert into public.decks (id, owner_id, title, slug, description, format, visibility)
select d.id, d.owner_id, d.title, d.slug, d.description, 'casual', d.visibility
from (values
  ('b0000000-0000-4000-a000-000000000006'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid,
     'Gloomforge Workshop', 'gloomforge-workshop',
     'Seeded: an old AI guide that names two cards gone private — visitors read it redacted.', 'public'),
  ('b0000000-0000-4000-a000-000000000007'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
     'Hidden Tech', 'hidden-tech',
     'Seeded: an UNLISTED deck — opens by its link, never in a list.', 'unlisted')
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
  -- Gloomforge Workshop: a private card with no printing…
  ('a0000000-0000-4000-a000-0000000006d1'::uuid, 'b0000000-0000-4000-a000-000000000006'::uuid, 1, 0,
     'c0000000-0000-4000-a000-0000000006d1'::uuid, 'creator', null, 'Vael, Gloomforge Tinker',
     null, null, 'Legendary Creature — Dwarf Artificer', '{2}{R}', 3::numeric, array['R'], 'rare', null),
  -- …a private card standing for a Sol Ring printing…
  ('a0000000-0000-4000-a000-0000000006d2'::uuid, 'b0000000-0000-4000-a000-000000000006'::uuid, 1, 1,
     'c0000000-0000-4000-a000-0000000006d2'::uuid, 'import', '4cbc6901-6a4a-4d0a-83ea-7eefa3b35021', 'Sol Ring',
     'c21', '263', 'Artifact', '{1}', 1::numeric, array[]::text[], 'uncommon',
     'https://cards.scryfall.io/normal/front/4/c/4cbc6901-6a4a-4d0a-83ea-7eefa3b35021.jpg?1783927506'),
  -- …and a public one.
  ('a0000000-0000-4000-a000-0000000006d3'::uuid, 'b0000000-0000-4000-a000-000000000006'::uuid, 2, 2,
     'c0000000-0000-4000-a000-000000000008'::uuid, 'creator', null, 'Clockwork Orrery',
     null, null, 'Artifact', '{3}', 3::numeric, array[]::text[], 'uncommon', null),
  ('a0000000-0000-4000-a000-0000000006d4'::uuid, 'b0000000-0000-4000-a000-000000000006'::uuid, 12, 3,
     null, 'import', 'e768c957-3a1f-42f5-853a-96942f645df5', 'Lightning Bolt',
     'm11', '149', 'Instant', '{R}', 1::numeric, array['R'], 'common',
     'https://cards.scryfall.io/normal/front/e/7/e768c957-3a1f-42f5-853a-96942f645df5.jpg?1783941805'),
  -- Hidden Tech (unlisted): dev_pro's own public card and a printing.
  ('a0000000-0000-4000-a000-0000000006d5'::uuid, 'b0000000-0000-4000-a000-000000000007'::uuid, 2, 0,
     'c0000000-0000-4000-a000-000000000016'::uuid, 'creator', null, 'Archivist of Lost Hours',
     null, null, 'Creature — Human Wizard', '{2}{U}', 3::numeric, array['U'], 'rare', null),
  ('a0000000-0000-4000-a000-0000000006d6'::uuid, 'b0000000-0000-4000-a000-000000000007'::uuid, 4, 1,
     null, 'import', '1920dae4-fb92-4f19-ae4b-eb3276b8dac7', 'Counterspell',
     'mh2', '267', 'Instant', '{U}{U}', 2::numeric, array['U'], 'uncommon',
     'https://cards.scryfall.io/normal/front/1/9/1920dae4-fb92-4f19-ae4b-eb3276b8dac7.jpg?1783926788')
) as e (id, deck_id, quantity, position, card_id, source, scryfall_id, name, set_code,
        collector_number, type_line, mana_cost, mana_value, colors, rarity, image_url)
where exists (select 1 from public.decks where id = e.deck_id)
  and (e.card_id is null or exists (select 1 from public.cards where id = e.card_id))
on conflict (id) do nothing;

-- The guide, written (as deck AI did) from the owner's view of the cards.
insert into public.deck_guides (
  deck_id, overview, game_plan, mulligan, combos, weaknesses, key_cards, source, generated_at
)
select
  'b0000000-0000-4000-a000-000000000006'::uuid,
  'Vael, Gloomforge Tinker turns every artifact into a shock. Ramp with Ember Signet and Clockwork Orrery, then let Vael finish the job.',
  '["Turns 1–2: play Ember Signet or another mana rock.", "Turn 3: land Vael, Gloomforge Tinker and keep casting artifacts.", "Close out with Clockwork Orrery mana and Vael''s pings."]'::jsonb,
  'Keep hands with a mana rock (Ember Signet counts) and a way to protect Vael.',
  '[{"cards": ["Vael, Gloomforge Tinker", "Ember Signet"], "description": "Every Ember Signet you cast pings for one while Vael is out."}]'::jsonb,
  'Artifact removal on Vael stops the engine; Lightning Bolt can''t carry the deck alone.',
  '["Vael, Gloomforge Tinker", "Ember Signet", "Clockwork Orrery"]'::jsonb,
  'generation',
  now() - interval '20 days'
where exists (select 1 from public.decks where id = 'b0000000-0000-4000-a000-000000000006'::uuid)
on conflict (deck_id) do nothing;

-- Three weeks of views on Cinderwing Dragonstorm: 2–8 viewers a day. The
-- keys are stand-ins (the app's are HMACs under the day's salt).
insert into public.deck_views (deck_id, day, viewer_key)
select 'b0000000-0000-4000-a000-000000000001'::uuid,
       (now() at time zone 'utc')::date - d,
       md5('seed-view-' || d || '-' || v)
from generate_series(0, 20) as d
cross join lateral generate_series(1, 2 + (d * 5) % 7) as v
where exists (select 1 from public.decks where id = 'b0000000-0000-4000-a000-000000000001'::uuid)
on conflict do nothing;

update public.decks d
set view_count = greatest(d.view_count, (select count(*) from public.deck_views v where v.deck_id = d.id))
where d.id = 'b0000000-0000-4000-a000-000000000001'::uuid;

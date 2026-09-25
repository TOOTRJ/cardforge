-- ---------------------------------------------------------------------------
-- 10_dev_data.sql — synthetic test data for every NON-production database:
-- the persistent `dev` branch (shared by Vercel previews + local dev),
-- ephemeral per-PR preview branches, and the local Docker stack.
--
-- Runs after supabase/seed.sql (config.toml → [db.seed] sql_paths). Seed files
-- are never executed against production: merging to main applies migrations
-- only. The guard below is belt-and-braces for a human pointing `psql` at the
-- wrong database.
--
-- THIS REPO IS PUBLIC. Nothing in here is a credential:
--   * every seeded account gets a random, unknowable password;
--   * `npm run seed:dev` (scripts/seed-dev.mjs) sets real passwords from
--     DEV_SEED_PASSWORD in your local env and prints the logins.
--   * emails use the reserved `.test` TLD — they can never be delivered.
--
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING, so re-running is safe.
--
-- Accounts (username → what it exists to test):
--   dev_admin   is_admin + comped Pro — /admin/*, challenge authoring
--   dev_pro     paid Pro, 200 credits — premium/AI/export surfaces
--   dev_free    free tier, 5 credits  — upgrade prompts, card limits, drafts
--   dev_artist  prolific free creator — gallery, profile, follows, trending
--   dev_new     NOT onboarded         — the first-run wizard redirect
-- ---------------------------------------------------------------------------

do $guard$
begin
  -- A real database has real people in it. Seeded databases only ever hold
  -- the five accounts below (+ whatever a tester signs up with).
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------
-- 1. Accounts. Insert into auth.users → the handle_new_user trigger (0094)
--    creates the profile from raw_user_meta_data.username; profile details are
--    filled in below. GoTrue needs the token columns as '' (not NULL) and a
--    matching auth.identities row for email/password sign-in to work.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email,
  -- Unknowable on purpose (see header). seed-dev.mjs replaces it.
  extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username', u.username, 'display_name', u.display_name),
  now() - u.age, now() - u.age,
  '', '', '', ''
from (values
  ('d0000000-0000-4000-a000-000000000001'::uuid, 'admin@dev.pipglyph.test',  'dev_admin',  'Dev Admin',        interval '120 days'),
  ('d0000000-0000-4000-a000-000000000002'::uuid, 'pro@dev.pipglyph.test',    'dev_pro',    'Priya Prosmith',   interval '90 days'),
  ('d0000000-0000-4000-a000-000000000003'::uuid, 'free@dev.pipglyph.test',   'dev_free',   'Finn Freeforge',   interval '30 days'),
  ('d0000000-0000-4000-a000-000000000004'::uuid, 'artist@dev.pipglyph.test', 'dev_artist', 'Ari the Artificer', interval '200 days'),
  ('d0000000-0000-4000-a000-000000000005'::uuid, 'new@dev.pipglyph.test',    'dev_new',    'Nova Newcomer',    interval '1 hour')
) as u (id, email, username, display_name, age)
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.email like '%@dev.pipglyph.test'
  and not exists (
    select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
  );

-- Profile details + plan state. Runs as postgres, which protect_billing_columns
-- (0028) lets through — the same columns a signed-in user can never write.
update public.profiles p set
  bio = v.bio,
  subscription_tier = v.tier,
  subscription_status = v.status,
  credits = v.credits,
  is_admin = v.is_admin,
  comp_tier = v.comp_tier,
  accent_color = v.accent,
  onboarded_at = case when v.onboarded then now() - interval '1 day' else null end
from (values
  ('d0000000-0000-4000-a000-000000000001'::uuid, 'Keeps the dev forge running. Admin tools live under /admin.', 'free', null,     50,  true,  'pro', '#d4a94a', true),
  ('d0000000-0000-4000-a000-000000000002'::uuid, 'Paid Pro test account — premium surfaces, exports, deck tools.', 'pro',  'active', 200, false, null,  '#8b5cf6', true),
  ('d0000000-0000-4000-a000-000000000003'::uuid, 'Free-tier test account. Mostly drafts.',                        'free', null,     5,   false, null,  null,      true),
  ('d0000000-0000-4000-a000-000000000004'::uuid, 'Prolific creator. Dragons, artifacts and bad puns.',            'free', null,     5,   false, null,  '#ef4444', true),
  ('d0000000-0000-4000-a000-000000000005'::uuid, null,                                                            'free', null,     5,   false, null,  null,      false)
) as v (id, bio, tier, status, credits, is_admin, comp_tier, accent, onboarded)
where p.id = v.id;

-- ---------------------------------------------------------------------------
-- 2. Cards. One of (nearly) every kind the verified frames support, across
--    colors, rarities and all three visibilities. No stored render — tiles
--    fall back to the live preview, and saving one in the editor bakes it.
--    Art = PipGlyph's own built-in images on the production CDN (static files,
--    not the production database).
-- ---------------------------------------------------------------------------

insert into public.cards (
  id, owner_id, game_system_id, title, slug, cost, color_identity, supertype,
  card_type, subtypes, rarity, rules_text, flavor_text, power, toughness,
  loyalty, artist_credit, art_url, frame_style, visibility, parent_card_id,
  tags, face_content, layout, created_at, updated_at
)
select
  c.id, c.owner_id,
  (select id from public.game_systems order by created_at limit 1),
  c.title, c.slug, c.cost, c.colors, c.supertype, c.card_type, c.subtypes,
  c.rarity, c.rules_text, c.flavor_text, c.power, c.toughness, c.loyalty,
  'PipGlyph Studio',
  'https://pipglyph.com/defaults/avatars/avatar-' || lpad(c.art::text, 2, '0') || '.webp',
  jsonb_build_object('template', c.template, 'finish', c.finish),
  c.visibility, c.parent, c.tags, c.face_content, c.layout,
  now() - (c.age_days || ' days')::interval,
  now() - (c.age_days / 2 || ' days')::interval
from (values
  -- dev_artist — the public gallery backbone -------------------------------
  ('c0000000-0000-4000-a000-000000000001'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Cinderwing Matriarch', 'cinderwing-matriarch', '{3}{R}{R}', array['red'], 'Legendary', 'creature', array['Dragon'], 'mythic',
     E'Flying, haste\nWhenever Cinderwing Matriarch attacks, it deals 2 damage to each other creature.', 'The brood learns to fly by being dropped.', '5', '5', null, 1, 'm15', 'foil', 'public', null::uuid, array['dragons','tribal'], null::jsonb, 'normal', 60),
  ('c0000000-0000-4000-a000-000000000002'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Tidecaller Adept', 'tidecaller-adept', '{1}{U}', array['blue'], null, 'creature', array['Merfolk','Wizard'], 'common',
     E'When Tidecaller Adept enters, scry 2.', null, '1', '3', null, 2, 'm15', 'regular', 'public', null, array['merfolk'], null, 'normal', 55),
  ('c0000000-0000-4000-a000-000000000003'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Gravebloom Shade', 'gravebloom-shade', '{2}{B}', array['black'], null, 'creature', array['Shade'], 'uncommon',
     E'{B}: Gravebloom Shade gets +1/+1 until end of turn.', 'It flowers only where something was buried in a hurry.', '2', '1', null, 3, 'm15', 'regular', 'public', null, array['graveyard'], null, 'normal', 50),
  ('c0000000-0000-4000-a000-000000000004'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Sunlit Vanguard', 'sunlit-vanguard', '{1}{W}', array['white'], null, 'creature', array['Human','Soldier'], 'common',
     E'Vigilance\nOther Soldiers you control get +0/+1.', null, '2', '2', null, 4, 'm15', 'regular', 'public', null, array['soldiers','tribal'], null, 'normal', 45),
  ('c0000000-0000-4000-a000-000000000005'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Thornback Behemoth', 'thornback-behemoth', '{4}{G}{G}', array['green'], null, 'creature', array['Beast'], 'rare',
     E'Trample\nThornback Behemoth enters with a +1/+1 counter on it for each land you control.', null, '4', '4', null, 5, 'm15', 'regular', 'public', null, array['ramp'], null, 'normal', 40),
  ('c0000000-0000-4000-a000-000000000006'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Emberlash', 'emberlash', '{R}', array['red'], null, 'instant', array[]::text[], 'common',
     E'Emberlash deals 3 damage to any target.', 'Short, loud, and over.', null, null, null, 6, 'm15', 'regular', 'public', null, array['burn'], null, 'normal', 35),
  ('c0000000-0000-4000-a000-000000000007'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Rewrite the Tides', 'rewrite-the-tides', '{2}{U}{U}', array['blue'], null, 'sorcery', array[]::text[], 'rare',
     E'Return all nonland permanents to their owners'' hands.', null, null, null, null, 7, 'm15', 'regular', 'public', null, array['control'], null, 'normal', 30),
  ('c0000000-0000-4000-a000-000000000008'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Clockwork Orrery', 'clockwork-orrery', '{3}', array['colorless'], null, 'artifact', array[]::text[], 'uncommon',
     E'{T}: Add one mana of any color.\n{2}, {T}: Scry 1.', 'It models a sky nobody has seen.', null, null, null, 8, 'm15artifact', 'etched', 'public', null, array['artifacts','arcane-frontiers'], null, 'normal', 25),
  ('c0000000-0000-4000-a000-000000000009'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Oath of the Hollow Crown', 'oath-of-the-hollow-crown', '{1}{W}{B}', array['white','black'], 'Legendary', 'enchantment', array[]::text[], 'rare',
     E'Whenever a creature you control dies, each opponent loses 1 life and you gain 1 life.', null, null, null, null, 9, 'm15', 'regular', 'public', null, array['aristocrats'], null, 'normal', 20),
  ('c0000000-0000-4000-a000-000000000010'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Mistveil Crossing', 'mistveil-crossing', null, array['colorless'], null, 'land', array[]::text[], 'uncommon',
     E'{T}: Add {C}.\n{1}, {T}: Add {W} or {U}.', null, null, null, null, 10, 'm15land', 'regular', 'public', null, array['lands'], null, 'normal', 15),
  ('c0000000-0000-4000-a000-000000000011'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Veyra, Stormbound', 'veyra-stormbound', '{2}{U}{R}', array['blue','red'], 'Legendary', 'planeswalker', array['Veyra'], 'mythic',
     null, null, null, null, '4', 11, 'm15pw', 'regular', 'public', null, array['planeswalker','arcane-frontiers'],
     '{"v":1,"loyalty":{"abilities":[{"cost":"+1","text":"Draw a card, then discard a card."},{"cost":"-2","text":"Veyra, Stormbound deals 3 damage to target creature."},{"cost":"-7","text":"You get an emblem with \"Instant and sorcery spells you cast cost {2} less to cast.\""}]}}'::jsonb, 'normal', 12),
  ('c0000000-0000-4000-a000-000000000012'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'The Sundering of Aldmoor', 'the-sundering-of-aldmoor', '{2}{B}{G}', array['black','green'], null, 'enchantment', array['Saga'], 'rare',
     null, null, null, null, null, 12, 'saga', 'regular', 'public', null, array['saga'],
     '{"v":1,"saga":{"intro":null,"chapters":[{"numerals":[1],"text":"Each player sacrifices a creature."},{"numerals":[2],"text":"Return a creature card from your graveyard to your hand."},{"numerals":[3],"text":"Create a 4/4 green Beast creature token."}]}}'::jsonb, 'saga', 10),
  ('c0000000-0000-4000-a000-000000000013'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Frostbound Sentinel', 'frostbound-sentinel', '{2}{S}', array['colorless'], 'Snow', 'creature', array['Golem'], 'uncommon',
     E'Defender\n{S}: Frostbound Sentinel gains reach until end of turn.', null, '1', '5', null, 13, 'm15snow', 'regular', 'public', null, array['snow'], null, 'normal', 8),
  ('c0000000-0000-4000-a000-000000000014'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Void Tithe', 'void-tithe', '{1}{B}', array['black'], null, 'instant', array[]::text[], 'uncommon',
     E'Devoid\nTarget player exiles a card from their hand.', null, null, null, null, 14, 'm15devoid', 'regular', 'unlisted', null, array['devoid'], null, 'normal', 6),
  ('c0000000-0000-4000-a000-000000000015'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Beast', 'beast-token', null, array['green'], null, 'token', array['Beast'], 'common',
     null, null, '4', '4', null, 15, 'm15token', 'regular', 'public', null, array['tokens'], null, 'token', 4),
  -- dev_pro — a few polished cards + a remix ---------------------------------
  ('c0000000-0000-4000-a000-000000000016'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'Archivist of Lost Hours', 'archivist-of-lost-hours', '{2}{U}', array['blue'], null, 'creature', array['Human','Wizard'], 'rare',
     E'Flash\nWhen Archivist of Lost Hours enters, return target instant card from your graveyard to your hand.', null, '2', '2', null, 16, 'm15', 'showcase', 'public', null, array['spellslinger'], null, 'normal', 18),
  ('c0000000-0000-4000-a000-000000000017'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'Cinderwing Broodling', 'cinderwing-broodling', '{1}{R}', array['red'], null, 'creature', array['Dragon'], 'uncommon',
     E'Flying\nCinderwing Broodling can''t block.', 'Dropped, and flying.', '2', '1', null, 17, 'm15', 'regular', 'public', 'c0000000-0000-4000-a000-000000000001'::uuid, array['dragons','remix'], null, 'normal', 9),
  ('c0000000-0000-4000-a000-000000000018'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'Unfinished Masterwork', 'unfinished-masterwork', '{4}', array['colorless'], null, 'artifact', array[]::text[], 'rare',
     E'Unfinished Masterwork enters tapped.', null, null, null, null, 18, 'm15artifact', 'regular', 'private', null, array[]::text[], null, 'normal', 2),
  -- dev_free — drafts, one public card, one remix draft ---------------------
  ('c0000000-0000-4000-a000-000000000019'::uuid, 'd0000000-0000-4000-a000-000000000003'::uuid, 'Hedge Witch''s Familiar', 'hedge-witchs-familiar', '{G}', array['green'], null, 'creature', array['Cat'], 'common',
     E'Deathtouch', 'It brings her things. She has stopped asking where from.', '1', '1', null, 19, 'm15', 'regular', 'public', null, array['cats'], null, 'normal', 14),
  ('c0000000-0000-4000-a000-000000000020'::uuid, 'd0000000-0000-4000-a000-000000000003'::uuid, 'Untitled Dragon Idea', 'untitled-dragon-idea', null, array['red'], null, 'creature', array['Dragon'], null,
     null, null, null, null, null, 20, 'm15', 'regular', 'private', null, array[]::text[], null, 'normal', 3),
  ('c0000000-0000-4000-a000-000000000021'::uuid, 'd0000000-0000-4000-a000-000000000003'::uuid, 'Tidecaller Apprentice', 'tidecaller-apprentice', '{U}', array['blue'], null, 'creature', array['Merfolk'], 'common',
     E'When Tidecaller Apprentice enters, scry 1.', null, '1', '1', null, 21, 'm15', 'regular', 'private', 'c0000000-0000-4000-a000-000000000002'::uuid, array['merfolk','remix'], null, 'normal', 1),
  -- dev_admin — one card, so "hide admin cards from trending" is testable ----
  ('c0000000-0000-4000-a000-000000000022'::uuid, 'd0000000-0000-4000-a000-000000000001'::uuid, 'Forgemaster''s Decree', 'forgemasters-decree', '{W}{U}{B}{R}{G}', array['white','blue','black','red','green'], 'Legendary', 'sorcery', array[]::text[], 'mythic',
     E'Search your library for up to five cards with different names, reveal them, and put them into your hand. Then shuffle.', null, null, null, null, 22, 'm15', 'foil', 'public', null, array['five-color'], null, 'normal', 7)
) as c (id, owner_id, title, slug, cost, colors, supertype, card_type, subtypes, rarity,
        rules_text, flavor_text, power, toughness, loyalty, art, template, finish,
        visibility, parent, tags, face_content, layout, age_days)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Social graph. The like / comment / follow / remix triggers turn these
--    into notification rows for free, so the bell has something in it.
-- ---------------------------------------------------------------------------

insert into public.follows (follower_id, following_id)
values
  ('d0000000-0000-4000-a000-000000000002', 'd0000000-0000-4000-a000-000000000004'),
  ('d0000000-0000-4000-a000-000000000003', 'd0000000-0000-4000-a000-000000000004'),
  ('d0000000-0000-4000-a000-000000000001', 'd0000000-0000-4000-a000-000000000004'),
  ('d0000000-0000-4000-a000-000000000004', 'd0000000-0000-4000-a000-000000000002'),
  ('d0000000-0000-4000-a000-000000000003', 'd0000000-0000-4000-a000-000000000002')
on conflict do nothing;

insert into public.card_likes (user_id, card_id)
select l.user_id, l.card_id
from (values
  ('d0000000-0000-4000-a000-000000000002'::uuid, 'c0000000-0000-4000-a000-000000000001'::uuid),
  ('d0000000-0000-4000-a000-000000000003'::uuid, 'c0000000-0000-4000-a000-000000000001'::uuid),
  ('d0000000-0000-4000-a000-000000000001'::uuid, 'c0000000-0000-4000-a000-000000000001'::uuid),
  ('d0000000-0000-4000-a000-000000000002'::uuid, 'c0000000-0000-4000-a000-000000000011'::uuid),
  ('d0000000-0000-4000-a000-000000000003'::uuid, 'c0000000-0000-4000-a000-000000000011'::uuid),
  ('d0000000-0000-4000-a000-000000000003'::uuid, 'c0000000-0000-4000-a000-000000000008'::uuid),
  ('d0000000-0000-4000-a000-000000000002'::uuid, 'c0000000-0000-4000-a000-000000000005'::uuid),
  ('d0000000-0000-4000-a000-000000000004'::uuid, 'c0000000-0000-4000-a000-000000000016'::uuid),
  ('d0000000-0000-4000-a000-000000000003'::uuid, 'c0000000-0000-4000-a000-000000000016'::uuid),
  ('d0000000-0000-4000-a000-000000000004'::uuid, 'c0000000-0000-4000-a000-000000000019'::uuid)
) as l (user_id, card_id)
where not exists (
  select 1 from public.card_likes x where x.user_id = l.user_id and x.card_id = l.card_id
);

insert into public.card_comments (id, card_id, author_id, body)
values
  ('e0000000-0000-4000-a000-000000000001', 'c0000000-0000-4000-a000-000000000001', 'd0000000-0000-4000-a000-000000000002', 'That attack trigger is brutal with tokens. Love the flavor text.'),
  ('e0000000-0000-4000-a000-000000000002', 'c0000000-0000-4000-a000-000000000001', 'd0000000-0000-4000-a000-000000000003', 'Made a baby version of this — hope that''s ok!'),
  ('e0000000-0000-4000-a000-000000000003', 'c0000000-0000-4000-a000-000000000011', 'd0000000-0000-4000-a000-000000000002', 'The -2 feels right at four loyalty.')
on conflict (id) do nothing;

-- A view/share spread so Trending and Discover don't tie at zero.
update public.cards set view_count = v.views, share_count = v.shares
from (values
  ('c0000000-0000-4000-a000-000000000001'::uuid, 420, 12),
  ('c0000000-0000-4000-a000-000000000011'::uuid, 260, 7),
  ('c0000000-0000-4000-a000-000000000016'::uuid, 180, 4),
  ('c0000000-0000-4000-a000-000000000008'::uuid, 95, 2),
  ('c0000000-0000-4000-a000-000000000005'::uuid, 60, 1)
) as v (id, views, shares)
where cards.id = v.id and cards.view_count = 0;

-- ---------------------------------------------------------------------------
-- 4. Decks: one public Commander deck mixing custom cards with real-card rows
--    (no Scryfall ids → they render as "needs proxy"), one private draft.
-- ---------------------------------------------------------------------------

insert into public.decks (id, owner_id, title, slug, description, format, visibility, deck_type, bracket)
values
  ('b0000000-0000-4000-a000-000000000001', 'd0000000-0000-4000-a000-000000000002', 'Cinderwing Dragonstorm', 'cinderwing-dragonstorm', 'Dragons, ramp, and one very angry matriarch.', 'commander', 'public', 'Dragons', 3),
  ('b0000000-0000-4000-a000-000000000002', 'd0000000-0000-4000-a000-000000000003', 'Merfolk Tempo (WIP)', 'merfolk-tempo-wip', null, 'modern', 'private', null, null)
on conflict (id) do nothing;

insert into public.deck_cards (id, deck_id, board, quantity, position, card_id, name, type_line, mana_cost, mana_value, color_identity, rarity)
values
  ('a0000000-0000-4000-a000-000000000001', 'b0000000-0000-4000-a000-000000000001', 'commander', 1, 0, 'c0000000-0000-4000-a000-000000000001', 'Cinderwing Matriarch', 'Legendary Creature — Dragon', '{3}{R}{R}', 5, array['R'], 'mythic'),
  ('a0000000-0000-4000-a000-000000000002', 'b0000000-0000-4000-a000-000000000001', 'main', 1, 1, 'c0000000-0000-4000-a000-000000000017', 'Cinderwing Broodling', 'Creature — Dragon', '{1}{R}', 2, array['R'], 'uncommon'),
  ('a0000000-0000-4000-a000-000000000003', 'b0000000-0000-4000-a000-000000000001', 'main', 1, 2, 'c0000000-0000-4000-a000-000000000006', 'Emberlash', 'Instant', '{R}', 1, array['R'], 'common'),
  ('a0000000-0000-4000-a000-000000000004', 'b0000000-0000-4000-a000-000000000001', 'main', 1, 3, null, 'Sol Ring', 'Artifact', '{1}', 1, array[]::text[], 'uncommon'),
  ('a0000000-0000-4000-a000-000000000005', 'b0000000-0000-4000-a000-000000000001', 'main', 30, 4, null, 'Mountain', 'Basic Land — Mountain', null, 0, array['R'], 'common'),
  ('a0000000-0000-4000-a000-000000000006', 'b0000000-0000-4000-a000-000000000002', 'main', 4, 0, 'c0000000-0000-4000-a000-000000000002', 'Tidecaller Adept', 'Creature — Merfolk Wizard', '{1}{U}', 2, array['U'], 'common'),
  ('a0000000-0000-4000-a000-000000000007', 'b0000000-0000-4000-a000-000000000002', 'main', 20, 1, null, 'Island', 'Basic Land — Island', null, 0, array['U'], 'common')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Challenges + news. 0040 already ships the active "Arcane Frontiers"
--    challenge (two cards above carry its tag); add a CLOSED and an UPCOMING
--    one so every admin-list state renders.
-- ---------------------------------------------------------------------------

insert into public.challenges (id, slug, title, description, tag, starts_at, ends_at, featured)
values
  ('f0000000-0000-4000-a000-000000000001', 'tiny-titans', 'Tiny Titans', 'Design a creature with power 1 or less that still ends games. Closed — kept for the archive view.', 'tiny-titans', now() - interval '45 days', now() - interval '31 days', false),
  ('f0000000-0000-4000-a000-000000000002', 'lands-matter', 'Lands Matter', 'Make a land people would actually build around. Opens next week.', 'lands-matter', now() + interval '7 days', now() + interval '21 days', false)
on conflict (id) do nothing;

insert into public.site_updates (id, kind, title, summary, body, publish_at, is_published, show_in_banner, banner_scope, created_by)
values
  ('f1000000-0000-4000-a000-000000000001', 'update', 'Welcome to the dev forge', 'This is seeded test data — break things freely.', 'Every account, card and deck here comes from supabase/seeds/10_dev_data.sql. Nothing on this database is real, and nothing here reaches production.', now() - interval '2 days', true, true, 'site', 'd0000000-0000-4000-a000-000000000001'),
  ('f1000000-0000-4000-a000-000000000002', 'upcoming', 'Scheduled update (not yet live)', 'Tests the scheduler: visible to admins only until its publish time.', null, now() + interval '3 days', true, false, 'home', 'd0000000-0000-4000-a000-000000000001')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Revenue log (0110). dev_pro's last three renewals, so the admin Revenue
--    panel has rows on a fresh branch. No Stripe objects behind them.
-- ---------------------------------------------------------------------------

insert into public.billing_payments (
  invoice_id, user_id, stripe_customer_id, stripe_subscription_id, amount_cents, currency,
  billing_reason, tier, billing_interval, period_start, period_end, paid_at, invoice_number, hosted_invoice_url
)
values
  ('in_dev_pro_0001', 'd0000000-0000-4000-a000-000000000002', 'cus_dev_pro', 'sub_dev_pro', 1500, 'usd',
   'subscription_create', 'pro', 'month', now() - interval '90 days', now() - interval '60 days', now() - interval '90 days', 'DEV-0001', null),
  ('in_dev_pro_0002', 'd0000000-0000-4000-a000-000000000002', 'cus_dev_pro', 'sub_dev_pro', 1500, 'usd',
   'subscription_cycle', 'pro', 'month', now() - interval '60 days', now() - interval '30 days', now() - interval '60 days', 'DEV-0002', null),
  ('in_dev_pro_0003', 'd0000000-0000-4000-a000-000000000002', 'cus_dev_pro', 'sub_dev_pro', 1500, 'usd',
   'subscription_cycle', 'pro', 'month', now() - interval '30 days', now(), now() - interval '30 days', 'DEV-0003', null)
on conflict (invoice_id) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Funnel events (0112). A week of plausible steps so the admin Funnel
--    panel shows numbers on a fresh branch. Anonymous rows have no user id.
-- ---------------------------------------------------------------------------

insert into public.funnel_events (id, event, user_id, props, source, created_at)
select
  ('f2000000-0000-4000-a000-' || lpad(g::text, 12, '0'))::uuid,
  case
    when g <= 40 then 'pricing_view'
    when g <= 52 then 'cta_click'
    when g <= 58 then 'checkout_started'
    when g <= 61 then 'checkout_completed'
    when g <= 63 then 'checkout_expired'
    when g <= 66 then 'trial_started'
    when g <= 67 then 'trial_converted'
    when g <= 68 then 'trial_lapsed'
    when g <= 74 then 'upgrade_modal_open'
    when g <= 76 then 'pack_purchased'
    else 'payment_received'
  end,
  case when g % 3 = 0 then null else ('d0000000-0000-4000-a000-00000000000' || ((g % 5) + 1)::text)::uuid end,
  case
    when g <= 40 then jsonb_build_object('surface', 'pricing', 'signedIn', g % 3 <> 0)
    when g <= 52 then jsonb_build_object('surface', 'pricing', 'kind', 'subscription', 'tier', case when g % 2 = 0 then 'plus' else 'pro' end, 'period', 'monthly')
    when g <= 74 and g > 68 then jsonb_build_object('reason', case when g % 2 = 0 then 'credits' else 'hi_res_export' end)
    else '{}'::jsonb
  end,
  case when g <= 52 or (g > 68 and g <= 74) then 'client' else 'server' end,
  now() - (g % 7 || ' days')::interval - (g || ' minutes')::interval
from generate_series(1, 78) as g
on conflict (id) do nothing;

-- Signups with attribution, activity + milestones, and one trial for the
-- Activation / Signups-by-source / Trial-engagement sections (0112/0113).
insert into public.funnel_events (id, event, user_id, props, source, created_at)
values
  ('f3000000-0000-4000-a000-000000000001', 'signup', 'd0000000-0000-4000-a000-000000000003', '{"utmSource": "reddit", "utmMedium": "social", "utmCampaign": "proxy-guide"}', 'server', now() - interval '28 days'),
  ('f3000000-0000-4000-a000-000000000002', 'signup', 'd0000000-0000-4000-a000-000000000004', '{"referrer": "google.com"}', 'server', now() - interval '20 days'),
  ('f3000000-0000-4000-a000-000000000003', 'signup', 'd0000000-0000-4000-a000-000000000005', '{}', 'server', now() - interval '1 hour'),
  ('f3000000-0000-4000-a000-000000000004', 'first_card_saved', 'd0000000-0000-4000-a000-000000000003', '{"visibility": "public"}', 'server', now() - interval '29 days'),
  ('f3000000-0000-4000-a000-000000000005', 'first_card_saved', 'd0000000-0000-4000-a000-000000000004', '{"visibility": "public"}', 'server', now() - interval '19 days'),
  ('f3000000-0000-4000-a000-000000000006', 'first_ai_generation', 'd0000000-0000-4000-a000-000000000004', '{"kind": "card"}', 'server', now() - interval '19 days'),
  ('f3000000-0000-4000-a000-000000000007', 'first_download', 'd0000000-0000-4000-a000-000000000004', '{"format": "png"}', 'server', now() - interval '18 days'),
  ('f3000000-0000-4000-a000-000000000008', 'trial_started', 'd0000000-0000-4000-a000-000000000004', '{"tier": "pro", "interval": "month", "subscriptionId": "sub_dev_artist_trial"}', 'server', now() - interval '12 days'),
  ('f3000000-0000-4000-a000-000000000009', 'card_saved', 'd0000000-0000-4000-a000-000000000004', '{"visibility": "public"}', 'server', now() - interval '11 days'),
  ('f3000000-0000-4000-a000-00000000000a', 'ai_generation', 'd0000000-0000-4000-a000-000000000004', '{"kind": "card"}', 'server', now() - interval '11 days'),
  ('f3000000-0000-4000-a000-00000000000b', 'download', 'd0000000-0000-4000-a000-000000000004', '{"format": "pdf"}', 'server', now() - interval '9 days'),
  ('f3000000-0000-4000-a000-00000000000c', 'trial_lapsed', 'd0000000-0000-4000-a000-000000000004', '{"tier": "pro", "subscriptionId": "sub_dev_artist_trial"}', 'server', now() - interval '5 days')
on conflict (id) do nothing;


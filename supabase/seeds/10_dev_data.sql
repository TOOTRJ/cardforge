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
  -- A token's card types ride in supertype (TODO 3b.15): "Token Creature —
  -- Beast". Migration 0128 gives a stored P/T token the word; seeds run
  -- after the migrations, so the row says it itself.
  ('c0000000-0000-4000-a000-000000000015'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Beast', 'beast-token', null, array['green'], 'Creature', 'token', array['Beast'], 'common',
     null, null, '4', '4', null, 15, 'm15token', 'regular', 'public', null, array['tokens'], null, 'token', 4),
  -- The emblem Veyra's −7 leaves behind (TODO 6.23 / 4.52): its own card
  -- type on the emblem frame — the walker's name, "Emblem", colourless and
  -- common, no cost or stats (migration 0130 admits the type; seeds run
  -- after the migrations). The app never writes cards.layout, so neither
  -- does this row.
  ('c0000000-0000-4000-a000-000000000026'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Veyra, Stormbound', 'veyra-stormbound-emblem', null, array['colorless'], null, 'emblem', array[]::text[], 'common',
     E'Instant and sorcery spells you cast cost {2} less to cast.', null, null, null, null, 11, 'emblem', 'regular', 'public', null, array['emblems'], null, 'normal', 11),
  -- dev_pro — a few polished cards + a remix ---------------------------------
  ('c0000000-0000-4000-a000-000000000016'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'Archivist of Lost Hours', 'archivist-of-lost-hours', '{2}{U}', array['blue'], null, 'creature', array['Human','Wizard'], 'rare',
     E'Flash\nWhen Archivist of Lost Hours enters, return target instant card from your graveyard to your hand.', null, '2', '2', null, 16, 'm15', 'showcase', 'public', null, array['spellslinger'], null, 'normal', 18),
  ('c0000000-0000-4000-a000-000000000017'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'Cinderwing Broodling', 'cinderwing-broodling', '{1}{R}', array['red'], null, 'creature', array['Dragon'], 'uncommon',
     E'Flying\nCinderwing Broodling can''t block.', 'Dropped, and flying.', '2', '1', null, 17, 'm15', 'regular', 'public', 'c0000000-0000-4000-a000-000000000001'::uuid, array['dragons','remix'], null, 'normal', 9),
  ('c0000000-0000-4000-a000-000000000018'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'Unfinished Masterwork', 'unfinished-masterwork', '{4}', array['colorless'], null, 'artifact', array[]::text[], 'rare',
     E'Unfinished Masterwork enters tapped.', null, null, null, null, 18, 'm15artifact', 'regular', 'private', null, array[]::text[], null, 'normal', 2),
  -- …and one token of each other type the token picker makes (TODO 3b.15;
  -- dev_artist's Beast is the creature): an artifact token on the artifact
  -- token frame with no P/T ("Token Artifact — Treasure"), an enchantment
  -- creature ("Token Enchantment Creature — Glimmer") and a Copy with no
  -- type word at all (a bare "Token"). Public, so a preview shows the type
  -- line on each card page's "Card details". All three print text, so they
  -- sit on the text-box token frames, where the creator puts them (TODO
  -- 4.49 (b)); migration 0129 moves such rows, but seeds run after the
  -- migrations, so the row says it itself. The Beast has no text and keeps
  -- the textless frame.
  ('c0000000-0000-4000-a000-000000000023'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'Treasure', 'treasure-token', null, array['colorless'], 'Artifact', 'token', array['Treasure'], 'common',
     E'{T}, Sacrifice this token: Add one mana of any color.', null, null, null, null, 23, 'm15tokenartifacttext', 'regular', 'public', null, array['tokens'], null, 'token', 5),
  ('c0000000-0000-4000-a000-000000000024'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'Glimmer', 'glimmer-token', null, array['white'], 'Enchantment Creature', 'token', array['Glimmer'], 'common',
     E'Flying', null, '1', '1', null, 24, 'm15tokentext', 'regular', 'public', null, array['tokens'], null, 'token', 5),
  ('c0000000-0000-4000-a000-000000000025'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'Copy', 'copy-token', null, array['colorless'], null, 'token', array[]::text[], 'common',
     E'This token stands in for a copy of another permanent.', null, null, null, null, 25, 'm15tokentext', 'regular', 'public', null, array['tokens'], null, 'token', 5),
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
-- 2b. The anatomy switches (TODO 4.6.0; owner rule 2026-09-29): the printed
--     legendary crown and the two-colour frame are opt-in per card, stored as
--     frame_style.crown / frame_style.twoColor — absent = off. Both states of
--     each: Cinderwing Matriarch and Oath of the Hollow Crown (above) are the
--     cards stored before the pieces shipped (no key: drawn as before, the
--     editor shows the switch off with a hint); these carry the keys a new
--     card, an import or an owner's switch writes. m15 / m15artifact /
--     m15land draw the crown (4.6a: Kesh on, Varro off) and the two-colour
--     frame (4.6b: Aurelian Tidewright — with the split crown — Hedgerow
--     Mediator, Stormglass Strand, Brassbound Arbiter; Tidecaller Envoy and
--     Rotbloom Pact are stored with no key — gold until switched on)
--     (lib/cards/anatomy.ts). Duskmire Thicket is the owner's round-17 land
--     fix (owner 2026-09-30, pick (c)): a B|G land stored with NO template,
--     like production's Shadowwood Hollow / Sunfade Citadel — drawn on m15,
--     whose gold-split isn't a land's, so its editor offers no two-colour
--     switch or hint (twoColorFits). dev_pro's cards, so dev_artist's public
--     count stays 15 (14 + Veyra's emblem, 6.23), and UNLISTED — their owner
--     opens them from My Cards, anyone by link — so the seeded public gallery
--     stays on one 24-card page: the e2e gallery specs (seeded-data,
--     browse-filters, like-toggle) read page 1, and 8 more public rows pushed
--     Cinderwing Matriarch, Emberlash and Thornback Behemoth off it. Ids
--     …034–…052 (…026 is the emblems seed's: a reused id is a row that
--     silently never lands — tests/unit/devops/seed-card-ids.test.ts).
--     Seraphine and The Glass Reliquary (…048 / …049) are 4.6f's: stored on
--     the borderless frames with no key, before those drew the floating
--     crown and the pinline split; Hrafn, Frostfall Deeps and Rimewood
--     Clearing (…050–…052) wave 2c's, on the snow frames; …058–…060 are
--     4.10a's, on the 1997 frame.
-- ---------------------------------------------------------------------------

insert into public.cards (
  id, owner_id, game_system_id, title, slug, cost, color_identity, supertype,
  card_type, subtypes, rarity, rules_text, flavor_text, power, toughness,
  artist_credit, art_url, frame_style, visibility, created_at, updated_at
)
select
  c.id, 'd0000000-0000-4000-a000-000000000002'::uuid,
  (select id from public.game_systems order by created_at limit 1),
  c.title, c.slug, c.cost, c.colors, c.supertype, c.card_type, c.subtypes,
  c.rarity, c.rules_text, null, c.power, c.toughness,
  'PipGlyph Studio',
  'https://pipglyph.com/defaults/avatars/avatar-' || lpad(c.art::text, 2, '0') || '.webp',
  c.frame_style, 'unlisted',
  now() - (c.age_days || ' days')::interval,
  now() - (c.age_days || ' days')::interval
from (values
  -- A legendary mono card with the crown on (a new card's default).
  ('c0000000-0000-4000-a000-000000000034'::uuid, 'Kesh, Emberforge Warden', 'kesh-emberforge-warden', '{2}{R}{R}', array['red'], 'Legendary', 'creature', array['Dwarf','Artificer'], 'rare',
     E'Whenever an artifact you control enters, Kesh deals 1 damage to each opponent.', '3', '4', 3,
     '{"template":"m15","finish":"regular","crown":true}'::jsonb, 2),
  -- A legendary mono card with the crown explicitly off (an import of a
  -- crownless pre-2018 printing, or its owner's choice).
  ('c0000000-0000-4000-a000-000000000035'::uuid, 'Varro, the Unadorned', 'varro-the-unadorned', '{1}{B}{B}', array['black'], 'Legendary', 'creature', array['Human','Rogue'], 'rare',
     E'Menace\nVarro can''t be the target of spells your opponents control during your turn.', '3', '2', 6,
     '{"template":"m15","finish":"regular","crown":false}'::jsonb, 2),
  -- A WU gold legendary with both switches on: the gold-split frame and
  -- the split crown (4.6a + 4.6b).
  ('c0000000-0000-4000-a000-000000000036'::uuid, 'Aurelian Tidewright', 'aurelian-tidewright', '{1}{W}{U}', array['white','blue'], 'Legendary', 'creature', array['Human','Wizard'], 'mythic',
     E'Flying\nWhenever you cast your second spell each turn, draw a card.', '2', '3', 9,
     '{"template":"m15","finish":"regular","crown":true,"twoColor":true}'::jsonb, 1),
  -- A hybrid cost with the two-colour frame on: the hybrid dress.
  ('c0000000-0000-4000-a000-000000000037'::uuid, 'Hedgerow Mediator', 'hedgerow-mediator', '{G/W}{G/W}', array['green','white'], null, 'creature', array['Elf','Cleric'], 'uncommon',
     E'Vigilance\nWhen Hedgerow Mediator enters, you gain 2 life.', '2', '2', 12,
     '{"template":"m15","finish":"regular","twoColor":true}'::jsonb, 1),
  -- A WU land with the two-colour frame on: the land split.
  ('c0000000-0000-4000-a000-000000000038'::uuid, 'Stormglass Strand', 'stormglass-strand', null, array['white','blue'], null, 'land', array[]::text[], 'rare',
     E'Stormglass Strand enters tapped.\n{T}: Add {W} or {U}.', null, null, 15,
     '{"template":"m15land","finish":"regular","twoColor":true}'::jsonb, 1),
  -- TODO 4.6b: a WU pair stored BEFORE the two-colour frame shipped (no
  -- key): gold as always; the editor shows the switch off with the hint.
  ('c0000000-0000-4000-a000-000000000039'::uuid, 'Tidecaller Envoy', 'tidecaller-envoy', '{1}{W}{U}', array['white','blue'], null, 'creature', array['Merfolk','Advisor'], 'uncommon',
     E'Flying\nWhen Tidecaller Envoy enters, scry 2.', '2', '2', 18,
     '{"template":"m15","finish":"regular"}'::jsonb, 3),
  -- A plain "multicolor" card with a two-colour cost and no key: switching
  -- the frame on pre-fills Black + Green from the cost for its owner.
  ('c0000000-0000-4000-a000-000000000040'::uuid, 'Rotbloom Pact', 'rotbloom-pact', '{2}{B}{G}', array['multicolor'], null, 'creature', array['Fungus','Shaman'], 'rare',
     E'Deathtouch\nWhen Rotbloom Pact dies, create two 1/1 green Saproling creature tokens.', '3', '3', 21,
     '{"template":"m15","finish":"regular"}'::jsonb, 3),
  -- A WU artifact with the two-colour frame on: the artifact frame, gold
  -- bars, the split pinline and text box.
  ('c0000000-0000-4000-a000-000000000041'::uuid, 'Brassbound Arbiter', 'brassbound-arbiter', '{2}{W}{U}', array['white','blue'], 'Artifact', 'creature', array['Construct'], 'rare',
     E'Vigilance\nArtifact spells you cast cost {1} less to cast.', '3', '4', 24,
     '{"template":"m15artifact","finish":"regular","twoColor":true}'::jsonb, 1),
  -- Owner round 17's land fix (pick (c), 2026-09-30): a B|G land stored
  -- with NO template — frame_style '{}', exactly production's Shadowwood
  -- Hollow — so it draws on m15. Its editor shows no two-colour switch or
  -- hint (a land wears the pairs only on the land frame), and a save never
  -- stores the switch; it stays gold. The pair is stored the way the AI
  -- writes one (both words + "multicolor", colorWordsFromLetters); the pair
  -- rule reads it as B|G, the same as Shadowwood Hollow's ['black','green'].
  ('c0000000-0000-4000-a000-000000000042'::uuid, 'Duskmire Thicket', 'duskmire-thicket', null, array['black','green','multicolor'], null, 'land', array[]::text[], 'uncommon',
     E'Duskmire Thicket enters tapped.\nWhen Duskmire Thicket enters, surveil 1.\n{T}: Add {B} or {G}.', null, null, 20,
     '{}'::jsonb, 1),
  -- TODO 4.6f (wave 2a): the borderless frames draw the floating crown and
  -- the pinline-split pair. Two cards stored BEFORE they did (no key): a WU
  -- legendary on m15borderless — gold pinline, no crown; its editor shows
  -- both switches off with their hints, and switching them on draws the
  -- split pinline and the split floating crown — and a legendary colourless
  -- artifact on the artifact dress (the crown hint only; its crown is CC's
  -- artifact crown).
  ('c0000000-0000-4000-a000-000000000048'::uuid, 'Seraphine, Tidewarden', 'seraphine-tidewarden', '{2}{W}{U}', array['white','blue'], 'Legendary', 'creature', array['Angel','Wizard'], 'mythic',
     E'Flying, vigilance\nWhenever Seraphine attacks, tap target creature an opponent controls.', '3', '4', 7,
     '{"template":"m15borderless","finish":"regular"}'::jsonb, 3),
  ('c0000000-0000-4000-a000-000000000049'::uuid, 'The Glass Reliquary', 'the-glass-reliquary', '{3}', array['colorless'], 'Legendary', 'artifact', array[]::text[], 'rare',
     E'{T}: Add one mana of any colour.\n{3}, {T}: Draw a card.', null, null, 11,
     '{"template":"m15borderlessartifact","finish":"regular"}'::jsonb, 3),
  -- TODO 4.6f (wave 2c): the snow frames draw the standard crown band and
  -- the split pairs (m15snow's white-bar pair, m15snowland's dual-land
  -- pair). Two cards stored BEFORE they did (no key): a U|B legendary snow
  -- creature on m15snow — gold bars and pinline, no crown; its editor shows
  -- both switches off with their hints, and switching them on draws the
  -- white-bar pair under the split crown (KHM #224's look) — and a
  -- legendary colourless snow land on m15snowland (the crown hint only:
  -- the land grey band, DMR #244's look); and a G|W snow dual stored the
  -- way a new card is, with the switch on: the land split (KHM #249's).
  ('c0000000-0000-4000-a000-000000000050'::uuid, 'Hrafn, Rimewarden', 'hrafn-rimewarden', '{3}{U}{B}', array['blue','black'], 'Legendary Snow', 'creature', array['Zombie','Wizard'], 'rare',
     E'Other snow creatures you control get +1/+1.\n{S}{S}{S}: Return Hrafn from your graveyard to the battlefield tapped.', '4', '3', 14,
     '{"template":"m15snow","finish":"regular"}'::jsonb, 3),
  ('c0000000-0000-4000-a000-000000000051'::uuid, 'Frostfall Deeps', 'frostfall-deeps', null, array['colorless'], 'Legendary Snow', 'land', array[]::text[], 'mythic',
     E'Frostfall Deeps enters with ten ice counters on it.\n{3}: Remove an ice counter from Frostfall Deeps.', null, null, 17,
     '{"template":"m15snowland","finish":"regular"}'::jsonb, 3),
  ('c0000000-0000-4000-a000-000000000052'::uuid, 'Rimewood Clearing', 'rimewood-clearing', null, array['green','white'], 'Snow', 'land', array['Forest','Plains'], 'common',
     E'({T}: Add {G} or {W}.)\nRimewood Clearing enters tapped.', null, null, 22,
     '{"template":"m15snowland","finish":"regular","twoColor":true}'::jsonb, 1),
  -- TODO 4.10a (layout v46): the 1997 frame on the ORIGINAL cards — white
  -- lettering with a hard shadow, the centred `Illus.` footer with the
  -- pipglyph.com mark in its © slot, flat discs and the 1997 tap. A red
  -- creature (cost, P/T, {T} and {R} in its text), a colourless ARTIFACT
  -- (`c` paints the artifact frame) and a land on `retroland`. Neither
  -- template is ticked until the owner verifies it after the merge: these
  -- rows are for looking at (an admin edits them with
  -- `?previewFrames=retro,retroland`). Ids …058–…060.
  ('c0000000-0000-4000-a000-000000000058'::uuid, 'Cinderpeak Wyrm', 'cinderpeak-wyrm', '{4}{R}{R}', array['red'], null, 'creature', array['Dragon'], 'rare',
     E'Flying
{R}: Cinderpeak Wyrm gets +1/+0 until end of turn.
{T}: Cinderpeak Wyrm deals 1 damage to any target.', '5', '5', 1,
     '{"template":"retro","finish":"regular"}'::jsonb, 1),
  ('c0000000-0000-4000-a000-000000000059'::uuid, 'Lodestone Compass', 'lodestone-compass', '{2}', array['colorless'], null, 'artifact', array[]::text[], 'uncommon',
     E'{T}: Add {C}.
{2}, {T}: Look at the top card of your library.', null, null, 8,
     '{"template":"retro","finish":"regular"}'::jsonb, 1),
  ('c0000000-0000-4000-a000-000000000060'::uuid, 'Saltmarsh Causeway', 'saltmarsh-causeway', null, array['colorless'], null, 'land', array[]::text[], 'uncommon',
     E'{T}: Add {C}.
{T}, Sacrifice Saltmarsh Causeway: Destroy target nonbasic land.', null, null, 10,
     '{"template":"retroland","finish":"regular"}'::jsonb, 1),
  -- TODO 4.10b (layout v47): the 2003 frame's one sweep — Card Conjurer's
  -- sharp masters, the P/T box at its printed size, print-sized lettering,
  -- the brush and the artist over the pipglyph.com mark in the © slot, cost
  -- discs with a shadow straight down. A three-colour GOLD creature (the
  -- master is that look; {T} and a pip in its text; a two-digit P/T), a
  -- colourless ARTIFACT (`c` paints the artifact frame) and a land on
  -- `modernland` (white footer). Both templates are ticked on production;
  -- on a fresh database an admin edits these with
  -- `?previewFrames=modern,modernland`. Ids …061–…063.
  ('c0000000-0000-4000-a000-000000000061'::uuid, 'Thornscale Behemoth', 'thornscale-behemoth', '{3}{R}{G}{W}', array['red','green','white'], null, 'creature', array['Beast'], 'rare',
     E'Trample
{T}: Add {R}, {G} or {W}.
Whenever Thornscale Behemoth attacks, it gets +2/+2 until end of turn.', '10', '10', 3,
     '{"template":"modern","finish":"regular"}'::jsonb, 1),
  ('c0000000-0000-4000-a000-000000000062'::uuid, 'Brass Orrery', 'brass-orrery', '{3}', array['colorless'], null, 'artifact', array[]::text[], 'uncommon',
     E'{T}: Add {C}.
{3}, {T}: Draw a card.', null, null, 9,
     '{"template":"modern","finish":"regular"}'::jsonb, 1),
  ('c0000000-0000-4000-a000-000000000063'::uuid, 'Hollowmere Crossing', 'hollowmere-crossing', null, array['colorless'], null, 'land', array[]::text[], 'uncommon',
     E'{T}: Add {C}.
{2}, {T}: Target creature can''t be blocked this turn.', null, null, 12,
     '{"template":"modernland","finish":"regular"}'::jsonb, 1)
) as c (id, title, slug, cost, colors, supertype, card_type, subtypes, rarity,
        rules_text, power, toughness, art, frame_style, age_days)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2c. The collector fields (TODO 4.9a, migration 0133): what a printing's
--     collector line says, as card data — the PRINTED set code, the number
--     in its era's style and the language. Nothing draws them yet (4.9b);
--     the Set & collector info step shows them. One of each case the import
--     produces: a 2015-era rare ("DMU", "107/281" — number/printed size), a
--     2023-era card ("FDN", "1" — the number alone), a Spanish card (lang
--     'es', prints SP), a token (its PARENT set's code, "1/16" from the
--     token set's count) and an EMPTY-fields card imported from a real
--     printing (source_scryfall_id = Scryfall's DMU #107, a public id — the
--     step offers "Fill from the printing" on it). dev_pro's, UNLISTED like
--     2b's, so the seeded public gallery stays on one 24-card page for the
--     e2e gallery specs. Ids …043–…047 (tests/unit/devops/seed-card-ids.
--     test.ts). Seeds run after the migrations, so the columns exist.
-- ---------------------------------------------------------------------------

insert into public.cards (
  id, owner_id, game_system_id, title, slug, cost, color_identity, supertype,
  card_type, subtypes, rarity, rules_text, flavor_text, power, toughness,
  artist_credit, art_url, frame_style, visibility, set_code, collector_number,
  lang, source_scryfall_id, tags, layout, created_at, updated_at
)
select
  c.id, 'd0000000-0000-4000-a000-000000000002'::uuid,
  (select id from public.game_systems order by created_at limit 1),
  c.title, c.slug, c.cost, c.colors, c.supertype, c.card_type, c.subtypes,
  c.rarity, c.rules_text, null, c.power, c.toughness,
  'PipGlyph Studio',
  'https://pipglyph.com/defaults/avatars/avatar-' || lpad(c.art::text, 2, '0') || '.webp',
  jsonb_build_object('template', c.template, 'finish', 'regular'),
  'unlisted', c.set_code, c.collector_number, c.lang, c.source_scryfall_id, c.tags,
  c.layout,
  now() - (c.age_days || ' days')::interval,
  now() - (c.age_days || ' days')::interval
from (values
  -- A 2015-era mythic as the import stores one: number / printed size.
  ('c0000000-0000-4000-a000-000000000043'::uuid, 'Ashveil Praetor', 'ashveil-praetor', '{2}{B}{B}', array['black'], 'Legendary', 'creature', array['Phyrexian','Praetor'], 'mythic',
     E'Deathtouch\nWhenever you draw a card, you gain 2 life.\nWhenever an opponent draws a card, they lose 2 life.', '4', '5', 4, 'm15',
     'DMU', '107/281', 'en', null::text, array['collector'], 'normal', 2),
  -- A 2023-era rare: the number alone.
  ('c0000000-0000-4000-a000-000000000044'::uuid, 'Dawnbreak Herald', 'dawnbreak-herald', '{1}{W}{W}', array['white'], null, 'creature', array['Angel'], 'rare',
     E'Flying, vigilance\nWhen Dawnbreak Herald enters, you gain 3 life.', '3', '3', 7, 'm15',
     'FDN', '1', 'en', null, array['collector'], 'normal', 2),
  -- A Spanish printing (lang es prints "SP" once the line is drawn).
  ('c0000000-0000-4000-a000-000000000045'::uuid, 'Centinela del Alba', 'centinela-del-alba', '{1}{W}', array['white'], null, 'creature', array['Human','Soldier'], 'common',
     E'Vigilancia\nCuando el Centinela del Alba entre al campo de batalla, ganas 1 vida.', '2', '2', 10, 'm15',
     'DMU', '42/281', 'es', null, array['collector'], 'normal', 2),
  -- A token: its PARENT set's code and the token set's count.
  ('c0000000-0000-4000-a000-000000000046'::uuid, 'Knight', 'knight-token-collector', null, array['white'], 'Creature', 'token', array['Knight'], 'common',
     E'Vigilance', '2', '2', 13, 'm15tokentext',
     'DOM', '1/16', 'en', null, array['tokens','collector'], 'token', 2),
  -- Imported from a real printing (DMU #107) with the fields still empty:
  -- the step offers "Fill from the printing".
  ('c0000000-0000-4000-a000-000000000047'::uuid, 'Apocalypse Praetor (proxy)', 'apocalypse-praetor-proxy', '{2}{B}{B}', array['black'], 'Legendary', 'creature', array['Phyrexian','Praetor'], 'mythic',
     E'Deathtouch\nWhenever you draw a card, you gain 2 life.', '4', '5', 16, 'm15',
     null, null, 'en', 'd67be074-cdd4-41d9-ac89-0a0456c4e4b2', array['proxy','collector'], 'normal', 1)
) as c (id, title, slug, cost, colors, supertype, card_type, subtypes, rarity,
        rules_text, power, toughness, art, template,
        set_code, collector_number, lang, source_scryfall_id, tags, layout, age_days)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2d. Double-faced cards (TODO 5.2; design 2026-10-02): ONE row holds both
--     faces — the front on a transform FRONT body, the back in `back_face`
--     with its own BODY (`frame_style.template`, a back body) and COLOUR
--     (`color_identity`), the card's icon family in frame_style.dfcIcon
--     (`arrows` = the ▼-right back). dev_pro's, ids …053–…056 (…050–…052
--     are 4.6f wave 2c's). Seeds never pass the frame gate, so these sit on
--     the bodies before the owner ticks them (after 5.3): the Transform chip
--     stays dark on a branch, and the stored rows still render through the
--     live preview (no stored bake; the back bake is 5.3's). One PUBLIC row — the 24th public card, the
--     last that fits the seeded gallery's one page (the e2e gallery specs,
--     see 2b) — the rest unlisted or private:
--       …053 a public transform creature // creature, both arts, both bodies;
--       …054 a private draft with an UNNAMED back (a draft may, 3b.5);
--       …055 a transform LAND front // creature back (the land pair's front,
--            colourless, stored with the `c` row 5.1a verifies it on);
--       …056 a LEGACY-shaped `back_face` on m15 — the shape of the 8 imported
--            double-faced cards: content only, no body, no colour — for the
--            editor's one-click move onto the real frames (owner Q3:
--            "Move onto the transform frames" on its Identity step);
--       …057 a MODAL instant // land on 5.1b's bodies (MH3 #241's shape:
--            the front's strip prints "Land · {T}: Add {U}.", the back's
--            "Instant · {2}{U}"), both arts, no family (the housing has
--            none). Unlisted.
-- ---------------------------------------------------------------------------

insert into public.cards (
  id, owner_id, game_system_id, title, slug, cost, color_identity, supertype,
  card_type, subtypes, rarity, rules_text, flavor_text, power, toughness,
  artist_credit, art_url, frame_style, back_face, visibility, tags, layout,
  created_at, updated_at
)
select
  c.id, 'd0000000-0000-4000-a000-000000000002'::uuid,
  (select id from public.game_systems order by created_at limit 1),
  c.title, c.slug, c.cost, c.colors, c.supertype, c.card_type, c.subtypes,
  c.rarity, c.rules_text, c.flavor_text, c.power, c.toughness,
  'PipGlyph Studio',
  'https://pipglyph.com/defaults/avatars/avatar-' || lpad(c.art::text, 2, '0') || '.webp',
  c.frame_style,
  c.back_face
    || jsonb_build_object(
         'artist_credit', 'PipGlyph Studio',
         'art_position', jsonb_build_object('focalX', 0.5, 'focalY', 0.5, 'scale', 1)
       )
    || case when c.back_art is null then '{}'::jsonb
            else jsonb_build_object('art_url', 'https://pipglyph.com/defaults/avatars/avatar-' || lpad(c.back_art::text, 2, '0') || '.webp') end,
  c.visibility, c.tags, 'normal',
  now() - (c.age_days || ' days')::interval,
  now() - (c.age_days || ' days')::interval
from (values
  -- A public transform creature // creature: a green werewolf, both faces
  -- with art, the back on the ▼-right back body in its own (green) colour.
  ('c0000000-0000-4000-a000-000000000053'::uuid, 'Thornhollow Villager', 'thornhollow-villager', '{2}{G}', array['green'], null, 'creature', array['Human','Werewolf'], 'uncommon',
     E'Daybound (If a player casts no spells during their own turn, it becomes night next turn.)', 'By day a woodcutter. By night, the wood cuts back.', '2', '2', 2,
     '{"template":"m15dfcfront","finish":"regular","collector":"2023","dfcIcon":"arrows"}'::jsonb,
     '{"title":"Thornhollow Howler","card_type":"creature","subtypes":["Werewolf"],"power":"4","toughness":"3","rules_text":"Trample\nNightbound (If a player casts at least two spells during their own turn, it becomes day next turn.)","frame_style":{"template":"m15dfcback"},"color_identity":["green"]}'::jsonb,
     5, 'public', array['werewolves','transform'], 1),
  -- A private draft with an UNNAMED back: a draft may leave the second
  -- face unnamed (3b.5); publishing it needs the back's name and art.
  ('c0000000-0000-4000-a000-000000000054'::uuid, 'Unfinished Delver', 'unfinished-delver', '{U}', array['blue'], null, 'creature', array['Human','Wizard'], 'common',
     E'At the beginning of your upkeep, look at the top card of your library.', null, '1', '1', 8,
     '{"template":"m15dfcfront","finish":"regular","collector":"2023","dfcIcon":"sunmoon"}'::jsonb,
     '{"title":"","card_type":"creature","subtypes":["Human","Insect"],"power":"3","toughness":"2","frame_style":{"template":"m15dfcbackleft"},"color_identity":["blue"]}'::jsonb,
     null, 'private', array['transform'], 1),
  -- A transform LAND front // creature back: the land front (no cost,
  -- colourless — one master under every key, verified on `c`) with a red
  -- creature on the ▼-right back in its own colour. Unlisted.
  ('c0000000-0000-4000-a000-000000000055'::uuid, 'Emberfall Shrine', 'emberfall-shrine', null, array['colorless'], null, 'land', array[]::text[], 'rare',
     E'{T}: Add {C}.\n{3}{R}, {T}: Transform Emberfall Shrine. Activate only as a sorcery.', null, null, null, 12,
     '{"template":"m15dfclandfront","finish":"regular","collector":"2023","dfcIcon":"arrows"}'::jsonb,
     '{"title":"Emberfall, Awakened","card_type":"creature","supertype":"Legendary","subtypes":["Elemental","Spirit"],"power":"5","toughness":"5","rules_text":"Haste\nWhenever Emberfall, Awakened attacks, it deals 2 damage to each opponent.","frame_style":{"template":"m15dfcback"},"color_identity":["red"]}'::jsonb,
     14, 'unlisted', array['transform','lands'], 1),
  -- A LEGACY double-faced card: the shape the 8 imported ones store — the
  -- front on m15, the back CONTENT only (no body, no colour), drawn on the
  -- front's frame and colour. Its editor offers the one-click move.
  ('c0000000-0000-4000-a000-000000000056'::uuid, 'Moorland Chaplain', 'moorland-chaplain', '{1}{W}', array['white'], null, 'creature', array['Human','Cleric','Werewolf'], 'uncommon',
     E'Daybound', 'She tends the flock. Some nights she is the wolf.', '2', '2', 17,
     '{"template":"m15","finish":"regular","collector":"2023","crown":true,"twoColor":true}'::jsonb,
     '{"title":"Moorland Ravager","card_type":"creature","subtypes":["Werewolf"],"power":"3","toughness":"3","rules_text":"Nightbound\nMoorland Ravager has lifelink as long as it''s night."}'::jsonb,
     19, 'unlisted', array['transform','legacy'], 2),
  -- A modal double-faced instant // land (TODO 5.1b's bodies): the front on
  -- the modal front body, the back — a land, with its own mana ability for
  -- the front's strip — on the modal land back in its own (blue) colour.
  ('c0000000-0000-4000-a000-000000000057'::uuid, 'Tidewater Reverie', 'tidewater-reverie', '{2}{U}', array['blue'], null, 'instant', array[]::text[], 'uncommon',
     E'Return target spell or nonland permanent to its owner''s hand.', 'The tide takes what the shore forgets.', null, null, 21,
     '{"template":"m15mdfcfront","finish":"regular","collector":"2023"}'::jsonb,
     '{"title":"Tidewater Shoals","card_type":"land","subtypes":[],"rules_text":"As Tidewater Shoals enters, you may pay 3 life. If you don''t, it enters tapped.\n{T}: Add {U}.","frame_style":{"template":"m15mdfclandback"},"color_identity":["blue"]}'::jsonb,
     22, 'unlisted', array['modal','lands'], 1)
) as c (id, title, slug, cost, colors, supertype, card_type, subtypes, rarity,
        rules_text, flavor_text, power, toughness, art, frame_style, back_face,
        back_art, visibility, tags, age_days)
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


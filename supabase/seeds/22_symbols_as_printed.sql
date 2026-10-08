-- ---------------------------------------------------------------------------
-- 22_symbols_as_printed.sql — two cards that carry the symbols layout v49
-- drew on the prints (TODO 6.16b; lib/cards/mana-gem.ts, docs/FRAMES.md
-- "Symbols as printed"), so a preview branch, the dev database and the local
-- stack have something to look at: the Phyrexian pip on its larger disc and
-- the two-colour Phyrexian disc in a cost AND in rules text, the white-on-
-- black untap symbol, the white snow flake, the disc-less energy symbol,
-- and flat pips in the rules text under a shadowed cost row.
--
-- Runs after 10_dev_data.sql (config.toml → [db.seed] sql_paths, filename
-- order). Never against production. Idempotent: fixed ids + ON CONFLICT DO
-- NOTHING. No credential in here (the repo is public). dev_pro's cards,
-- UNLISTED like 10_dev_data.sql's 2b / 2c rows — their owner opens them from
-- My Cards, anyone by link — so the seeded public gallery stays on one
-- 24-card page for the e2e gallery specs. No stored render: tiles fall back
-- to the live preview, and saving one in the editor bakes it. A row whose
-- account is missing (this file run on its own) is skipped. Ids …067–…068
-- (…064–…066 are the 1993 frame's, 4.10c; tests/unit/devops/
-- seed-card-ids.test.ts).
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
  -- Phyrexian mana: {B/P} (one colour) and {G/U/P} (two) in the cost — both
  -- discs 1.2x the {1} beside them — and in the text, where the line makes
  -- room for the larger discs; {Q} is the white arrow on the black disc.
  ('c0000000-0000-4000-a000-000000000067'::uuid, 'Gristlevat Savant', 'gristlevat-savant', '{1}{G/U/P}{B/P}', array['green','blue','black','multicolor'], null, 'creature', array['Phyrexian','Wizard'], 'rare',
     E'Compleated ({G/U/P} can be paid with {G}, {U}, or 2 life.)
{B/P}, {Q}: Put a +1/+1 counter on target creature. ({B/P} can be paid with either {B} or 2 life.)', '2', '3', 7,
     '{"template":"m15","finish":"regular"}'::jsonb, 1),
  -- Snow and energy: {S} is the white flake on the generic disc, in the
  -- cost and in the text; {E} is the bare symbol in a pip's cell; {T} and
  -- {2} beside them are flat in the text (the cost row keeps its shadow).
  ('c0000000-0000-4000-a000-000000000068'::uuid, 'Rimeglass Dynamo', 'rimeglass-dynamo', '{2}{S}{S}', array['colorless'], 'Snow', 'artifact', array[]::text[], 'uncommon',
     E'{S}, {T}: You get {E}{E}. ({S} can be paid with one mana from a snow source.)
{2}, Pay {E}{E}{E}: Draw a card.', null, null, 9,
     '{"template":"m15","finish":"regular"}'::jsonb, 1)
) as c (id, title, slug, cost, colors, supertype, card_type, subtypes, rarity,
        rules_text, power, toughness, art, frame_style, age_days)
where exists (select 1 from public.profiles where id = 'd0000000-0000-4000-a000-000000000002'::uuid)
on conflict (id) do nothing;

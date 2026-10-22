-- ---------------------------------------------------------------------------
-- 24_card_nickname.sql — two cards with a NICKNAME (TODO 6.3, migration
-- 0141), so a preview branch, the dev database and the local stack have
-- something to look at: the nickname in the title bar and the card's own
-- name on the plate under it (lib/cards/nickname.ts) — a two-colour card on
-- its pair dress (the plate's rim in both colours) and a colourless artifact.
--
-- Runs after 10_dev_data.sql (config.toml → [db.seed] sql_paths, filename
-- order). Never against production. Idempotent: fixed ids + ON CONFLICT DO
-- NOTHING. No credential in here (the repo is public). dev_pro's cards,
-- UNLISTED like 22_symbols_as_printed.sql's — their owner opens them from
-- My Cards, anyone by link — so the seeded public gallery stays on one
-- 24-card page for the e2e gallery specs. No stored render: tiles fall back
-- to the live preview, and saving one in the editor bakes it. A row whose
-- account is missing (this file run on its own) is skipped. Ids …6a1–…6a2
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
  id, owner_id, game_system_id, title, nickname, slug, cost, color_identity, supertype,
  card_type, subtypes, rarity, rules_text, flavor_text, power, toughness,
  artist_credit, art_url, frame_style, visibility, created_at, updated_at
)
select
  c.id, 'd0000000-0000-4000-a000-000000000002'::uuid,
  (select id from public.game_systems order by created_at limit 1),
  c.title, c.nickname, c.slug, c.cost, c.colors, c.supertype, c.card_type, c.subtypes,
  c.rarity, c.rules_text, null, c.power, c.toughness,
  'PipGlyph Studio',
  'https://pipglyph.com/defaults/avatars/avatar-' || lpad(c.art::text, 2, '0') || '.webp',
  c.frame_style, 'unlisted',
  now() - (c.age_days || ' days')::interval,
  now() - (c.age_days || ' days')::interval
from (values
  -- A green-white card on m15's split pair: "The Verdant Sovereign" in the
  -- title bar, "Thornmane Lion" on the plate, its rim green | white.
  ('c0000000-0000-4000-a000-0000000006a1'::uuid, 'Thornmane Lion', 'The Verdant Sovereign', 'thornmane-lion', '{G}{W}', array['green','white','multicolor'], null, 'creature', array['Cat'], 'rare',
     E'{3}{G}{W}: Monstrosity 1.\nAs long as Thornmane Lion is monstrous, it has hexproof and indestructible.', '3', '3', 4,
     '{"template":"m15","finish":"regular","twoColor":true}'::jsonb, 1),
  -- A colourless artifact: the plate's rim in the artifact frame's silver.
  ('c0000000-0000-4000-a000-0000000006a2'::uuid, 'Spyglass Idol', 'The Watcher’s Eye', 'spyglass-idol', '{5}', array['colorless'], null, 'artifact', array[]::text[], 'uncommon',
     E'{4}, {T}: Draw a card.', null, null, 11,
     '{"template":"m15artifact","finish":"regular"}'::jsonb, 1)
) as c (id, title, nickname, slug, cost, colors, supertype, card_type, subtypes, rarity,
        rules_text, power, toughness, art, frame_style, age_days)
where exists (select 1 from public.profiles where id = 'd0000000-0000-4000-a000-000000000002'::uuid)
on conflict (id) do nothing;

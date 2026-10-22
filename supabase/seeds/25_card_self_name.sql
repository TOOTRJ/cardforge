-- ---------------------------------------------------------------------------
-- 25_card_self_name.sql — two cards whose rules text says `~` / CARDNAME
-- (TODO 6.2, lib/cards/self-name.ts), so a preview branch, the dev database
-- and the local stack have something to look at:
--
--   * Kessig Ironbark — `~` and CARDNAME drawn as its NICKNAME ("The Old
--     Oak"), which its title bar prints;
--   * Rimeward Sentry — a card as migration 0142 leaves one stored before
--     the change (`frame_style.selfName: "literal"`): its `~` prints as
--     typed, and its editor offers "Print ~ as the card's name".
--
-- Runs after 24_card_nickname.sql (config.toml → [db.seed] sql_paths,
-- filename order). Never against production. Idempotent: fixed ids + ON
-- CONFLICT DO NOTHING. No credential in here (the repo is public). dev_pro's
-- cards, UNLISTED (as 22 / 24: the seeded public gallery stays on one page).
-- No stored render. Ids …6a3–…6a4 (tests/unit/devops/seed-card-ids.test.ts).
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
  ('c0000000-0000-4000-a000-0000000006a3'::uuid, 'Kessig Ironbark', 'The Old Oak', 'kessig-ironbark', '{3}{G}', array['green'], null, 'creature', array['Treefolk'], 'uncommon',
     E'Reach\nWhen ~ enters, you gain 3 life.\nCARDNAME gets +2/+2 as long as you control a Forest.', '2', '5', 13,
     '{"template":"m15","finish":"regular"}'::jsonb, 1),
  ('c0000000-0000-4000-a000-0000000006a4'::uuid, 'Rimeward Sentry', null, 'rimeward-sentry', '{1}{U}', array['blue'], null, 'creature', array['Human','Soldier'], 'common',
     E'Flash\n~ can block an additional creature each combat.', '1', '3', 15,
     '{"template":"m15","finish":"regular","selfName":"literal"}'::jsonb, 1)
) as c (id, title, nickname, slug, cost, colors, supertype, card_type, subtypes, rarity,
        rules_text, power, toughness, art, frame_style, age_days)
where exists (select 1 from public.profiles where id = 'd0000000-0000-4000-a000-000000000002'::uuid)
on conflict (id) do nothing;

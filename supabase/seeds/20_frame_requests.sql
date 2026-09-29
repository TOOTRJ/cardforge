-- ---------------------------------------------------------------------------
-- 20_frame_requests.sql — synthetic "most-requested missing frames" rows
-- (migration 0120, TODO 1.6) so /admin/frame-requests has something to show
-- on a preview branch, the dev database and the local stack.
--
-- Runs after 10_dev_data.sql (config.toml → [db.seed] sql_paths, filename
-- order). Never against production. Idempotent: fixed ids + ON CONFLICT DO
-- NOTHING. user_id is null on purpose (no account made these imports), so a
-- seeded row counts 0 distinct users until someone imports that printing.
--
-- Every signature is a real registry key (FRAME_SIGNATURE_KEYS in
-- lib/scryfall/frame-signatures.ts) with the registry's label, and every
-- printing is a real Scryfall printing that resolves to it (the fixtures in
-- tests/unit/scryfall/fixtures/signature-printings.json). DMU #435 is the
-- manual-test printing: importing it with artwork bumps the first row.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed frame requests: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.frame_requests (
  id, user_id, signature, label, set_code, collector_number, scryfall_id,
  status, template, art_flag, source, created_at
)
values
  -- Sheoldred, the Apocalypse DMU #435: borderless with the legendary crown (4.6)
  ('fa000000-0000-4000-a000-000000000001', null, 'borderless/standard+crown', 'Borderless frame', 'dmu', '435', '8df6603a-38c1-4d18-8b84-6211e9a7cc09', 'nearest', 'm15', 'window-cropped', 'import', now() - interval '2 days'),
  ('fa000000-0000-4000-a000-000000000002', null, 'borderless/standard+crown', 'Borderless frame', 'dmu', '435', '8df6603a-38c1-4d18-8b84-6211e9a7cc09', 'nearest', 'm15', null, 'import', now() - interval '6 days'),
  ('fa000000-0000-4000-a000-000000000003', null, 'borderless/standard+crown', 'Borderless frame', 'dmu', '435', '8df6603a-38c1-4d18-8b84-6211e9a7cc09', 'nearest', 'm15', 'window-cropped', 'deck_prefill', now() - interval '45 days'),
  -- Oko, Thief of Crowns ELD #271: borderless planeswalker (4.33)
  ('fa000000-0000-4000-a000-000000000004', null, 'borderless/planeswalker', 'Borderless planeswalker', 'eld', '271', '95da027e-34c1-4098-827d-1647693ad8f4', 'nearest', 'm15pw', 'window-cropped', 'import', now() - interval '3 days'),
  -- Plains ZNR #266: split-bar full-art basic (4.40)
  ('fa000000-0000-4000-a000-000000000005', null, 'fullart/basic/split-bar', 'Zendikar-style full-art basic land (split type bar)', 'znr', '266', '9591fd15-78d9-4089-a075-031ab2affd2d', 'nearest', 'm15fullartland', 'frame-in-crop', 'import', now() - interval '9 days'),
  -- Heliod, Sun-Crowned THB #259: constellation showcase (4.11)
  ('fa000000-0000-4000-a000-000000000006', null, 'showcase/thb/constellation', 'Theros Beyond Death constellation showcase', 'thb', '259', 'e11cf760-da35-41f2-8cf5-a5141103eeb3', 'nearest', 'm15', null, 'import', now() - interval '12 days'),
  -- Valkyrie's Call FDN #27: the Nyx starfield on a modern enchantment (4.7)
  ('fa000000-0000-4000-a000-000000000007', null, 'era/2015+nyx', 'M15 (2015) frame', 'fdn', '27', '0e1f1ff2-fa8f-4d38-b631-2d6e08e614c8', 'nearest', 'm15', null, 'deck_prefill', now() - interval '20 days'),
  -- Aven Mindcensor FUT #18: the Future Sight frame (4.15)
  ('fa000000-0000-4000-a000-000000000008', null, 'future', 'Future Sight frame', 'fut', '18', '5b8ede8a-5317-4662-b964-a9bd202a4aab', 'unsupported', 'm15', null, 'import', now() - interval '120 days'),
  -- Overlord of the Floodpits DSK #389: Japan showcase, full art
  ('fa000000-0000-4000-a000-000000000009', null, 'japan-showcase', 'Japan showcase', 'dsk', '389', '3194a6f4-f994-494c-aa29-1de8af48a3f1', 'nearest', 'm15', 'frame-in-crop', 'import', now() - interval '15 days'),
  -- Unsupported for good (collapsed on the admin page): a poster, The Zeta Set
  ('fa000000-0000-4000-a000-00000000000a', null, 'borderless/poster', 'Artist-lettered borderless poster', 'spg', '119', 'f461d613-518f-41cf-b08f-0778d40d3cf7', 'unsupported', 'm15', 'frame-in-crop', 'import', now() - interval '4 days'),
  ('fa000000-0000-4000-a000-00000000000b', null, 'frameless/slz', 'The Zeta Set frameless typeset card', 'slz', '46', '5165917b-4d9c-4dc4-917b-a3a17d5869f7', 'unsupported', 'm15', 'frame-in-crop', 'import', now() - interval '8 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 21_frame_requests.sql — synthetic "most-requested missing frames" rows
-- (migration 0123, TODO 1.6) so /admin/frame-requests has something to show
-- on a preview branch, the dev database and the local stack.
--
-- Runs after 10_dev_data.sql (config.toml → [db.seed] sql_paths, filename
-- order). Never against production. Idempotent: fixed ids + ON CONFLICT DO
-- NOTHING. Most rows have no user (no account made those imports, so they
-- count 0 distinct users); a few are dev_* accounts from 10_dev_data.sql, so
-- the page's order — distinct users first, then requests (D4) — shows: the
-- Japan showcase (2 users, 2 requests) outranks Sheoldred (0 users, 3). A
-- row whose dev account is missing (this file run on its own) is skipped.
--
-- Both groups (D1): cause 'missing' (the registry has no exact frame) and
-- 'unverified' (its exact frame isn't verified in the card's colour: Heliod
-- on Nyx, the FDN full-art Plains on the Full-Art Basic — neither is in
-- supabase/seed.sql's verified list).
--
-- Every signature is a real registry key (FRAME_SIGNATURE_KEYS in
-- lib/scryfall/frame-signatures.ts) with the registry's label, and every
-- printing is a real Scryfall printing that resolves to it (the fixtures in
-- tests/unit/scryfall/fixtures/signature-printings.json) — except
-- 'retired/seed-example', a key no rule has, planted on purpose so the
-- page's "not in registry" flag (D6) has a row to show.
-- tests/unit/frames/frame-requests.test.ts holds all of that.
-- DMU #435 is the manual-test printing: importing it with artwork bumps the
-- Sheoldred row.
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
  status, cause, template, art_flag, source, created_at
)
select
  v.id::uuid, v.user_id::uuid, v.signature, v.label, v.set_code, v.collector_number,
  v.scryfall_id::uuid, v.status, v.cause, v.template, v.art_flag, v.source, v.created_at
from (values
  -- Missing frames ----------------------------------------------------------
  -- Sheoldred, the Apocalypse DMU #435: borderless with the legendary crown (4.6)
  ('fa000000-0000-4000-a000-000000000001', null, 'borderless/standard+crown', 'Borderless frame', 'dmu', '435', '8df6603a-38c1-4d18-8b84-6211e9a7cc09', 'nearest', 'missing', 'm15', 'window-cropped', 'import', now() - interval '2 days'),
  ('fa000000-0000-4000-a000-000000000002', null, 'borderless/standard+crown', 'Borderless frame', 'dmu', '435', '8df6603a-38c1-4d18-8b84-6211e9a7cc09', 'nearest', 'missing', 'm15', null, 'import', now() - interval '6 days'),
  ('fa000000-0000-4000-a000-000000000003', null, 'borderless/standard+crown', 'Borderless frame', 'dmu', '435', '8df6603a-38c1-4d18-8b84-6211e9a7cc09', 'nearest', 'missing', 'm15', 'window-cropped', 'deck_prefill', now() - interval '45 days'),
  ('fa000000-0000-4000-a000-00000000000c', null, 'borderless/standard+crown', 'Borderless frame', 'dmu', '435', '8df6603a-38c1-4d18-8b84-6211e9a7cc09', 'nearest', 'missing', 'm15', 'window-cropped', 'import', now() - interval '1 day'),
  -- Oko, Thief of Crowns ELD #271: borderless planeswalker (4.33)
  ('fa000000-0000-4000-a000-000000000004', null, 'borderless/planeswalker', 'Borderless planeswalker', 'eld', '271', '95da027e-34c1-4098-827d-1647693ad8f4', 'nearest', 'missing', 'm15pw', 'window-cropped', 'import', now() - interval '3 days'),
  -- Plains ZNR #266: split-bar full-art basic (4.40)
  ('fa000000-0000-4000-a000-000000000005', null, 'fullart/basic/split-bar', 'Zendikar-style full-art basic land (split type bar)', 'znr', '266', '9591fd15-78d9-4089-a075-031ab2affd2d', 'nearest', 'missing', 'm15fullartland', 'frame-in-crop', 'import', now() - interval '9 days'),
  -- Valkyrie's Call FDN #27: the Nyx starfield on a modern enchantment (4.7)
  ('fa000000-0000-4000-a000-000000000007', null, 'era/2015+nyx', 'M15 (2015) frame', 'fdn', '27', '0e1f1ff2-fa8f-4d38-b631-2d6e08e614c8', 'nearest', 'missing', 'm15', null, 'deck_prefill', now() - interval '20 days'),
  -- Aven Mindcensor FUT #18: the Future Sight frame (4.15)
  ('fa000000-0000-4000-a000-000000000008', null, 'future', 'Future Sight frame', 'fut', '18', '5b8ede8a-5317-4662-b964-a9bd202a4aab', 'unsupported', 'missing', 'm15', null, 'import', now() - interval '120 days'),
  -- Overlord of the Floodpits DSK #389: Japan showcase, full art — two dev accounts
  ('fa000000-0000-4000-a000-000000000009', 'd0000000-0000-4000-a000-000000000002', 'japan-showcase', 'Japan showcase', 'dsk', '389', '3194a6f4-f994-494c-aa29-1de8af48a3f1', 'nearest', 'missing', 'm15', 'frame-in-crop', 'import', now() - interval '15 days'),
  ('fa000000-0000-4000-a000-00000000000f', 'd0000000-0000-4000-a000-000000000004', 'japan-showcase', 'Japan showcase', 'dsk', '389', '3194a6f4-f994-494c-aa29-1de8af48a3f1', 'nearest', 'missing', 'm15', 'frame-in-crop', 'import', now() - interval '10 days'),
  -- A key no registry rule has (a renamed / removed rule): flagged on the page (D6)
  ('fa000000-0000-4000-a000-000000000010', null, 'retired/seed-example', 'Retired rule (seeded example)', null, null, null, 'nearest', 'missing', 'm15', null, 'import', now() - interval '25 days'),
  -- Not yet verified ----------------------------------------------------------
  -- Heliod, Sun-Crowned THB #259: constellation showcase, exact on Nyx (A3) — Nyx isn't verified in white
  ('fa000000-0000-4000-a000-000000000006', 'd0000000-0000-4000-a000-000000000002', 'showcase/thb/constellation', 'Theros Beyond Death constellation showcase', 'thb', '259', 'e11cf760-da35-41f2-8cf5-a5141103eeb3', 'nearest', 'unverified', 'm15', null, 'import', now() - interval '12 days'),
  -- Plains FDN #282: the 2022 full-art basic, exact on m15fullartland — not verified in white
  ('fa000000-0000-4000-a000-00000000000d', 'd0000000-0000-4000-a000-000000000004', 'fullart/basic/2022', 'Full-art basic land', 'fdn', '282', '6e6f19b3-4c76-4078-8ed2-b2832a33d066', 'nearest', 'unverified', 'm15land', 'frame-in-crop', 'import', now() - interval '5 days'),
  ('fa000000-0000-4000-a000-00000000000e', 'd0000000-0000-4000-a000-000000000003', 'fullart/basic/2022', 'Full-art basic land', 'fdn', '282', '6e6f19b3-4c76-4078-8ed2-b2832a33d066', 'nearest', 'unverified', 'm15land', null, 'deck_prefill', now() - interval '7 days'),
  -- Unsupported for good (collapsed on the admin page): a poster, The Zeta Set
  ('fa000000-0000-4000-a000-00000000000a', null, 'borderless/poster', 'Artist-lettered borderless poster', 'spg', '119', 'f461d613-518f-41cf-b08f-0778d40d3cf7', 'unsupported', 'missing', 'm15', 'frame-in-crop', 'import', now() - interval '4 days'),
  ('fa000000-0000-4000-a000-00000000000b', null, 'frameless/slz', 'The Zeta Set frameless typeset card', 'slz', '46', '5165917b-4d9c-4dc4-917b-a3a17d5869f7', 'unsupported', 'missing', 'm15', 'frame-in-crop', 'import', now() - interval '8 days')
) as v (
  id, user_id, signature, label, set_code, collector_number, scryfall_id,
  status, cause, template, art_flag, source, created_at
)
where v.user_id is null
   or exists (select 1 from auth.users u where u.id = v.user_id::uuid)
on conflict (id) do nothing;

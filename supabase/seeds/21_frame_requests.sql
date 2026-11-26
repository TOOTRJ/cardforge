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
-- Japan showcase (3 users, 3 requests) outranks Zilortha (2 users, 6). A
-- row whose dev account is missing (this file run on its own) is skipped.
--
-- The public /frames/requested list (migration 0148, TODO NV12) counts the
-- same rows by PEOPLE — only rows with an account, never an admin's, before
-- today's UTC midnight (every row here is a day old or more) — and shows a
-- frame only once TWO people asked (k = 2). So: the Japan showcase reads
-- "2 people" although dev_admin logged it too (…0013, on purpose); Zilortha
-- (dev_free + dev_artist) and Fire // Ice (dev_pro + dev_artist) reach two;
-- Oko stays at one dev_free row, so it is the frame k keeps off the list.
--
-- Both groups (D1): cause 'missing' (the registry has no exact frame) and
-- 'unverified' (its exact frame isn't verified in the card's colour: Fire //
-- Ice on the split frame — not verified in production, so not in
-- supabase/seed.sql, which mirrors it; the test re-derives every row
-- against seed.sql's list. Never a frame production ticked: Heliod on Nyx
-- and A Tale for the Ages on extended art left with the 2026-11-22
-- refresh, as the FDN full-art Plains did before them).
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
  -- Zilortha, Strength Incarnate IKO #275: borderless with the nickname line
  -- (4.11). (Sheoldred DMU #435 sat here until Borderless drew its crown,
  -- 4.6f: it imports exact now.)
  ('fa000000-0000-4000-a000-000000000001', null, 'borderless/standard+nickname', 'Borderless frame', 'iko', '275', '9a0639a0-c898-4a07-975c-a02bdd53175b', 'nearest', 'missing', 'm15', 'window-cropped', 'import', now() - interval '2 days'),
  ('fa000000-0000-4000-a000-000000000002', null, 'borderless/standard+nickname', 'Borderless frame', 'iko', '275', '9a0639a0-c898-4a07-975c-a02bdd53175b', 'nearest', 'missing', 'm15', null, 'import', now() - interval '6 days'),
  ('fa000000-0000-4000-a000-000000000003', null, 'borderless/standard+nickname', 'Borderless frame', 'iko', '275', '9a0639a0-c898-4a07-975c-a02bdd53175b', 'nearest', 'missing', 'm15', 'window-cropped', 'deck_prefill', now() - interval '45 days'),
  ('fa000000-0000-4000-a000-00000000000c', null, 'borderless/standard+nickname', 'Borderless frame', 'iko', '275', '9a0639a0-c898-4a07-975c-a02bdd53175b', 'nearest', 'missing', 'm15', 'window-cropped', 'import', now() - interval '1 day'),
  ('fa000000-0000-4000-a000-000000000011', 'd0000000-0000-4000-a000-000000000003', 'borderless/standard+nickname', 'Borderless frame', 'iko', '275', '9a0639a0-c898-4a07-975c-a02bdd53175b', 'nearest', 'missing', 'm15', 'window-cropped', 'import', now() - interval '3 days'),
  ('fa000000-0000-4000-a000-000000000014', 'd0000000-0000-4000-a000-000000000004', 'borderless/standard+nickname', 'Borderless frame', 'iko', '275', '9a0639a0-c898-4a07-975c-a02bdd53175b', 'nearest', 'missing', 'm15', 'window-cropped', 'import', now() - interval '8 days'),
  -- Oko, Thief of Crowns ELD #271: borderless planeswalker (4.33) in two
  -- colours, whose split frame is 4.6's
  ('fa000000-0000-4000-a000-000000000004', null, 'borderless/planeswalker+two-colour', 'Borderless planeswalker', 'eld', '271', '95da027e-34c1-4098-827d-1647693ad8f4', 'nearest', 'missing', 'm15pw', 'window-cropped', 'import', now() - interval '3 days'),
  ('fa000000-0000-4000-a000-000000000012', 'd0000000-0000-4000-a000-000000000003', 'borderless/planeswalker+two-colour', 'Borderless planeswalker', 'eld', '271', '95da027e-34c1-4098-827d-1647693ad8f4', 'nearest', 'missing', 'm15pw', 'window-cropped', 'import', now() - interval '11 days'),
  -- Plains ZNR #266: split-bar full-art basic (4.40) — Zendikar Rising's
  -- type line sits further right than the stone-ring frame (owner Round 64)
  ('fa000000-0000-4000-a000-000000000005', null, 'fullart/basic/split-bar+znr-type-line', 'Zendikar-style full-art basic land (split type bar)', 'znr', '266', '9591fd15-78d9-4089-a075-031ab2affd2d', 'nearest', 'missing', 'm15fullartland', 'frame-in-crop', 'import', now() - interval '9 days'),
  -- (Valkyrie's Call FDN #27, era/2015+nyx, sat here — id …0007 — until
  -- production ticked m15nyx in every colour on 2026-10-14: it imports exact
  -- now, so no import logs it.)
  -- Aven Mindcensor FUT #18: the Future Sight frame (4.15)
  ('fa000000-0000-4000-a000-000000000008', null, 'future', 'Future Sight frame', 'fut', '18', '5b8ede8a-5317-4662-b964-a9bd202a4aab', 'unsupported', 'missing', 'm15', null, 'import', now() - interval '120 days'),
  -- Overlord of the Floodpits DSK #389: Japan showcase, full art — two dev accounts
  ('fa000000-0000-4000-a000-000000000009', 'd0000000-0000-4000-a000-000000000002', 'japan-showcase', 'Japan showcase', 'dsk', '389', '3194a6f4-f994-494c-aa29-1de8af48a3f1', 'nearest', 'missing', 'm15', 'frame-in-crop', 'import', now() - interval '15 days'),
  ('fa000000-0000-4000-a000-00000000000f', 'd0000000-0000-4000-a000-000000000004', 'japan-showcase', 'Japan showcase', 'dsk', '389', '3194a6f4-f994-494c-aa29-1de8af48a3f1', 'nearest', 'missing', 'm15', 'frame-in-crop', 'import', now() - interval '10 days'),
  -- …and dev_admin: counted on the admin page, never on the public list (0148)
  ('fa000000-0000-4000-a000-000000000013', 'd0000000-0000-4000-a000-000000000001', 'japan-showcase', 'Japan showcase', 'dsk', '389', '3194a6f4-f994-494c-aa29-1de8af48a3f1', 'nearest', 'missing', 'm15', 'frame-in-crop', 'import', now() - interval '6 days'),
  -- A key no registry rule has (a renamed / removed rule): flagged on the page (D6)
  ('fa000000-0000-4000-a000-000000000010', null, 'retired/seed-example', 'Retired rule (seeded example)', null, null, null, 'nearest', 'missing', 'm15', null, 'import', now() - interval '25 days'),
  -- Not yet verified ----------------------------------------------------------
  -- (Heliod THB #259 on Nyx — ids …0006 / …0015 — and A Tale for the Ages
  -- WOE #328 on extended art — …000d / …000e — sat here until production
  -- ticked both frames: they import exact now, so no import logs them.)
  -- Fire // Ice DMR #215: exact on the split frame, which production hasn't
  -- verified in any colour (frames audit 2026-11-22)
  ('fa000000-0000-4000-a000-000000000016', 'd0000000-0000-4000-a000-000000000002', 'layout/2015', 'Split frame', 'dmr', '215', '18303862-4726-4136-814f-157aa7006579', 'nearest', 'unverified', 'split', null, 'import', now() - interval '12 days'),
  ('fa000000-0000-4000-a000-000000000017', 'd0000000-0000-4000-a000-000000000004', 'layout/2015', 'Split frame', 'dmr', '215', '18303862-4726-4136-814f-157aa7006579', 'nearest', 'unverified', 'split', null, 'deck_prefill', now() - interval '7 days'),
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

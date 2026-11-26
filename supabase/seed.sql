-- ---------------------------------------------------------------------------
-- Seed file. Applied AFTER all migrations by `supabase start` / `supabase db reset`
-- (config.toml → [db.seed]) AND by the Supabase GitHub integration whenever a
-- preview branch is created for a PR. It never runs against production (merge
-- applies migrations only; `supabase db push` never executes seeds). Preview
-- branches are shared, publicly reachable databases — never put local-only
-- conveniences (fixed admin users, dev flags) here.
--
-- Keep this minimal: baseline rows the app expects to exist, not sample
-- content. For a test user + admin flag, run `node scripts/seed-e2e.mjs`
-- after the stack is up (it needs the API, not raw SQL).
-- ---------------------------------------------------------------------------

-- Baseline rows: frame_reviews. Frame verification is the ONLY gate the
-- creator has (lib/cards/frame-availability.ts) — with this table empty,
-- /create renders every frame as a disabled "Soon" chip, on every preview
-- branch and fresh `supabase db reset`. Profiles come from the auth trigger
-- (0001) and storage buckets from migrations, so nothing else is required.
--
-- This list MIRRORS PRODUCTION: the (template, color_key) combos the owner has
-- verified in /admin/frame-compare, snapshotted 2026-11-22 (655 combos). When
-- more frames get verified on prod, refresh it from:
--
--   select template, color_key, verified_layout_version
--   from frame_reviews where verified order by template, color_key;
--
-- (or anonymously over REST — the table is world-readable by policy:
-- /rest/v1/frame_reviews?verified=eq.true&select=template,color_key,verified_layout_version).
-- A template verified in all seven colour keys at ONE layout version goes in
-- the first list, with that version in the table under it; any other combo
-- is its own row in the second, with its own version.
--
-- Do NOT add frames here that aren't verified on production — a preview that
-- offers a frame prod hides is a preview that lies. (scripts/seed-e2e.mjs
-- re-asserts the few templates the e2e suite needs, for a local stack whose
-- database predates a refresh; every one of them is in this list.)
-- tests/unit/cards/seed-frames.test.ts checks every template below is a real
-- FrameTemplate, so a rename can't silently orphan a row, that the count
-- above matches the rows, and that every template of the first list has
-- exactly one version.
--
-- The verdict is mirrored, and so is the layout version production's tick
-- recorded (0115's verified_layout_version; NULL = a tick from before 0115):
-- lib/cards/dfc.ts seeThroughTickKeys publishes a modal body's see-through
-- `c` only from a tick at v75 or later, so without it a colourless modal face
-- (TODO 5.11a) is refused on every seeded database while production offers
-- it, and /admin/frame-compare on a branch judges each tick at the version
-- production's was made at. verified_by stays NULL (no profiles exist yet),
-- and so do the pinned reference (reference_*) and the rest of what the tick
-- measured (verified_override_hash, verified_reference_id, score_json).
-- `on conflict do nothing` never overrides a row that already exists on the
-- dev branch or a local stack (a withdrawn tick, a pinned reference, a
-- version): re-seeding only adds missing combos.
--
-- A refresh does NOT reach the shared dev branch by itself. The Supabase CLI
-- records every seed file it has run (supabase_migrations.seed_files) and
-- never runs one again: for a CHANGED file, `db push --include-seed` (what
-- `npm run db:seed:dev` runs) only records the new hash. After a refresh,
-- run the frame_reviews block below on the dev branch by hand (its SQL
-- editor); a combo production withdraws has to be unticked there by hand too,
-- and a row the dev branch already holds keeps its own version (the PR that
-- refreshes the list names the one UPDATE a gate needs).
-- Fresh databases (a PR's preview branch, `db reset`, CI) run the whole file.

-- frame_reviews:begin
insert into public.frame_reviews (template, color_key, verified, verified_at, verified_layout_version)
select t.template, c.color_key, true, now(), v.verified_layout_version
from unnest(array[
  'adventure',
  'aftermath',
  'agclassic',
  'alphaland',
  'avatar',
  'bloomanime',
  'bloomburrow',
  'breakingnews',
  'dndsourcebook',
  'dossier',
  'emblem',
  'enchantingtales',
  'extendedart',
  'extendedartland',
  'extendedartprepare',
  'extendedartstation',
  'flip',
  'fullart',
  'lotr',
  'lotrscroll',
  'm15',
  'm15artifact',
  'm15borderless',
  'm15borderlessartifact',
  'm15borderlessdfcback',
  'm15borderlessdfcfront',
  'm15borderlessland',
  'm15borderlessmdfcback',
  'm15borderlessmdfcfront',
  'm15borderlesspw',
  'm15borderlesspwtall',
  'm15borderlessstation',
  'm15devoid',
  'm15dfcback',
  'm15dfcbackleft',
  'm15dfcfront',
  'm15dfclandback',
  'm15dfclandfront',
  'm15fullartlandsnc',
  'm15fullartlandthb',
  'm15fullartlandzen',
  'm15land',
  'm15mdfcback',
  'm15mdfcfront',
  'm15mdfclandback',
  'm15mdfclandfront',
  'm15nyx',
  'm15pw',
  'm15snowland',
  'm15station',
  'm15stationland',
  'm15token',
  'm15tokenartifact',
  'm15tokenartifacttall',
  'm15tokenartifacttext',
  'm15tokentall',
  'm15tokentext',
  'm15ubartifact',
  'm15ubland',
  'm15vehicle',
  'm20token',
  'm20tokenartifact',
  'm20tokenartifactnyx',
  'm20tokenartifactnyxtall',
  'm20tokenartifactnyxtext',
  'm20tokenartifacttall',
  'm20tokenartifacttext',
  'm20tokennyx',
  'm20tokennyxtall',
  'm20tokennyxtext',
  'm20tokentall',
  'm20tokentext',
  'modern',
  'modernland',
  'mysticalarchive',
  'prepare',
  'retro',
  'retroland',
  'saga',
  'sagacreature',
  'sagadfcback',
  'sagadfcfront',
  'sncartdeco',
  'stainedglass',
  'tardis',
  'tarkirdraconic',
  'tarkirdragon',
  'tarkirghostfire'
]) as t (template)
cross join unnest(array['w', 'u', 'b', 'r', 'g', 'c', 'm']) as c (color_key)
-- The layout version production's tick recorded, per template of the list
-- above (NULL: ticked before 0115).
left join (values
  ('adventure',               41),
  ('aftermath',               41),
  ('agclassic',               48),
  ('alphaland',               48),
  ('avatar',                  75),
  ('bloomanime',              75),
  ('bloomburrow',             75),
  ('breakingnews',            75),
  ('dndsourcebook',           75),
  ('dossier',                 75),
  ('emblem',                  35),
  ('enchantingtales',         75),
  ('extendedart',             75),
  ('extendedartland',         75),
  ('extendedartprepare',      75),
  ('extendedartstation',      75),
  ('flip',                    41),
  ('fullart',                 75),
  ('lotr',                    75),
  ('lotrscroll',              75),
  ('m15',                     null),
  ('m15artifact',             null),
  ('m15borderless',           32),
  ('m15borderlessartifact',   32),
  ('m15borderlessdfcback',    75),
  ('m15borderlessdfcfront',   75),
  ('m15borderlessland',       35),
  ('m15borderlessmdfcback',   75),
  ('m15borderlessmdfcfront',  75),
  ('m15borderlesspw',         75),
  ('m15borderlesspwtall',     75),
  ('m15borderlessstation',    75),
  ('m15devoid',               null),
  ('m15dfcback',              41),
  ('m15dfcbackleft',          41),
  ('m15dfcfront',             41),
  ('m15dfclandback',          41),
  ('m15dfclandfront',         41),
  ('m15fullartlandsnc',       75),
  ('m15fullartlandthb',       75),
  ('m15fullartlandzen',       75),
  ('m15land',                 74),
  ('m15mdfcback',             75),
  ('m15mdfcfront',            75),
  ('m15mdfclandback',         41),
  ('m15mdfclandfront',        41),
  ('m15nyx',                  53),
  ('m15pw',                   75),
  ('m15snowland',             75),
  ('m15station',              54),
  ('m15stationland',          75),
  ('m15token',                75),
  ('m15tokenartifact',        75),
  ('m15tokenartifacttall',    75),
  ('m15tokenartifacttext',    75),
  ('m15tokentall',            75),
  ('m15tokentext',            75),
  ('m15ubartifact',           54),
  ('m15ubland',               75),
  ('m15vehicle',              53),
  ('m20token',                35),
  ('m20tokenartifact',        35),
  ('m20tokenartifactnyx',     75),
  ('m20tokenartifactnyxtall', 75),
  ('m20tokenartifactnyxtext', 75),
  ('m20tokenartifacttall',    35),
  ('m20tokenartifacttext',    35),
  ('m20tokennyx',             75),
  ('m20tokennyxtall',         75),
  ('m20tokennyxtext',         75),
  ('m20tokentall',            35),
  ('m20tokentext',            35),
  ('modern',                  47),
  ('modernland',              47),
  ('mysticalarchive',         75),
  ('prepare',                 75),
  ('retro',                   46),
  ('retroland',               46),
  ('saga',                    43),
  ('sagacreature',            75),
  ('sagadfcback',             75),
  ('sagadfcfront',            75),
  ('sncartdeco',              75),
  ('stainedglass',            75),
  ('tardis',                  75),
  ('tarkirdraconic',          75),
  ('tarkirdragon',            75),
  ('tarkirghostfire',         75)
) as v (template, verified_layout_version) using (template)
on conflict (template, color_key) do nothing;

-- Partially verified templates — verified in only some colours, or at more
-- than one layout version: one row per combo. The Expeditions in the keys production ticked
-- (expeditionland r / c / m, expeditionlandbfz c / m); the two older full-art
-- basics with gold ticked later than the rest; m15snow, ticked before and
-- after 0115; m15ub, whose colourless see-through master (layout v57) was
-- ticked on its own; the constellation showcase (nyx) in every key but c.
insert into public.frame_reviews (template, color_key, verified, verified_at, verified_layout_version)
values
  ('expeditionland', 'r', true, now(), 75),
  ('expeditionland', 'c', true, now(), 75),
  ('expeditionland', 'm', true, now(), 75),
  ('expeditionlandbfz', 'c', true, now(), 75),
  ('expeditionlandbfz', 'm', true, now(), 75),
  ('fullartland', 'w', true, now(), 32),
  ('fullartland', 'u', true, now(), 32),
  ('fullartland', 'b', true, now(), 32),
  ('fullartland', 'r', true, now(), 32),
  ('fullartland', 'g', true, now(), 32),
  ('fullartland', 'c', true, now(), 32),
  ('fullartland', 'm', true, now(), 75),
  ('m15fullartland', 'w', true, now(), 32),
  ('m15fullartland', 'u', true, now(), 32),
  ('m15fullartland', 'b', true, now(), 32),
  ('m15fullartland', 'r', true, now(), 32),
  ('m15fullartland', 'g', true, now(), 32),
  ('m15fullartland', 'c', true, now(), 32),
  ('m15fullartland', 'm', true, now(), 75),
  ('m15snow', 'w', true, now(), 33),
  ('m15snow', 'u', true, now(), null),
  ('m15snow', 'b', true, now(), 33),
  ('m15snow', 'r', true, now(), null),
  ('m15snow', 'g', true, now(), 33),
  ('m15snow', 'c', true, now(), null),
  ('m15snow', 'm', true, now(), null),
  ('m15ub', 'w', true, now(), 54),
  ('m15ub', 'u', true, now(), 54),
  ('m15ub', 'b', true, now(), 54),
  ('m15ub', 'r', true, now(), 54),
  ('m15ub', 'g', true, now(), 54),
  ('m15ub', 'c', true, now(), 57),
  ('m15ub', 'm', true, now(), 54),
  ('nyx', 'w', true, now(), 75),
  ('nyx', 'u', true, now(), 75),
  ('nyx', 'b', true, now(), 75),
  ('nyx', 'r', true, now(), 75),
  ('nyx', 'g', true, now(), 75),
  ('nyx', 'm', true, now(), 75)
on conflict (template, color_key) do nothing;
-- frame_reviews:end

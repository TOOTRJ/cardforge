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
-- verified in /admin/frame-compare, snapshotted 2026-09-30 (194 combos). When
-- more frames get verified on prod, refresh it from:
--
--   select template, string_agg(color_key, '' order by color_key)
--   from frame_reviews where verified group by template order by template;
--
-- (or anonymously over REST — the table is world-readable by policy:
-- /rest/v1/frame_reviews?verified=eq.true&select=template,color_key).
-- A template verified in all seven colour keys goes in the first list; any
-- other combo is its own row in the second.
--
-- Do NOT add frames here that aren't verified on production — a preview that
-- offers a frame prod hides is a preview that lies. (The e2e suite needs one
-- extra, agclassic; scripts/seed-e2e.mjs adds that for the local stack only.)
-- tests/unit/cards/seed-frames.test.ts checks every template below is a real
-- FrameTemplate, so a rename can't silently orphan a row, and that the count
-- above matches the rows.
--
-- Only the verdict is mirrored. verified_by stays NULL (no profiles exist
-- yet), and so do the pinned reference (reference_*) and what production's
-- tick measured (0115: verified_layout_version, verified_override_hash,
-- verified_reference_id, score_json) — /admin/frame-compare on a branch reads
-- these rows as ticks from before 0115. `on conflict do nothing` never
-- overrides a row that already exists on the dev branch or a local stack (a
-- withdrawn tick, a pinned reference): re-seeding only adds missing combos.
--
-- A refresh does NOT reach the shared dev branch by itself. The Supabase CLI
-- records every seed file it has run (supabase_migrations.seed_files) and
-- never runs one again: for a CHANGED file, `db push --include-seed` (what
-- `npm run db:seed:dev` runs) only records the new hash. After a refresh,
-- run the frame_reviews block below on the dev branch by hand (its SQL
-- editor); a combo production withdraws has to be unticked there by hand too.
-- Fresh databases (a PR's preview branch, `db reset`, CI) run the whole file.

-- frame_reviews:begin
insert into public.frame_reviews (template, color_key, verified, verified_at)
select t.template, c.color_key, true, now()
from unnest(array[
  'emblem',
  'm15',
  'm15artifact',
  'm15borderless',
  'm15borderlessartifact',
  'm15borderlessland',
  'm15borderlesspw',
  'm15borderlesspwtall',
  'm15devoid',
  'm15land',
  'm15pw',
  'm15snow',
  'm15snowland',
  'm15token',
  'm15tokenartifact',
  'm15tokenartifacttext',
  'm15tokentext',
  'm20token',
  'm20tokenartifact',
  'm20tokenartifacttall',
  'm20tokenartifacttext',
  'm20tokentall',
  'm20tokentext',
  'modern',
  'modernland',
  'saga'
]) as t (template)
cross join unnest(array['w', 'u', 'b', 'r', 'g', 'c', 'm']) as c (color_key)
on conflict (template, color_key) do nothing;

-- Partially verified templates: only the listed colors. The two full-art
-- basics are verified in every colour but gold (m).
insert into public.frame_reviews (template, color_key, verified, verified_at)
values
  ('fullartland', 'w', true, now()),
  ('fullartland', 'u', true, now()),
  ('fullartland', 'b', true, now()),
  ('fullartland', 'r', true, now()),
  ('fullartland', 'g', true, now()),
  ('fullartland', 'c', true, now()),
  ('m15fullartland', 'w', true, now()),
  ('m15fullartland', 'u', true, now()),
  ('m15fullartland', 'b', true, now()),
  ('m15fullartland', 'r', true, now()),
  ('m15fullartland', 'g', true, now()),
  ('m15fullartland', 'c', true, now())
on conflict (template, color_key) do nothing;
-- frame_reviews:end

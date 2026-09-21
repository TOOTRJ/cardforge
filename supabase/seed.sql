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
-- verified in /admin/frame-compare, snapshotted 2026-09-21 (71 combos). When
-- more frames get verified on prod, refresh it from:
--
--   select template, string_agg(color_key, '') from frame_reviews
--   where verified group by template order by template;
--
-- Do NOT add frames here that aren't verified on production — a preview that
-- offers a frame prod hides is a preview that lies. (The e2e suite needs one
-- extra, agclassic; scripts/seed-e2e.mjs adds that for the local stack only.)
-- tests/unit/cards/seed-frames.test.ts checks every template below is a real
-- FrameTemplate, so a rename can't silently orphan a row.
--
-- verified_by stays NULL (no profiles exist yet) and reference_scryfall_id is
-- NULL on prod too.

-- frame_reviews:begin
insert into public.frame_reviews (template, color_key, verified, verified_at)
select t.template, c.color_key, true, now()
from unnest(array[
  'm15',
  'm15artifact',
  'm15devoid',
  'm15land',
  'm15pw',
  'm15snow',
  'm15snowland',
  'm15token',
  'm15tokenartifact',
  'saga'
]) as t (template)
cross join unnest(array['w', 'u', 'b', 'r', 'g', 'c', 'm']) as c (color_key)
on conflict (template, color_key) do nothing;

-- Partially verified templates: only the listed colors.
insert into public.frame_reviews (template, color_key, verified, verified_at)
values
  ('modern', 'w', true, now())
on conflict (template, color_key) do nothing;
-- frame_reviews:end

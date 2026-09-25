-- Fold the frame layout overrides into code (frames plan, Phase 0 item 0.12).
--
-- Production carried six frame_profile_overrides rows since July 2026
-- (m15devoid, m15land, m15pw, m15snowland, modern, saga) that no other
-- environment had — the dev branch and every preview branch had zero rows,
-- so they rendered those frames with different geometry than production.
-- The same PR writes the override values into lib/cards/template-layout.ts;
-- with code and override now identical, the rows are redundant and are
-- removed so code is the single source of truth again.
--
-- No visual change on production: the folded values ARE what the overrides
-- produced (tests/unit/cards/folded-overrides.test.ts proves each override is
-- a no-op over the new code profile). No layout-version bump, no rebake.
--
-- The delete is guarded by updated_at so an override edited AFTER the fold
-- snapshot (2026-07-27 was the latest) survives and keeps applying on top of
-- the code — a newer admin edit is never silently discarded.
--
-- Data only (no new objects, so no grants). Ships through a PR; never
-- applied ad-hoc.

delete from public.frame_profile_overrides
where template in ('m15devoid', 'm15land', 'm15pw', 'm15snowland', 'modern', 'saga')
  and updated_at < '2026-08-01';

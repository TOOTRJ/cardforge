-- ---------------------------------------------------------------------------
-- Local-development seed. Applied by `supabase start` / `supabase db reset`
-- AFTER all migrations (config.toml → [db.seed]). Runs ONLY against the local
-- stack — remote pushes (`supabase db push`) never execute seeds.
--
-- Keep this minimal: baseline rows the app expects to exist, not sample
-- content. For a test user + admin flag, run `node scripts/seed-e2e.mjs`
-- after the stack is up (it needs the API, not raw SQL).
-- ---------------------------------------------------------------------------

-- No baseline rows required today: profiles are created by the auth trigger
-- (0001), storage buckets by migrations, and all app content is user-made.
-- Add rows here when a feature needs pre-existing data (e.g. frame_reviews
-- defaults or a featured challenge) so `supabase db reset` stays one command.
select 1;

-- branching smoke test marker (throwaway PR #185)

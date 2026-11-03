-- 0163 — an AI job's `plan` is server-only: no API role reads it.
--
-- An AI job's text is designed at PLAN time (POST /api/ai/jobs →
-- lib/ai/generation-jobs.ts) and stored in `ai_generation_jobs.plan`; the
-- credit is reserved and charged only when the job's step runs. The owner
-- SELECT policy (0059) is column-blind, so an owner could plan a fill (the
-- balance pre-check takes nothing), read the designed text from their own
-- row through PostgREST, and never run the paid step — AI text for free,
-- as often as the AI rate limit allows, with a single credit in hand. The
-- app's own responses already strip `plan` (2026-10-28, review of #632);
-- this closes the table.
--
--   * `authenticated` loses table-level SELECT and gets SELECT on every
--     column BUT `plan` (lib/ai/job-privacy.ts OWNER_JOB_COLUMNS — a unit
--     test holds the two lists together). RLS (0059's owner read) is
--     unchanged: still the owner's rows only. A `select *` through an
--     owner's session is refused (42501); every app read names its columns.
--   * `anon` loses SELECT outright: no row was ever readable to it (the
--     policy needs auth.uid()).
--   * The server keeps reading the plan with the service role (claim_job_step
--     / patch_job_step, 0073), whose grants are untouched.
--   * INSERT stays as it was (0097): the plan route inserts through the
--     owner's session; writing a plan reveals nothing, and a fabricated one
--     still pays at its step.
--
-- A NEW column of this table is invisible to `authenticated` until a
-- migration grants it here AND adds it to OWNER_JOB_COLUMNS.
--
-- The step labels (the designed title) are handled in the app: a card /
-- card_fill step waits under a placeholder and takes its title in the
-- done-write (lib/ai/job-privacy.ts). Rows planned before this keep theirs.
--
-- Idempotent (revoke / grant). Ships through a PR; never applied ad-hoc.

revoke select on table public.ai_generation_jobs from anon, authenticated;

grant select (
  id,
  owner_id,
  kind,
  status,
  request,
  steps,
  deck_id,
  error,
  created_at,
  updated_at
) on table public.ai_generation_jobs to authenticated;

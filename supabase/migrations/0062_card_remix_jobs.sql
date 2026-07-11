-- 0062_card_remix_jobs.sql — single-card AI remix joins the jobs pipeline.
--
-- The legacy /api/ai/remix-card route had the same shape /api/ai/random-card
-- did before migration 0061: identity text + image restyle in ONE 60–90s
-- synchronous request, which production infrastructure cuts and re-runs
-- (double credit charge, client sees a dead connection). Same fix: a
-- persisted job the client advances one short step at a time. This just
-- widens the kind check.

alter table public.ai_generation_jobs
  drop constraint if exists ai_generation_jobs_kind_check;
alter table public.ai_generation_jobs
  add constraint ai_generation_jobs_kind_check
  check (kind in ('set', 'deck', 'deck_remix', 'card', 'card_remix'));

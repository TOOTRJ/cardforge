-- 0061_card_generation_jobs.sql — single-card AI generation joins the jobs
-- pipeline.
--
-- The legacy /api/ai/random-card route did text + image in ONE 60–90s
-- synchronous request. In production that request gets cut and re-run at the
-- infrastructure layer (observed 2026-07-11: every generation executed twice,
-- 60s apart — two credits spent, client saw a dead connection). The fix is
-- the same shape deck/set generation already uses: a persisted job the client
-- advances one short step at a time. This just widens the kind check.

alter table public.ai_generation_jobs
  drop constraint if exists ai_generation_jobs_kind_check;
alter table public.ai_generation_jobs
  add constraint ai_generation_jobs_kind_check
  check (kind in ('set', 'deck', 'deck_remix', 'card'));

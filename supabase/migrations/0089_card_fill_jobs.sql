-- 0089_card_fill_jobs.sql — per-field AI generation INTO the open creator
-- form joins the jobs pipeline (owner decision 2026-09-16).
--
-- A "card_fill" job designs only the fields the user ticked (the rest are
-- pinned as fixed context) and, when artwork is ticked, paints it in the
-- job's one step. Nothing is inserted into `cards` — the result is poured
-- into the form and the user saves it themselves. Same shape as the other
-- kinds: plan (fast text design) + one client-driven step (the image), so
-- no HTTP request runs long. This just widens the kind check; 'card_remix'
-- stays for historical rows (no new ones are created).

alter table public.ai_generation_jobs
  drop constraint if exists ai_generation_jobs_kind_check;
alter table public.ai_generation_jobs
  add constraint ai_generation_jobs_kind_check
  check (kind in ('set', 'deck', 'deck_remix', 'card', 'card_remix', 'card_fill'));

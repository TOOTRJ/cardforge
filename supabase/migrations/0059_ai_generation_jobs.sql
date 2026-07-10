-- Migration: 0059_ai_generation_jobs
--
-- Persisted, client-driven AI batch-generation jobs (sets now; decks next).
-- There is no queue/worker in this stack — a batch job is instead a row the
-- client advances one small HTTP step at a time:
--
--   POST /api/ai/jobs            → plan (concept + all card text) + job row
--   POST /api/ai/jobs/:id/step   → execute the next pending step (one
--                                  card's creation + art, or the set icon)
--
-- Each step fits comfortably inside a serverless invocation, progress
-- survives refreshes/timeouts, and a failed step can be retried without
-- regenerating the whole batch.
--
-- Columns:
--   request — what the user asked for (theme/style/size/target ids)
--   plan    — planner output (concept + designed card texts), immutable
--   steps   — [{ key, label, status, card_id?, error? }] progress log
--
-- Jobs are private to their owner. No admin/service writes needed.

create table public.ai_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('set', 'deck', 'deck_remix')),
  status text not null default 'generating'
    check (status in ('generating', 'done', 'failed', 'cancelled')),
  request jsonb not null default '{}'::jsonb,
  plan jsonb,
  steps jsonb not null default '[]'::jsonb,
  set_id uuid references public.card_sets (id) on delete set null,
  deck_id uuid references public.decks (id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_generation_jobs_owner_idx
  on public.ai_generation_jobs (owner_id, created_at desc);

create or replace function public.set_ai_generation_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ai_generation_jobs_set_updated_at on public.ai_generation_jobs;
create trigger ai_generation_jobs_set_updated_at
  before update on public.ai_generation_jobs
  for each row execute function public.set_ai_generation_jobs_updated_at();

alter table public.ai_generation_jobs enable row level security;

drop policy if exists "AI jobs: owner read" on public.ai_generation_jobs;
create policy "AI jobs: owner read"
  on public.ai_generation_jobs for select
  using (auth.uid() = owner_id);

drop policy if exists "AI jobs: owner insert" on public.ai_generation_jobs;
create policy "AI jobs: owner insert"
  on public.ai_generation_jobs for insert
  with check (auth.uid() = owner_id);

drop policy if exists "AI jobs: owner update" on public.ai_generation_jobs;
create policy "AI jobs: owner update"
  on public.ai_generation_jobs for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "AI jobs: owner delete" on public.ai_generation_jobs;
create policy "AI jobs: owner delete"
  on public.ai_generation_jobs for delete
  using (auth.uid() = owner_id);

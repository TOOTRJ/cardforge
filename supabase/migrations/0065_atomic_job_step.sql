-- ---------------------------------------------------------------------------
-- Atomic per-step update for AI generation jobs.
--
-- runNextJobStep used to read the whole `steps` jsonb array, mutate one entry,
-- and write the ENTIRE array back (last-write-wins). That made two things
-- unsafe:
--   1. Replay — re-POSTing an already-done step re-ran its paid image call
--      (no status guard); the credit charge was skipped but the generation
--      wasn't, so a client could burn uncharged image spend.
--   2. Concurrency — the client now steps several cards in PARALLEL to speed
--      up deck/set generation; two whole-array writes would clobber each
--      other, dropping a sibling step's result.
--
-- patch_job_step locks the job row (SELECT ... FOR UPDATE), re-reads the
-- freshly-committed steps, merges the patch into the ONE step whose key
-- matches (preserving array order), recomputes the job status, and writes.
-- Concurrent callers serialize on the row lock and each patch a distinct
-- step on the latest value — no clobber. security invoker + the
-- owner_id = auth.uid() guard keep it owner-scoped (RLS applies too).
-- ---------------------------------------------------------------------------

create or replace function public.patch_job_step(
  p_job_id uuid,
  p_step_key text,
  p_patch jsonb
) returns public.ai_generation_jobs
language plpgsql
security invoker
as $$
declare
  v_job public.ai_generation_jobs;
  v_steps jsonb;
  v_status text;
begin
  select * into v_job
    from public.ai_generation_jobs
    where id = p_job_id and owner_id = auth.uid()
    for update;
  if not found then
    return null;
  end if;

  select jsonb_agg(
           case when elem->>'key' = p_step_key then elem || p_patch else elem end
           order by ord
         )
    into v_steps
    from jsonb_array_elements(v_job.steps) with ordinality as t(elem, ord);

  v_status := case
    when exists (
      select 1 from jsonb_array_elements(v_steps) e where e->>'status' = 'pending'
    ) then 'generating'
    when exists (
      select 1 from jsonb_array_elements(v_steps) e where e->>'status' = 'done'
    ) then 'done'
    else 'failed'
  end;

  update public.ai_generation_jobs
    set steps = v_steps, status = v_status, updated_at = now()
    where id = p_job_id
    returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.patch_job_step(uuid, text, jsonb) from public;
grant execute on function public.patch_job_step(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Honest job statuses + retryable finished jobs.
--
-- Two lies fixed:
--   1. patch_job_step marked a job "done" whenever nothing was pending and
--      AT LEAST ONE step succeeded — deck jobs with failed cards read as
--      fully successful (4 such steps were buried in "done" jobs within one
--      audit fortnight). New status: 'done_with_errors'.
--   2. Once a job left 'generating', claim_job_step refused every claim —
--      so the per-step Retry button on a FINISHED job was a silent no-op
--      (the pre-claim code had the same early-return). Explicit retries now
--      reopen the job: claiming a failed step flips it back to 'generating'
--      until the retry resolves. 'cancelled' jobs stay closed.
-- ---------------------------------------------------------------------------

alter table public.ai_generation_jobs
  drop constraint ai_generation_jobs_status_check;
alter table public.ai_generation_jobs
  add constraint ai_generation_jobs_status_check
  check (status in ('generating', 'done', 'done_with_errors', 'failed', 'cancelled'));

create or replace function public.claim_job_step(
  p_job_id uuid,
  p_step_key text default null
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_job public.ai_generation_jobs;
  v_steps jsonb;
  v_key text;
  v_stale constant timestamptz := now() - interval '5 minutes';
begin
  select * into v_job
    from public.ai_generation_jobs
    where id = p_job_id and owner_id = auth.uid()
    for update;
  if not found then
    return null;
  end if;

  -- Finished-but-retryable jobs (done/done_with_errors/failed) accept claims
  -- so a user can retry failed steps; cancelled jobs are closed for good.
  if v_job.status = 'cancelled' then
    return jsonb_build_object('job', to_jsonb(v_job), 'step_key', null);
  end if;

  select elem->>'key' into v_key
    from jsonb_array_elements(v_job.steps) with ordinality as t(elem, ord)
    where case
      when p_step_key is not null then
        elem->>'key' = p_step_key
        and (
          elem->>'status' in ('pending', 'failed')
          or (
            elem->>'status' = 'running'
            and coalesce((elem->>'claimed_at')::timestamptz, timestamptz 'epoch') < v_stale
          )
        )
      else
        elem->>'status' = 'pending'
        or (
          elem->>'status' = 'running'
          and coalesce((elem->>'claimed_at')::timestamptz, timestamptz 'epoch') < v_stale
        )
    end
    order by ord
    limit 1;

  if v_key is null then
    return jsonb_build_object('job', to_jsonb(v_job), 'step_key', null);
  end if;

  select jsonb_agg(
           case when elem->>'key' = v_key
             then elem || jsonb_build_object(
               'status', 'running',
               'claimed_at', to_jsonb(now()),
               'error', null
             )
             else elem
           end
           order by ord
         )
    into v_steps
    from jsonb_array_elements(v_job.steps) with ordinality as t(elem, ord);

  update public.ai_generation_jobs
    set steps = v_steps, status = 'generating', updated_at = now()
    where id = p_job_id
    returning * into v_job;

  return jsonb_build_object('job', to_jsonb(v_job), 'step_key', v_key);
end;
$$;

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

  -- Honest terminal states: 'done' only when EVERY step succeeded;
  -- successes + failures = 'done_with_errors'; all failures = 'failed'.
  v_status := case
    when exists (
      select 1 from jsonb_array_elements(v_steps) e
      where e->>'status' in ('pending', 'running')
    ) then 'generating'
    when not exists (
      select 1 from jsonb_array_elements(v_steps) e where e->>'status' = 'failed'
    ) then 'done'
    when exists (
      select 1 from jsonb_array_elements(v_steps) e where e->>'status' = 'done'
    ) then 'done_with_errors'
    else 'failed'
  end;

  update public.ai_generation_jobs
    set steps = v_steps, status = v_status, updated_at = now()
    where id = p_job_id
    returning * into v_job;

  return v_job;
end;
$$;

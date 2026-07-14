-- ---------------------------------------------------------------------------
-- Atomic step CLAIM for AI generation jobs (the missing half of 0065).
--
-- 0065 made the step-result WRITE atomic, but nothing claimed a step before
-- EXECUTING it: a step stayed 'pending' for the full 30–180s of its image
-- call. When the function died mid-step (Vercel kills /api/ai/jobs/[id]/step
-- at maxDuration — 20 occurrences logged through 2026-07-14), the credit
-- spend and card insert had already committed but the step result never
-- persisted, so every client retry / auto-resume re-ran the whole step:
-- observed in prod as 6–8 identical artless cards per step and a 21-credit
-- drain on one 4-step deck job.
--
-- claim_job_step locks the job row, picks the requested step (or the first
-- pending one) and flips it to 'running' with a claimed_at stamp — all in
-- one transaction, so concurrent requests (parallel workers, a retry racing
-- an in-flight run, a second tab) can never both execute the same step.
-- A 'running' claim older than 5 minutes is treated as dead (the executor
-- can't outlive the 180s function budget) and may be reclaimed.
--
-- Claim rules:
--   * explicit key  → claim if 'pending', 'failed' (user-driven retry), or
--                     'running' but stale.
--   * no key (auto) → first 'pending' or stale-'running' step; never a
--                     'failed' one (retries stay explicit).
-- ---------------------------------------------------------------------------

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

  if v_job.status <> 'generating' then
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
    set steps = v_steps, updated_at = now()
    where id = p_job_id
    returning * into v_job;

  return jsonb_build_object('job', to_jsonb(v_job), 'step_key', v_key);
end;
$$;

revoke all on function public.claim_job_step(uuid, text) from public;
grant execute on function public.claim_job_step(uuid, text) to authenticated;

-- patch_job_step must treat 'running' as in-flight when it recomputes the
-- job status, or the first finished step of a parallel batch would flip the
-- job to done/failed while siblings are mid-image. Same body as 0065
-- otherwise.
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
      select 1 from jsonb_array_elements(v_steps) e
      where e->>'status' in ('pending', 'running')
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

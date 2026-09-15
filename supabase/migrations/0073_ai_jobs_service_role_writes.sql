-- 0073_ai_jobs_service_role_writes.sql — job rows are no longer owner-writable.
--
-- ai_generation_jobs had column-blind owner UPDATE and DELETE policies
-- (0059) and the step RPCs ran as SECURITY INVOKER through the user's own
-- session. A job's `steps` array is the reconcile cron's PROOF that a credit
-- charge earned its keep (a `done` step carrying the winning spend_ref —
-- migration 0068): an owner could PATCH the steps or DELETE the finished job
-- through PostgREST after a successful generation, and the daily
-- /api/cron/reconcile-credits sweep would refund every credit while the
-- cards stayed. Closing that:
--
--   * The owner UPDATE and DELETE policies are DROPPED. Owners keep SELECT
--     (progress UI, resume) and INSERT (creating a job costs nothing and a
--     fabricated row can't produce a refund — refunds key off real ledger
--     spends). Every write now goes through the service role in app code.
--   * claim_job_step / patch_job_step lose the `owner_id = auth.uid()`
--     filter (auth.uid() is NULL for the service role) and are EXECUTE-granted
--     to service_role only. Ownership is enforced BEFORE the call:
--     lib/ai/generation-jobs.ts runNextJobStep reads the job through the
--     user's RLS-scoped session and refuses to step a job it can't see.
--   * The lazy 24-hour expiry in GET /api/ai/jobs runs with the service role,
--     scoped by an explicit owner_id filter.

drop policy if exists "AI jobs: owner update" on public.ai_generation_jobs;
drop policy if exists "AI jobs: owner delete" on public.ai_generation_jobs;

-- Same bodies as 0067 minus the auth.uid() ownership filter.
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
    where id = p_job_id
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
    where id = p_job_id
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

revoke all on function public.claim_job_step(uuid, text) from public, anon, authenticated;
revoke all on function public.patch_job_step(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_job_step(uuid, text) to service_role;
grant execute on function public.patch_job_step(uuid, text, jsonb) to service_role;

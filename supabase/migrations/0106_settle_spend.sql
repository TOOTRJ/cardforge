-- ===========================================================================
-- 0106 — settle_spend: settlement proof moves from job JSON to the ledger
--
-- Until now the reconcile-credits sweep decided refunds by READING
-- ai_generation_jobs.steps: an aged "spend:{job}:{step}:{uuid}" charge was
-- legitimate only if its step was `done` and carried that exact spend_ref
-- (0068 / 0073). Owner writes to jobs are gone since 0073, so that was no
-- longer exploitable — but the proof lived in a JSON blob the sweep had to
-- re-derive daily, sync flows with no job (the card/deck idea routes) could
-- never be proven at all, and deleting a job turned its earned charges into
-- refunds.
--
-- Now the ledger row itself records the verdict:
--   * credit_ledger.settled_at — stamped once the charge's work is durably
--     recorded. NULL = no proof (live attempt, crashed attempt, superseded
--     duplicate, failed step, unrecorded sync call).
--   * settle_spend(p_ref) — the ONE writer. service_role only, idempotent
--     (keeps the first stamp), false when no such spend row exists.
--   * patch_job_step settles p_patch->>'spend_ref' in the SAME transaction as
--     the step's `done` write, so a platform kill can never leave a settled
--     spend with an unrecorded step (double charge) or a recorded step with
--     an unsettled spend (free card). The executor's contract is unchanged:
--     a charged success stamps its ref on the step (lib/ai/credited-step.ts),
--     a failed or uncharged one stamps null.
--   * Sync routes (app/api/ai/card-ideas, deck-ideas) settle their own ref
--     through settleSpend() right after the work succeeds.
--   * The sweep (lib/billing/credit-reconcile.ts) refunds every aged
--     UNSETTLED spend and never reads job rows.
--
-- Backfill: existing spends are settled under the old rules — a job spend
-- whose `done` step carries its ref, and a sync-route spend that was never
-- refunded (those routes refund every failure in-process). So the first
-- sweep after this ships refunds exactly what the old rule would have
-- (idempotent no-ops for spends the in-process path already refunded);
-- measured on production 2026-09-22: 100 job spends + 7 idea spends settled,
-- 0 new refunds. Rollout order doesn't matter: code-first, the sweep fails
-- closed on the missing column and the executor keeps stamping spend_ref
-- (which this backfill then settles); migration-first, the old executor's
-- patches already carry spend_ref and settle through the new function.
-- ===========================================================================

alter table public.credit_ledger
  add column if not exists settled_at timestamptz;

comment on column public.credit_ledger.settled_at is
  'Spends only: when the charge''s work was durably recorded (settle_spend). '
  'NULL past the reconcile grace window means the charge is orphaned and the '
  'reconcile-credits cron refunds it under refund:{idempotency_key}.';

-- The sweep's scan: unsettled spends by age. Tiny partial index — settled
-- rows and grants fall out of it as soon as they are stamped.
create index if not exists credit_ledger_unsettled_spends_idx
  on public.credit_ledger (created_at)
  where delta < 0 and settled_at is null;

-- ---------------------------------------------------------------------------
-- settle_spend(p_ref) — stamp the spend row for a ledger ref. Idempotent: a
-- second call keeps the original stamp. Returns false when no spend carries
-- that ref (a contract violation the caller logs, never a failure).
-- ---------------------------------------------------------------------------
create or replace function public.settle_spend(p_ref text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ref is null or p_ref = '' then
    return false;
  end if;

  update public.credit_ledger
     set settled_at = coalesce(settled_at, now())
   where idempotency_key = p_ref
     and delta < 0;

  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- patch_job_step — the 0073 body, plus: a `done` patch that carries a
-- spend_ref settles that charge in the same transaction as the step write.
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
  v_spend_ref text := nullif(p_patch->>'spend_ref', '');
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

  -- Settle the charge that completed this step, atomically with the step
  -- write (see the header). A stamped ref with no ledger row is worth a log
  -- line, never a failed patch — the work is already committed.
  if p_patch->>'status' = 'done' and v_spend_ref is not null then
    if not public.settle_spend(v_spend_ref) then
      raise warning 'patch_job_step: no ledger spend for ref % (job %, step %)',
        v_spend_ref, p_job_id, p_step_key;
    end if;
  end if;

  return v_job;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill under the old rules (see the header).
-- ---------------------------------------------------------------------------
-- (a) Job spends: a `done` step carrying the exact ref.
with done_refs as (
  select distinct s->>'spend_ref' as ref
  from public.ai_generation_jobs j
  cross join lateral jsonb_array_elements(j.steps) s
  where s->>'status' = 'done'
    and coalesce(s->>'spend_ref', '') <> ''
)
update public.credit_ledger l
   set settled_at = now()
  from done_refs d
 where l.idempotency_key = d.ref
   and l.delta < 0
   and l.settled_at is null;

-- (b) Sync-route spends (card / deck idea batches) that were never refunded —
--     those routes refund every failure in-process, so an unrefunded charge
--     delivered its ideas.
update public.credit_ledger l
   set settled_at = now()
 where l.settled_at is null
   and l.delta < 0
   and (l.idempotency_key like 'spend:ideas:%'
     or l.idempotency_key like 'spend:deckideas:%')
   and not exists (
     select 1 from public.credit_ledger r
      where r.idempotency_key = 'refund:' || l.idempotency_key
   );

-- ---------------------------------------------------------------------------
-- Grants (every migration states them — new projects don't auto-grant).
-- credit_ledger's table-level grants (0097) already cover the new column.
-- settle_spend is server-only; patch_job_step keeps its 0073 ACL (restated so
-- this file is self-describing).
-- ---------------------------------------------------------------------------
revoke all on function public.settle_spend(text) from public, anon, authenticated;
grant execute on function public.settle_spend(text) to service_role;
revoke all on function public.patch_job_step(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.patch_job_step(uuid, text, jsonb) to service_role;

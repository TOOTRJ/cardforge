-- 0068_spend_refs.sql — traceable credit spends for orphan reconciliation.
--
-- THE GAP THIS CLOSES: a job step reserves its credit fail-closed BEFORE the
-- image call; if the platform kills the function after the charge commits but
-- before the refund/patch runs, the credit is gone and the stale-reclaim
-- retry charges again (the 0066 incident shape — 20 kills logged through
-- 2026-07-14; PR #242's per-leg timeouts shrank but did not close the
-- window). Nothing could reconcile those orphans because ledger spend rows
-- carried no link to the job step that charged them.
--
-- consume_credits gains an optional p_ref: a caller-supplied globally-unique
-- reference stored in credit_ledger.idempotency_key (the existing partial
-- unique index gives collision safety for free). The app passes
-- "spend:{jobId}:{stepKey}:{uuid}" per charge attempt, refunds under
-- "refund:{that ref}" (so each spend attempt is refundable EXACTLY once, and
-- the in-process refund can race the reconcile cron harmlessly), and the
-- /api/cron/reconcile-credits sweep refunds any aged spend whose step didn't
-- complete from that very attempt.
--
-- The 2-arg signature is DROPPED (not overloaded): keeping both would make
-- PostgREST named-parameter dispatch ambiguous. Old app code calling with
-- two named params resolves against the 3-arg function via the default.

drop function if exists public.consume_credits(integer, text);

create or replace function public.consume_credits(
  p_amount integer,
  p_reason text,
  p_ref text default null
)
returns table (ok boolean, balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_balance integer;
begin
  if v_uid is null or p_amount is null or p_amount <= 0 then
    return query select false, 0;
    return;
  end if;

  select credits into v_balance from public.profiles
    where id = v_uid
    for update;

  if v_balance is null or v_balance < p_amount then
    return query select false, coalesce(v_balance, 0);
    return;
  end if;

  v_balance := v_balance - p_amount;
  update public.profiles set credits = v_balance where id = v_uid;
  insert into public.credit_ledger
    (user_id, delta, reason, balance_after, idempotency_key)
    values (v_uid, -p_amount, p_reason, v_balance, p_ref);

  return query select true, v_balance;
end;
$$;

-- Same lockdown as 0027: Supabase default-grants EXECUTE to anon +
-- authenticated on new functions, so revoke explicitly and re-grant only to
-- authenticated (the app calls this with the user's session).
revoke all on function public.consume_credits(integer, text, text)
  from public, anon, authenticated;
grant execute on function public.consume_credits(integer, text, text)
  to authenticated;

-- 0072_consume_credits_ref_guard.sql — namespace caller-supplied spend refs.
--
-- consume_credits (0068) stored its p_ref verbatim in the globally-unique
-- credit_ledger.idempotency_key, and grant_credits dedupes on that key with
-- no per-user scope. So for one credit any signed-in user could call
--   consume_credits(1, 'x', 'refill:<victim uuid>:2026-10')
-- and pre-plant a subscriber's next monthly refill key: the cron's grant
-- would then silently no-op and the mid-month upgrade math
-- (lib/billing/credit-refill.ts) would read the -1 spend as the month's
-- "base grant". The app only ever passes "spend:{jobId}:{stepKey}:{uuid}",
-- so the function now REJECTS any ref outside that namespace — refill:,
-- refund:, pack:, admin-grant: and future grant keys can no longer be
-- squatted through the spend path. Same signature, same grants.

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

  -- Spend refs live in their own namespace; anything else is rejected
  -- loudly rather than written into the shared idempotency key space.
  if p_ref is not null and (p_ref !~ '^spend:' or char_length(p_ref) > 200) then
    raise exception 'consume_credits: p_ref must be a spend:… reference'
      using errcode = 'check_violation';
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

revoke all on function public.consume_credits(integer, text, text)
  from public, anon, authenticated;
grant execute on function public.consume_credits(integer, text, text)
  to authenticated;

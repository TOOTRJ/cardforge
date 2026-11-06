-- 0180_referrals_v2.sql — the referral program, v2 (owner 2026-11-06;
-- docs/BILLING.md "Referrals"; lib/referrals/server.ts).
--
-- What changed from 0177:
--   * a referral QUALIFIES when the friend has saved N cards (the settings'
--     `activation.cardsRequired`, 5) within the window AND has a CARD ON
--     FILE — their first checkout (lib/stripe/webhook-handlers.ts on the
--     subscription's creation). Two stamps, `cards_saved_at` and
--     `card_on_file_at`; the status `cards_saved` is 0177's `first_card`
--     under its new name (old rows keep theirs; both read the same).
--   * rewards are DAYS BANKED (0179, lib/billing/day-bank.ts) or credits —
--     the side columns gain 'banked_days'; the referrer climbs a LADDER by
--     qualified-referral count, so the claim returns the step it reached
--     (`ladder_step`, computed under the referrer's lock — two referrals
--     claimed at once never share a step).
--   * referrals are unlimited: the monthly and lifetime caps of 0177 are
--     gone; only the friends-per-month cap stays (N inboxes mint nothing).
--   * admin_referral_stats() answers the whole picture for the admin panel:
--     the chain, per-day counts, the ladder's distribution, and the bank.
--   * the settings row is rewritten to the v2 shape (the switch kept).
-- Grants stated (every migration states them).

alter table public.referrals
  add column if not exists cards_saved_at timestamptz,
  add column if not exists card_on_file_at timestamptz,
  add column if not exists ladder_step integer check (ladder_step is null or ladder_step >= 1);

alter table public.referrals drop constraint if exists referrals_status_check;
alter table public.referrals
  add constraint referrals_status_check
  check (status in ('signed_up', 'first_card', 'cards_saved', 'rewarded', 'capped', 'blocked', 'expired'));

alter table public.referrals drop constraint if exists referrals_referrer_reward_check;
alter table public.referrals
  add constraint referrals_referrer_reward_check
  check (referrer_reward is null or referrer_reward in ('free_days', 'banked_days', 'credits', 'none'));
alter table public.referrals drop constraint if exists referrals_referee_reward_check;
alter table public.referrals
  add constraint referrals_referee_reward_check
  check (referee_reward is null or referee_reward in ('free_days', 'banked_days', 'credits', 'none'));

-- 0177's qualified rows carry their stamp in the new column too.
update public.referrals set cards_saved_at = first_card_at where cards_saved_at is null and first_card_at is not null;

-- The user reads the two stamps and the step (never a fraud reason).
grant select (cards_saved_at, card_on_file_at, ladder_step) on public.referrals to authenticated;

-- The sweep's read of qualified-not-claimed rows.
create index if not exists referrals_cards_saved_idx
  on public.referrals (cards_saved_at)
  where status in ('cards_saved', 'first_card');

-- THE CLAIM, v2: the friends cap and a block reason only; returns the
-- outcome and, when rewarded, the referrer's ladder step (their rewarded
-- count including this one), computed under the referrer's lock.
drop function if exists public.claim_referral_reward_v2(uuid, int, text);
create or replace function public.claim_referral_reward_v2(
  p_referral_id uuid,
  p_friends_cap int default null,
  p_block_reason text default null
)
returns table (outcome text, step int)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.referrals%rowtype;
  v_friends int;
  v_rewarded int;
  v_outcome text;
  v_step int;
begin
  if p_friends_cap is not null and p_friends_cap < 0 then
    raise exception 'claim_referral_reward_v2: the cap must be non-negative';
  end if;
  select * into v_row from public.referrals where id = p_referral_id;
  if not found then
    return;
  end if;
  -- One referrer at a time (the named namespace, the referrer's id).
  perform pg_advisory_xact_lock(hashtext('pipglyph.referrals'), hashtext(v_row.referrer_id::text));
  -- Re-read under the lock: only a qualified row moves, once.
  select * into v_row from public.referrals where id = p_referral_id for update;
  if v_row.status not in ('cards_saved', 'first_card') then
    return;
  end if;

  -- Friends this referrer brought a reward to this month (rewarded, capped
  -- or referrer-blocked rows alike — each still rewarded the friend).
  select count(*) into v_friends
  from public.referrals
  where referrer_id = v_row.referrer_id
    and status in ('rewarded', 'capped', 'blocked')
    and referee_reward is distinct from 'none'
    and rewarded_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';

  -- The referrer's rewarded referrals so far: this one is the next step.
  select count(*) into v_rewarded
  from public.referrals
  where referrer_id = v_row.referrer_id
    and status = 'rewarded';

  v_outcome := case
    when p_friends_cap is not null and v_friends >= p_friends_cap then 'capped_friends'
    when p_block_reason is not null then 'blocked'
    else 'rewarded'
  end;
  v_step := case when v_outcome = 'rewarded' then v_rewarded + 1 else null end;

  update public.referrals
  set status = case when v_outcome = 'rewarded' then 'rewarded' when v_outcome = 'blocked' then 'blocked' else 'capped' end,
      block_reason = case when v_outcome = 'blocked' then p_block_reason else block_reason end,
      rewarded_at = now(),
      ladder_step = v_step,
      referrer_reward = case when v_outcome = 'rewarded' then null else 'none' end,
      referrer_reward_detail = case
        when v_outcome = 'rewarded' then referrer_reward_detail
        when v_outcome = 'blocked' then jsonb_build_object('kind', 'none', 'reason', p_block_reason)
        else jsonb_build_object('kind', 'none', 'reason', v_outcome)
      end,
      referee_reward = case when v_outcome = 'capped_friends' then 'none' else referee_reward end,
      referee_reward_detail = case
        when v_outcome = 'capped_friends' then jsonb_build_object('kind', 'none', 'reason', v_outcome)
        else referee_reward_detail
      end
  where id = p_referral_id;
  outcome := v_outcome;
  step := v_step;
  return next;
end;
$$;

revoke all on function public.claim_referral_reward_v2(uuid, int, text) from public, anon, authenticated;
grant execute on function public.claim_referral_reward_v2(uuid, int, text) to service_role;

-- THE SWEEP'S READS (independent check P2: a plain "every cards_saved row,
-- oldest first, 100 at a time" starves once a hundred friends have the
-- cards and never a plan). Only rows that CAN move are returned: a
-- cards_saved row whose friend now holds a Stripe subscription (a card on
-- file), and a signed_up row — older than p_after, inside the window —
-- whose friend has saved the bar's cards. Service role only.
create or replace function public.referrals_awaiting_plan(p_limit int default 100)
returns setof public.referrals
language sql
stable
security definer
set search_path = public
as $$
  select r.*
  from public.referrals r
  join public.profiles p on p.id = r.referee_id
  where r.status in ('cards_saved', 'first_card')
    and r.card_on_file_at is null
    and p.stripe_subscription_id is not null
    and p.subscription_status in ('trialing', 'active', 'past_due', 'unpaid')
  order by coalesce(r.cards_saved_at, r.first_card_at) asc nulls first
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.referrals_awaiting_plan(int) from public, anon, authenticated;
grant execute on function public.referrals_awaiting_plan(int) to service_role;

create or replace function public.referrals_stranded_signups(
  p_cards int,
  p_since timestamptz,
  p_until timestamptz,
  p_limit int default 100
)
returns table (id uuid, referee_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.referee_id
  from public.referrals r
  where r.status = 'signed_up'
    and r.referee_id is not null
    and r.signed_up_at >= p_since
    and r.signed_up_at < p_until
    and (select count(*) from public.cards c where c.owner_id = r.referee_id) >= greatest(1, coalesce(p_cards, 1))
  order by r.signed_up_at asc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.referrals_stranded_signups(int, timestamptz, timestamptz, int) from public, anon, authenticated;
grant execute on function public.referrals_stranded_signups(int, timestamptz, timestamptz, int) to service_role;

-- THE ADMIN'S NUMBERS, v2 (the same name and signature as 0177's: replaced).
create or replace function public.admin_referral_stats(p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not public.viewer_is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin_referral_stats: admins only' using errcode = '42501';
  end if;
  with w as (
    select * from public.referrals where signed_up_at >= p_since
  ),
  rewards as (
    select
      count(*) filter (where referrer_reward in ('free_days', 'banked_days', 'credits'))
      + count(*) filter (where referee_reward in ('free_days', 'banked_days', 'credits')) as n
    from public.referrals
    where rewarded_at >= p_since
  ),
  top as (
    select
      r.referrer_id,
      p.username,
      count(*) as referrals,
      count(*) filter (where coalesce(r.cards_saved_at, r.first_card_at) is not null) as activated,
      count(*) filter (where r.card_on_file_at is not null) as card_on_file,
      count(*) filter (where r.status = 'rewarded') as rewarded,
      count(*) filter (where r.referrer_reward in ('free_days', 'banked_days', 'credits')) as rewards,
      max(r.ladder_step) as step
    from public.referrals r
    left join public.profiles p on p.id = r.referrer_id
    where r.signed_up_at >= p_since
    group by r.referrer_id, p.username
    order by count(*) filter (where r.status = 'rewarded') desc, count(*) desc
    limit 10
  ),
  days as (
    select d::date as day
    from generate_series(greatest(p_since::date, (now() - interval '30 days')::date), now()::date, interval '1 day') d
  ),
  per_day as (
    select
      to_char(days.day, 'YYYY-MM-DD') as day,
      (select count(*) from public.referrals r where r.signed_up_at::date = days.day) as signed_up,
      (select count(*) from public.referrals r where coalesce(r.cards_saved_at, r.first_card_at)::date = days.day) as cards_saved,
      (select count(*) from public.referrals r where r.card_on_file_at::date = days.day) as card_on_file,
      (select count(*) from public.referrals r where r.status = 'rewarded' and r.rewarded_at::date = days.day) as rewarded
    from days
    order by days.day
  ),
  steps as (
    -- Referrers by how many rewarded referrals they have (the ladder rung).
    select case when n >= 10 then '10+' else n::text end as bucket, count(*) as referrers
    from (select referrer_id, count(*) as n from public.referrals where status = 'rewarded' group by referrer_id) c
    group by case when n >= 10 then '10+' else n::text end
  ),
  bank as (
    select
      coalesce(sum(days) filter (where status = 'banked'), 0) as banked_days,
      coalesce(sum(days) filter (where status = 'reserved'), 0) as reserved_days,
      coalesce(sum(days) filter (where status = 'applied'), 0) as applied_days,
      coalesce(sum(days) filter (where status = 'revoked'), 0) as revoked_days,
      count(*) filter (where status = 'applied' and applied_via = 'checkout') as applied_checkouts,
      coalesce(sum(days) filter (where status = 'applied' and applied_via = 'checkout'), 0) as applied_checkout_days,
      count(*) filter (where status = 'applied' and applied_via = 'plan_hold') as applied_holds,
      coalesce(sum(days) filter (where status = 'applied' and applied_via = 'plan_hold'), 0) as applied_hold_days,
      count(distinct user_id) filter (where status = 'banked') as users_with_bank,
      count(*) filter (where source = 'signup') as signup_entries,
      count(*) filter (where source = 'signup' and status = 'applied') as signup_applied,
      count(*) filter (where source = 'signup' and status = 'revoked') as signup_revoked,
      count(*) filter (where source = 'signup' and status = 'banked') as signup_banked
    from public.day_bank_entries
    where created_at >= p_since
  ),
  bank_sources as (
    select source, coalesce(sum(days), 0) as days, count(*) as entries
    from public.day_bank_entries
    where created_at >= p_since
    group by source
  ),
  ladder_credits as (
    select coalesce(sum(delta), 0) as credits
    from public.credit_ledger
    where reason = 'referral_credits' and created_at >= p_since
  )
  select jsonb_build_object(
    'signedUp', (select count(*) from w),
    'firstCard', (select count(*) from w where coalesce(cards_saved_at, first_card_at) is not null),
    'cardsSaved', (select count(*) from w where coalesce(cards_saved_at, first_card_at) is not null),
    'cardOnFile', (select count(*) from w where card_on_file_at is not null),
    'rewarded', (select count(*) from w where status = 'rewarded'),
    'capped', (select count(*) from w where status = 'capped'),
    'blocked', (select count(*) from w where status = 'blocked'),
    'expired', (select count(*) from w where status = 'expired'),
    -- Qualified (cards saved) but not yet claimed: waiting for the card on
    -- file, a confirmed email, or the program.
    'waiting', (select count(*) from w where status in ('cards_saved', 'first_card')),
    'grantsOwed', (
      select count(*) from public.referrals
      where status in ('rewarded', 'capped', 'blocked')
        and (referrer_reward is null or referee_reward is null)
    ),
    'blockReasons', coalesce((
      select jsonb_object_agg(block_reason, n)
      from (select block_reason, count(*) as n from w where status = 'blocked' group by block_reason) b
    ), '{}'::jsonb),
    'rewardsGranted', (select n from rewards),
    'topReferrers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', referrer_id, 'username', username, 'referrals', referrals,
        'activated', activated, 'cardOnFile', card_on_file, 'rewarded', rewarded, 'rewards', rewards, 'step', step))
      from top
    ), '[]'::jsonb),
    'perDay', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'signedUp', signed_up, 'cardsSaved', cards_saved, 'cardOnFile', card_on_file, 'rewarded', rewarded))
      from per_day
    ), '[]'::jsonb),
    'ladderSteps', coalesce((
      select jsonb_object_agg(bucket, referrers) from steps
    ), '{}'::jsonb),
    'ladderCredits', (select credits from ladder_credits),
    'bank', (
      select jsonb_build_object(
        'bankedDays', banked_days, 'reservedDays', reserved_days, 'appliedDays', applied_days, 'revokedDays', revoked_days,
        'appliedCheckouts', applied_checkouts, 'appliedCheckoutDays', applied_checkout_days,
        'appliedHolds', applied_holds, 'appliedHoldDays', applied_hold_days,
        'usersWithBank', users_with_bank,
        'signupEntries', signup_entries, 'signupApplied', signup_applied, 'signupRevoked', signup_revoked, 'signupBanked', signup_banked,
        'bySource', coalesce((select jsonb_object_agg(source, jsonb_build_object('days', days, 'entries', entries)) from bank_sources), '{}'::jsonb)
      )
      from bank
    )
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.admin_referral_stats(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_referral_stats(timestamptz) to service_role;

-- The settings row: v1 → v2 (the switch and the friends cap kept).
update public.site_settings
set value = jsonb_build_object(
  'enabled', coalesce((value->>'enabled')::boolean, true),
  'activation', jsonb_build_object('cardsRequired', 5, 'windowDays', 30),
  'friend', jsonb_build_object('days', 7),
  'ladder', jsonb_build_array(
    jsonb_build_object('kind', 'days', 'days', 7),
    jsonb_build_object('kind', 'credits', 'amount', 5),
    jsonb_build_object('kind', 'days', 'days', 7),
    jsonb_build_object('kind', 'credits', 'amount', 10),
    jsonb_build_object('kind', 'days', 'days', 14),
    jsonb_build_object('kind', 'credits', 'amount', 20),
    jsonb_build_object('kind', 'days', 'days', 21),
    jsonb_build_object('kind', 'credits', 'amount', 50),
    jsonb_build_object('kind', 'days', 'days', 21),
    jsonb_build_object('kind', 'days', 'days', 30)
  ),
  'tail', jsonb_build_object('kind', 'days', 'days', 7),
  'caps', jsonb_build_object('friendsPerMonth', coalesce((value->'caps'->>'friendsPerMonth')::int, 5))
),
    updated_at = now()
where key = 'referrals'
  and not (value ? 'ladder');

insert into public.site_settings (key, value)
values ('referrals', '{"enabled": true, "activation": {"cardsRequired": 5, "windowDays": 30}, "friend": {"days": 7}, "ladder": [{"kind": "days", "days": 7}, {"kind": "credits", "amount": 5}, {"kind": "days", "days": 7}, {"kind": "credits", "amount": 10}, {"kind": "days", "days": 14}, {"kind": "credits", "amount": 20}, {"kind": "days", "days": 21}, {"kind": "credits", "amount": 50}, {"kind": "days", "days": 21}, {"kind": "days", "days": 30}], "tail": {"kind": "days", "days": 7}, "caps": {"friendsPerMonth": 5}}'::jsonb)
on conflict (key) do nothing;

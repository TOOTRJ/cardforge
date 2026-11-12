-- 0208_referrals_cards_only.sql — a referral rewards on the friend's CARDS
-- ALONE; a plan with a card on file is no condition any more.
--
-- The owner (2026-11-11): "Currently the reward only happens if the person
-- referred starts a plan with a card on file. I want to remove that
-- requirement as it is no longer relevant." A banked day can only be USED by
-- starting a plan, and that is where the card is asked for; holding the
-- reward itself back for it meant about 2 % of the people who join ever
-- qualified a referral, against 18 % who save the cards.
--
-- The rule lives in the app (lib/referrals/server.ts: advanceReferral no
-- longer waits for `card_on_file_at`, which stays as a FACT the webhook
-- stamps — "this friend became a subscriber" — for the admin's numbers).
-- The card was also the program's fraud bar, so three things change WITH it,
-- and this file is the database's half of them:
--
-- 1. ONLY CARDS WITH ARTWORK COUNT toward the bar. A title-only card is a
--    second's work; on production every account that saved the bar's cards
--    did it with art (58 of 58), so no real friend waits longer. The app
--    counts `art_url` set and not empty; `referrals_stranded_signups` — the
--    sweep's read of signed-up rows whose friend has the cards — counts the
--    same cards here, so the two agree.
--
-- 2. THE FRIENDS CAP COUNTS EVERY REWARDED REFERRAL. claim_referral_reward_v2
--    (0180) counted a rewarded row only while the friend's own side was not
--    'none' — so with the friend's reward set to 0 days in the settings, the
--    cap never tripped and the referrer's rewards were unlimited. A rewarded
--    row now counts whatever the friend's side came to; a row blocked for
--    the referrer only still counts while its friend was rewarded; a capped
--    row rewarded nobody and still never counts. Nothing else in the claim
--    is changed: same signature, same lock, same outcomes.
--
-- 3. THE ADMIN'S LIST CARRIES THE COUNT THAT MATTERS. admin_referred_friends
--    (0202, widened by 0206) gains `referee_art_cards` after its 27 columns:
--    the friend's cards with artwork, so the Referrals tab can say "has
--    saved 3 of 5 cards" by the bar's own count. The first 27 are unchanged,
--    in their places. Its return type changes, so it is dropped and made
--    again (0202's own pattern).
--
-- NOT changed here: `referrals_awaiting_plan` (0180) is no longer called by
-- the app — a row no longer waits for a plan — and is left in place, because
-- the deployment before this one still calls it for the minutes both exist.
-- No row is rewritten: a referral whose friend already saved the cards
-- (status cards_saved) is claimed by the next hourly sweep under the new
-- rule — that is the point of the change.
--
-- Grants are explicit (0097): all three are the service role's alone, as
-- they were. Idempotent. Ships through a PR; never applied ad-hoc.

-- 1. The sweep's stranded signups: the cards that count.
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
    and (
      select count(*)
      from public.cards c
      where c.owner_id = r.referee_id
        and c.art_url is not null
        and c.art_url <> ''
    ) >= greatest(1, coalesce(p_cards, 1))
  order by r.signed_up_at asc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.referrals_stranded_signups(int, timestamptz, timestamptz, int) from public, anon, authenticated;
grant execute on function public.referrals_stranded_signups(int, timestamptz, timestamptz, int) to service_role;

-- 2. THE CLAIM, v2 — 0180's, with the friends cap counting every rewarded
-- referral. Same signature: replaced in place.
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

  -- The referrals this referrer was rewarded for, or whose friend was, this
  -- month: every REWARDED row (whatever the friend's own side came to — a
  -- setting of 0 days for the friend, an admin friend, a grant given up),
  -- and a row blocked for the referrer only whose friend still got theirs.
  -- A capped row rewarded nobody and never counts. (0180 counted a rewarded
  -- row only while the friend's side was not 'none', so with the friend's
  -- reward set to 0 days the cap never tripped.)
  select count(*) into v_friends
  from public.referrals
  where referrer_id = v_row.referrer_id
    and (status = 'rewarded' or (status = 'blocked' and referee_reward is distinct from 'none'))
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

-- 3. The admin's list of referred friends, with the cards that count.
drop function if exists public.admin_referred_friends(integer, integer);

create or replace function public.admin_referred_friends(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  referral_id uuid,
  referee_id uuid,
  referee_username text,
  referee_joined_at timestamptz,
  referrer_id uuid,
  referrer_username text,
  signed_up_at timestamptz,
  status text,
  block_reason text,
  cards_saved_at timestamptz,
  card_on_file_at timestamptz,
  rewarded_at timestamptz,
  ladder_step integer,
  referee_tier text,
  referee_cards bigint,
  referee_public_cards bigint,
  referee_last_card_at timestamptz,
  referee_banked_days bigint,
  total_count bigint,
  referrer_reward text,
  referee_reward text,
  referrer_reward_detail jsonb,
  referee_reward_detail jsonb,
  grant_attempts integer,
  referee_email_confirmed boolean,
  referrer_email_confirmed boolean,
  referee_has_plan boolean,
  referee_art_cards bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with listed as (
    select
      r.id,
      r.referee_id,
      r.referrer_id,
      r.signed_up_at,
      r.status,
      r.block_reason,
      coalesce(r.cards_saved_at, r.first_card_at) as cards_saved_at,
      r.card_on_file_at,
      r.rewarded_at,
      r.ladder_step,
      r.referrer_reward,
      r.referee_reward,
      r.referrer_reward_detail,
      r.referee_reward_detail,
      r.grant_attempts,
      count(*) over () as total_count
    from public.referrals r
    order by r.signed_up_at desc, r.id desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    l.id,
    l.referee_id,
    friend.username,
    friend.created_at,
    l.referrer_id,
    referrer.username,
    l.signed_up_at,
    l.status,
    l.block_reason,
    l.cards_saved_at,
    l.card_on_file_at,
    l.rewarded_at,
    l.ladder_step,
    case
      when friend.id is null then null
      when plan.comp_rank > plan.subscribed_rank then friend.comp_tier
      when plan.subscribed_rank > 0 then friend.subscription_tier
      else 'free'
    end,
    coalesce(made.cards, 0),
    coalesce(made.public_cards, 0),
    made.last_card_at,
    coalesce(bank.days, 0),
    l.total_count,
    l.referrer_reward,
    l.referee_reward,
    l.referrer_reward_detail,
    l.referee_reward_detail,
    l.grant_attempts,
    case when friend_login.id is null then null else friend_login.email_confirmed_at is not null end,
    case when referrer_login.id is null then null else referrer_login.email_confirmed_at is not null end,
    case
      when friend.id is null then null
      else friend.stripe_subscription_id is not null
       and coalesce(friend.subscription_status, '') in ('trialing', 'active', 'past_due', 'unpaid')
    end,
    coalesce(made.art_cards, 0)
  from listed l
  left join public.profiles friend on friend.id = l.referee_id
  left join public.profiles referrer on referrer.id = l.referrer_id
  left join auth.users friend_login on friend_login.id = l.referee_id
  left join auth.users referrer_login on referrer_login.id = l.referrer_id
  left join lateral (
    select
      case
        when friend.subscription_tier in ('plus', 'pro')
         and public.subscription_perks_on(friend.subscription_status, friend.payment_failed_at)
        then case friend.subscription_tier when 'pro' then 2 else 1 end
        else 0
      end as subscribed_rank,
      case
        when friend.comp_tier in ('plus', 'pro')
         and (friend.comp_expires_at is null or friend.comp_expires_at > now())
        then case friend.comp_tier when 'pro' then 2 else 1 end
        else 0
      end as comp_rank
  ) plan on true
  left join lateral (
    select
      count(*) as cards,
      count(*) filter (where c.visibility = 'public') as public_cards,
      count(*) filter (where c.art_url is not null and c.art_url <> '') as art_cards,
      max(c.created_at) as last_card_at
    from public.cards c
    where c.owner_id = l.referee_id
  ) made on true
  left join lateral (
    select sum(e.days) as days
    from public.day_bank_entries e
    where e.reference = 'referral:' || l.id::text || ':referee'
      and e.source = 'referral_friend'
      and e.status <> 'revoked'
  ) bank on true
  order by l.signed_up_at desc, l.id desc;
$$;

comment on function public.admin_referred_friends(integer, integer) is
  'The admin Referrals tab''s list of referred friends (0202, widened by 0206 and 0208): one row per referral, newest signup first, with the friend''s plan (card_capacity_for''s rule), their cards now — all of them, the public ones, and the ones WITH ARTWORK, which are the cards a referral counts (0208) —, the days this referral banked to them (revoked entries left out), total_count for the pager, and what the page needs to say why a reward is not given: each side''s recorded reward and its detail, the failed grant attempts, whether each account''s email is confirmed and whether the friend holds a plan with a card on file (a fact since 0208, no longer a condition). A friend whose account is gone keeps a row with NULL referee columns. Service role only.';

revoke all on function public.admin_referred_friends(integer, integer) from public, anon, authenticated;
grant execute on function public.admin_referred_friends(integer, integer) to service_role;

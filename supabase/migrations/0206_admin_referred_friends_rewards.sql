-- 0206_admin_referred_friends_rewards.sql — the Referred friends list says
-- WHY a reward has not been given (/admin/analytics?tab=referrals).
--
-- The owner (2026-11-11): "On the referrals analytics page I want you to
-- include the reason a referrer or referred user has not received their
-- reward yet." 0202's admin_referred_friends lists each referral with where
-- it stands; it does not carry what the page needs to say why a side is
-- still waiting, or why it ended with nothing. This is the same function
-- with EIGHT more columns — the first nineteen are 0202's, unchanged, in
-- their places (see that file's header for what each one means):
--
--   referrer_reward / referee_reward
--                          what each side was given, as the reward step
--                          recorded it (lib/referrals/server.ts recordSide):
--                          'banked_days' | 'credits' | 'none', or NULL while
--                          the side is still owed (the row is not claimed
--                          yet, or its grant failed and the hourly sweep
--                          retries it).
--   referrer_reward_detail / referee_reward_detail
--                          that side's detail as stored: the days or credits
--                          and the referrer's ladder step, or — for 'none' —
--                          the `reason` (admin, settings, grant_failed,
--                          no_profile, account_deleted, expired,
--                          capped_friends, a block reason). No address, no
--                          Stripe id.
--   grant_attempts         how many times a side's grant has failed (the
--                          sweep gives up at REFERRAL_GRANT_MAX_ATTEMPTS).
--   referee_email_confirmed / referrer_email_confirmed
--                          whether that account's email is CONFIRMED — the
--                          reward step's own test (auth.users
--                          .email_confirmed_at, what getUserById returns):
--                          both must be before either side is rewarded. NULL
--                          when the account is gone. A flag only: no address
--                          leaves the database.
--   referee_has_plan       whether the friend holds a subscription Stripe
--                          only gives with a payment method — the reward
--                          step's "card on file" test
--                          (stripe_subscription_id set and the status one of
--                          trialing / active / past_due / unpaid). TRUE on a
--                          row with no card_on_file_at means the stamp was
--                          missed and the sweep will write it. NULL when the
--                          account is gone.
--
-- The words are the page's (lib/admin/analytics/referrals.ts
-- referralRewardWords): it adds what only the app knows — the program's
-- settings, whether billing is on, whether the hash key is set.
--
-- The return type changes, so the function is dropped and made again (0202's
-- own pattern). Nothing is written and no row is changed. SECURITY DEFINER
-- with an empty search_path: it reads profiles' private billing columns, the
-- bank and auth.users' confirmation stamp.
--
-- Grants are explicit (0097): the service role's alone — the page checks the
-- viewer is an admin, then reads through the admin client
-- (lib/admin/analytics/referrals.ts). Idempotent. Ships through a PR; never
-- applied ad-hoc.

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
  referee_has_plan boolean
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
    end
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
  'The admin Referrals tab''s list of referred friends (0202, widened by 0206): one row per referral, newest signup first, with the friend''s plan (card_capacity_for''s rule), their cards now, the days this referral banked to them (revoked entries left out), total_count for the pager, and what the page needs to say why a reward is not given: each side''s recorded reward and its detail, the failed grant attempts, whether each account''s email is confirmed and whether the friend holds a plan with a card on file. A friend whose account is gone keeps a row with NULL referee columns. Service role only.';

revoke all on function public.admin_referred_friends(integer, integer) from public, anon, authenticated;
grant execute on function public.admin_referred_friends(integer, integer) to service_role;

-- 0202_admin_referred_friends.sql — who was referred, with their data, for
-- the admin Referrals tab (/admin/analytics?tab=referrals).
--
-- The Referrals panel (0180's admin_referral_stats) names the TOP REFERRERS
-- and counts their friends; it never names a friend. The owner (2026-11-10):
-- "for referrals it currently shows top referrers but I would like it to
-- also display who was referred along with their data." This is that list:
-- ONE ROW PER REFERRAL, newest signup first, a page at a time.
--
--   referral_id            the referrals row.
--   referee_id / referee_username / referee_joined_at
--                          the friend (their profile's created_at). All three
--                          are NULL once the friend's account is gone — the
--                          referral row stays (0177: SET NULL, never cascade;
--                          it is the referrer's cap evidence), so it is still
--                          listed.
--   referrer_id / referrer_username
--                          who brought them.
--   signed_up_at, status, block_reason, card_on_file_at, ladder_step
--                          the referral's own columns, as stored. status is
--                          one of 0180's seven; block_reason one of 0177's
--                          seven or NULL.
--   cards_saved_at         when the friend saved the cards (0177's
--                          first_card_at on a row older than 0180).
--   rewarded_at            when the claim SETTLED the row — stamped on a
--                          capped or blocked row too (0180's claim); it is the
--                          day both sides were rewarded only where status =
--                          'rewarded'. The page reads it that way.
--   referee_tier           the plan whose perks the friend has NOW, in one
--                          word: 'free' | 'plus' | 'pro' — card_capacity_for's
--                          rule (0174), i.e. lib/billing/entitlements.ts
--                          effectiveTierForProfile: the subscription's tier
--                          while it carries its perks (active / trialing, or
--                          past_due inside the dunning grace:
--                          subscription_perks_on), a live comp when it is the
--                          higher of the two, else 'free'. NULL when the
--                          account is gone.
--   referee_cards / referee_public_cards / referee_last_card_at
--                          the cards the friend has NOW (all / public) and
--                          their newest card's created_at.
--   referee_banked_days    the free days banked to the friend FROM THIS
--                          referral: day_bank_entries of source
--                          'referral_friend' under the reference
--                          `referral:<id>:referee` (lib/referrals/server.ts
--                          referralRewardKey), whatever became of them since
--                          (waiting, reserved or applied) — a REVOKED entry is
--                          days taken back, and counts as none.
--   total_count            every referral there is (the same on each row),
--                          for the pager.
--
-- p_limit is clamped to 1..200 (default 50), p_offset to 0 and up. The order
-- ends on the id, so two signups of one instant keep their places between
-- pages.
--
-- Nothing is written and no row is changed. SECURITY DEFINER with an empty
-- search_path: it reads profiles' private billing columns and the bank.
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
  total_count bigint
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
    l.total_count
  from listed l
  left join public.profiles friend on friend.id = l.referee_id
  left join public.profiles referrer on referrer.id = l.referrer_id
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
  'The admin Referrals tab''s list of referred friends (0202): one row per referral, newest signup first, with the friend''s plan (card_capacity_for''s rule), their cards now, the days this referral banked to them (revoked entries left out) and total_count for the pager. A friend whose account is gone keeps a row with NULL referee columns. Service role only.';

revoke all on function public.admin_referred_friends(integer, integer) from public, anon, authenticated;
grant execute on function public.admin_referred_friends(integer, integer) to service_role;

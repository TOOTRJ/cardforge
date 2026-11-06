-- ---------------------------------------------------------------------------
-- 37_referrals.sql — the referral program (migrations 0177 + 0180, v2), so a
-- preview branch, the dev database and the local stack show each case:
--
--   Codes — every seeded account has a fixed code (dev_free: d0000003, so
--     its link is /?ref=d0000003).
--   dev_pro → dev_artist   REWARDED 10 days ago (v2): dev_artist saved the
--     cards and started a plan; 7 days are banked for dev_artist
--     (referral_friend) and dev_pro took ladder step 1 — 7 days banked
--     (referral_step). The bank rows are in this file (the day_bank_entries
--     table is 0179's); nothing on Stripe.
--   dev_free → dev_new     SIGNED UP, no cards yet: sign in as dev_new, save
--     five cards and start a plan (the preview's sandbox Checkout) to watch
--     both rewards land and the two referral_reward notifications. (Seeded
--     emails are confirmed; the reward needs REFERRAL_EMAIL_HASH_KEY set,
--     else it waits.)
--   dev_pro's referral_reward notification for the first row.
--
-- Runs after 36_*.sql (config.toml → [db.seed] sql_paths, filename order).
-- Never against production. Idempotent: fixed ids + ON CONFLICT DO NOTHING.
-- No credential in here (the repo is public). Rows whose accounts are
-- missing are skipped.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.referral_codes (user_id, code)
select v.user_id, v.code
from (values
  ('d0000000-0000-4000-a000-000000000001'::uuid, 'd0000001'),
  ('d0000000-0000-4000-a000-000000000002'::uuid, 'd0000002'),
  ('d0000000-0000-4000-a000-000000000003'::uuid, 'd0000003'),
  ('d0000000-0000-4000-a000-000000000004'::uuid, 'd0000004'),
  ('d0000000-0000-4000-a000-000000000005'::uuid, 'd0000005')
) as v (user_id, code)
where exists (select 1 from public.profiles p where p.id = v.user_id)
on conflict do nothing;

insert into public.referrals (
  id, referrer_id, referee_id, code, status, signed_up_at, first_card_at, cards_saved_at, card_on_file_at,
  ladder_step, rewarded_at, referrer_reward, referee_reward, referrer_reward_detail, referee_reward_detail
)
select v.id, v.referrer_id, v.referee_id, v.code, v.status, v.signed_up_at, v.cards_at, v.cards_at, v.card_at,
       v.ladder_step, v.rewarded_at, v.referrer_reward, v.referee_reward, v.referrer_detail, v.referee_detail
from (values
  ('e0000000-0000-4000-a000-000000000001'::uuid,
   'd0000000-0000-4000-a000-000000000002'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid,
   'd0000002', 'rewarded',
   now() - interval '12 days', now() - interval '11 days', now() - interval '10 days',
   1, now() - interval '10 days',
   'banked_days', 'banked_days',
   jsonb_build_object('kind', 'banked_days', 'days', 7, 'step', 1, 'entryId', 'seed-step-dev-pro-1'),
   jsonb_build_object('kind', 'banked_days', 'days', 7, 'entryId', 'seed-friend-dev-artist')),
  ('e0000000-0000-4000-a000-000000000002'::uuid,
   'd0000000-0000-4000-a000-000000000003'::uuid, 'd0000000-0000-4000-a000-000000000005'::uuid,
   'd0000003', 'signed_up',
   now() - interval '30 minutes', null::timestamptz, null::timestamptz,
   null::int, null::timestamptz,
   null::text, null::text, '{}'::jsonb, '{}'::jsonb)
) as v (id, referrer_id, referee_id, code, status, signed_up_at, cards_at, card_at,
        ladder_step, rewarded_at, referrer_reward, referee_reward, referrer_detail, referee_detail)
where exists (select 1 from public.profiles p where p.id = v.referrer_id)
  and exists (select 1 from public.profiles p where p.id = v.referee_id)
on conflict do nothing;

-- The rewards' bank entries (0179): the friend's 7 days under the referral's
-- reference, the referrer's step-1 days under the step's.
insert into public.day_bank_entries (user_id, days, source, reference, status)
select v.user_id, v.days, v.source, v.reference, 'banked'
from (values
  ('d0000000-0000-4000-a000-000000000004'::uuid, 7, 'referral_friend', 'referral:e0000000-0000-4000-a000-000000000001:referee'),
  ('d0000000-0000-4000-a000-000000000002'::uuid, 7, 'referral_step', 'referral-step:d0000000-0000-4000-a000-000000000002:1')
) as v (user_id, days, source, reference)
where exists (select 1 from public.profiles p where p.id = v.user_id)
  and exists (select 1 from public.referrals r where r.id = 'e0000000-0000-4000-a000-000000000001')
on conflict (reference) do nothing;

insert into public.notifications (recipient_id, actor_id, type, payload)
select v.recipient_id, v.actor_id, v.type, v.payload
from (values
  ('d0000000-0000-4000-a000-000000000002'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid,
   'referral_reward',
   '{"referralId": "e0000000-0000-4000-a000-000000000001", "side": "referrer", "reward": "banked_days", "days": 7, "step": 1}'::jsonb)
) as v (recipient_id, actor_id, type, payload)
where exists (select 1 from public.profiles p where p.id = v.recipient_id)
  and exists (select 1 from public.referrals r where r.id = (v.payload ->> 'referralId')::uuid)
on conflict do nothing;

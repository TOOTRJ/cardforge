-- ---------------------------------------------------------------------------
-- 37_referrals.sql — the referral program (migration 0164), so a preview
-- branch, the dev database and the local stack show each case:
--
--   Codes — every seeded account has a fixed code (dev_free: d0000003, so
--     its link is /?ref=d0000003).
--   dev_pro → dev_artist   REWARDED 10 days ago: dev_pro's month was a
--     balance credit ($15, a live Pro plan), dev_artist's a month of Plus
--     (recorded only — dev_artist's profile and credits are not changed
--     here).
--   dev_free → dev_new     SIGNED UP, no card yet: sign in as dev_new and
--     save a first card to watch both months land at once (dev_free and
--     dev_new: a month of Plus each, with 30 AI credits) and the two
--     referral_reward notifications. (Seeded emails are confirmed.)
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
  id, referrer_id, referee_id, code, status, signed_up_at, first_card_at, rewarded_at,
  referrer_reward, referee_reward, referrer_reward_detail, referee_reward_detail
)
select v.id, v.referrer_id, v.referee_id, v.code, v.status, v.signed_up_at, v.first_card_at,
       v.rewarded_at, v.referrer_reward, v.referee_reward, v.referrer_detail, v.referee_detail
from (values
  ('e0000000-0000-4000-a000-000000000001'::uuid,
   'd0000000-0000-4000-a000-000000000002'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid,
   'd0000002', 'rewarded',
   now() - interval '12 days', now() - interval '10 days', now() - interval '10 days',
   'balance_credit', 'plus_month',
   '{"kind": "balance_credit", "amountCents": 1500, "currency": "usd"}'::jsonb,
   jsonb_build_object('kind', 'plus_month', 'tier', 'plus', 'startsAt', now() - interval '10 days',
                      'expiresAt', now() + interval '20 days', 'credits', 30)),
  ('e0000000-0000-4000-a000-000000000002'::uuid,
   'd0000000-0000-4000-a000-000000000003'::uuid, 'd0000000-0000-4000-a000-000000000005'::uuid,
   'd0000003', 'signed_up',
   now() - interval '30 minutes', null::timestamptz, null::timestamptz,
   null::text, null::text, '{}'::jsonb, '{}'::jsonb)
) as v (id, referrer_id, referee_id, code, status, signed_up_at, first_card_at, rewarded_at,
        referrer_reward, referee_reward, referrer_detail, referee_detail)
where exists (select 1 from public.profiles p where p.id = v.referrer_id)
  and exists (select 1 from public.profiles p where p.id = v.referee_id)
on conflict do nothing;

insert into public.notifications (recipient_id, actor_id, type, payload)
select v.recipient_id, v.actor_id, v.type, v.payload
from (values
  ('d0000000-0000-4000-a000-000000000002'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid,
   'referral_reward',
   '{"referralId": "e0000000-0000-4000-a000-000000000001", "side": "referrer", "reward": "balance_credit", "amountCents": 1500, "currency": "usd"}'::jsonb)
) as v (recipient_id, actor_id, type, payload)
where exists (select 1 from public.profiles p where p.id = v.recipient_id)
  and exists (select 1 from public.referrals r where r.id = (v.payload ->> 'referralId')::uuid)
on conflict do nothing;

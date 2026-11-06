-- ---------------------------------------------------------------------------
-- 37_referrals.sql — the referral program (migration 0177), so a preview
-- branch, the dev database and the local stack show each case:
--
--   Codes — every seeded account has a fixed code (dev_free: d0000003, so
--     its link is /?ref=d0000003).
--   dev_pro → dev_artist   REWARDED 10 days ago: 30 free days each (dev_pro
--     Pro, dev_artist Plus) — recorded only; no plan_grants row, no profile
--     change (the live flow makes those through lib/billing/free-days.ts).
--   dev_free → dev_new     SIGNED UP, no card yet: sign in as dev_new and
--     save a first card to watch both rewards land at once (dev_free and
--     dev_new: 30 free days of Plus each, as a perks overlay) and the two
--     referral_reward notifications. (Seeded emails are confirmed; the
--     reward needs REFERRAL_EMAIL_HASH_KEY set, else it waits.)
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
   'free_days', 'free_days',
   jsonb_build_object('kind', 'free_days', 'tier', 'pro', 'days', 30, 'appliedAs', 'overlay', 'endsAt', now() + interval '20 days', 'holdEndsAt', null, 'grantId', null),
   jsonb_build_object('kind', 'free_days', 'tier', 'plus', 'days', 30, 'appliedAs', 'overlay', 'endsAt', now() + interval '20 days', 'holdEndsAt', null, 'grantId', null)),
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
   '{"referralId": "e0000000-0000-4000-a000-000000000001", "side": "referrer", "reward": "free_days", "tier": "pro", "days": 30, "appliedAs": "overlay"}'::jsonb)
) as v (recipient_id, actor_id, type, payload)
where exists (select 1 from public.profiles p where p.id = v.recipient_id)
  and exists (select 1 from public.referrals r where r.id = (v.payload ->> 'referralId')::uuid)
on conflict do nothing;

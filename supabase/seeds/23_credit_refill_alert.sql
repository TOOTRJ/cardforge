-- ---------------------------------------------------------------------------
-- 23_credit_refill_alert.sql — one example `credit_refill_failed`
-- notification (migration 0140) for dev_admin, so a preview's bell and
-- /notifications show the alert an admin gets when the daily credit refill
-- has failures. Vercel previews never run crons, so nothing else writes one.
--
-- Its dedupeKey is 'seed:example' — never a real run day's 'cron:YYYY-MM-DD'
-- — so it can't stand in for (and suppress) a real alert. Idempotent: the
-- 0140 unique index makes a second run insert nothing. Synthetic ids only;
-- never runs against production (seeds don't).
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.notifications (recipient_id, actor_id, type, payload, created_at)
select
  'd0000000-0000-4000-a000-000000000001'::uuid,
  null,
  'credit_refill_failed',
  jsonb_build_object(
    'source', 'cron',
    'dedupeKey', 'seed:example',
    'period', to_char(now() at time zone 'utc', 'YYYY-MM'),
    'day', to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
    'processed', 5,
    'granted', 1,
    'failed', 1,
    'pageError', null,
    'userIds', jsonb_build_array('d0000000-0000-4000-a000-000000000002'),
    'error', 'permission denied for function grant_credits (seeded example)'
  ),
  now() - interval '2 hours'
where exists (select 1 from public.profiles where id = 'd0000000-0000-4000-a000-000000000001')
on conflict do nothing;

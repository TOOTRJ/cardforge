-- ---------------------------------------------------------------------------
-- 38_day_bank.sql — the days bank (migration 0179), so a preview branch, the
-- dev database and the local stack show it:
--
--   dev_free   7 signup days BANKED (never checked out): the billing page
--              says "7 banked days"; a checkout applies them as the free
--              period.
--   dev_new    7 signup days banked, the same.
--   dev_artist 7 signup days APPLIED by a past checkout (recorded only).
--
-- Runs after 37_*.sql (config.toml → [db.seed] sql_paths, filename order).
-- Never against production. Idempotent: fixed references + ON CONFLICT DO
-- NOTHING. No credential in here (the repo is public). Rows whose accounts
-- are missing are skipped.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.day_bank_entries (user_id, days, source, reference, status, applied_at, applied_via, applied_ref)
select p.id, 7, 'signup', 'signup:' || p.id, 'banked', null, null, null
from public.profiles p
where p.id in ('d0000000-0000-4000-a000-000000000003', 'd0000000-0000-4000-a000-000000000005')
on conflict (reference) do nothing;

insert into public.day_bank_entries (user_id, days, source, reference, status, applied_at, applied_via, applied_ref)
select p.id, 7, 'signup', 'signup:' || p.id, 'applied', now() - interval '40 days', 'checkout', 'cs_seed_dev_artist'
from public.profiles p
where p.id = 'd0000000-0000-4000-a000-000000000004'
on conflict (reference) do nothing;

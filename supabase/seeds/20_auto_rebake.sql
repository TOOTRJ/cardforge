-- ---------------------------------------------------------------------------
-- 20_auto_rebake.sql — synthetic state for the automatic re-bake's admin
-- page (/admin/renders, migration 0123) on non-production databases, so a
-- preview shows every section: a last run, and one card on the "keeps
-- failing" list (Gravebloom Shade, seeded in 10_dev_data.sql) to exercise
-- "Retry this card". Vercel previews never run crons, so nothing overwrites
-- it except the admin buttons (or a hand-triggered cron call).
--
-- Idempotent and non-destructive: only fills the row while it has never
-- recorded a run. Never runs against production (seeds don't).
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

update public.render_sweep_state
set
  last_run = jsonb_build_object(
    'startedAt', to_char((now() - interval '14 minutes') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'finishedAt', to_char((now() - interval '10 minutes') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'durationMs', 238000,
    'layoutVersion', 32,
    'batches', 11,
    'rebaked', 84,
    'stamped', 3,
    'failed', 1,
    'superseded', 0,
    'remaining', 12,
    'stop', 'budget',
    'error', null,
    'failures', jsonb_build_array(jsonb_build_object(
      'id', 'c0000000-0000-4000-a000-000000000003',
      'error', 'Art unavailable — not baking an art-less render. (seeded example)'
    )),
    'poisoned', jsonb_build_array('c0000000-0000-4000-a000-000000000003')
  ),
  poison = jsonb_build_array(jsonb_build_object(
    'id', 'c0000000-0000-4000-a000-000000000003',
    'error', 'Art unavailable — not baking an art-less render. (seeded example)',
    'failures', 3,
    'at', to_char((now() - interval '14 minutes') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )),
  last_checked_at = now() - interval '10 minutes',
  updated_at = now()
where id = 1
  and last_run is null
  and exists (select 1 from public.cards where id = 'c0000000-0000-4000-a000-000000000003');

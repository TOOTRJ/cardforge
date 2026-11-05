-- ---------------------------------------------------------------------------
-- 42_featured_pool.sql — the home page hero's pool (migration 0169, TODO HM4),
-- so a preview branch, the dev database and the local stack show each case
-- in /admin/featured and on the home page:
--
--   In the pool, shown once baked (oldest-added first — the rotation order):
--     1. Cinderwing Matriarch (dev_artist, c…001)
--     2. Archivist of Lost Hours (dev_pro, c…016)
--     3. Thornback Behemoth (dev_artist, c…005)
--   In the pool, never shown (the guard; /admin/featured says why):
--     4. Cinderwing Broodling (dev_pro, c…017) — a remix of c…001;
--     5. Void Tithe (dev_artist, c…014) — unlisted.
--
-- The seeded cards carry no stored render (10_dev_data.sql), and the hero
-- draws the stored bake, so 1–3 read "no render yet" until their owner opens
-- and saves them (that bakes them). Until two are baked the hero shows what
-- it has, then the fallback slots (featured_cards, empty here), then the
-- placeholder pair. Runs after 41_*.sql (config.toml → [db.seed] sql_paths,
-- filename order). Never against production. Idempotent: ON CONFLICT DO
-- NOTHING. No credential in here (the repo is public). Rows whose cards are
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

insert into public.featured_pool (card_id, added_at, added_by)
select v.card_id, now() - v.age,
  (select p.id from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000001'::uuid)
from (values
  ('c0000000-0000-4000-a000-000000000001'::uuid, interval '5 days'),
  ('c0000000-0000-4000-a000-000000000016'::uuid, interval '4 days'),
  ('c0000000-0000-4000-a000-000000000005'::uuid, interval '3 days'),
  ('c0000000-0000-4000-a000-000000000017'::uuid, interval '2 days'),
  ('c0000000-0000-4000-a000-000000000014'::uuid, interval '1 day')
) as v (card_id, age)
where exists (select 1 from public.cards c where c.id = v.card_id)
on conflict (card_id) do nothing;

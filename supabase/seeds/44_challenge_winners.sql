-- ---------------------------------------------------------------------------
-- 44_challenge_winners.sql — a closed challenge with its winners (migration
-- 0172, TODO NV12), so a preview branch, the dev database and the local stack
-- show the Winners section on /challenges/tiny-titans, the badge on each
-- winning card's page, the picker on /admin/challenges and each maker's
-- "won … place" notification:
--
--   Tiny Titans (closed, 10_dev_data.sql) — four entries, three named:
--     1st  Archivist of Lost Hours (dev_pro,    c…016)
--     2nd  Hedge Witch's Familiar  (dev_free,   c…019)
--     3rd  Tidecaller Adept        (dev_artist, c…002)
--     —    Sunlit Vanguard         (dev_artist, c…004) — an entry, unplaced
--
-- An entry is a public card wearing the challenge's tag (0040), so the four
-- cards gain `tiny-titans`. Runs after 43_*.sql (config.toml → [db.seed]
-- sql_paths, filename order). Never against production. Idempotent: a tag
-- already worn and a place already taken are left alone (0172's keys are
-- deferrable, so no ON CONFLICT: NOT EXISTS instead). No credential in here
-- (the repo is public). Rows whose cards or challenge are missing are skipped.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

update public.cards c
set tags = c.tags || array['tiny-titans']
where c.id in (
    'c0000000-0000-4000-a000-000000000016',
    'c0000000-0000-4000-a000-000000000019',
    'c0000000-0000-4000-a000-000000000002',
    'c0000000-0000-4000-a000-000000000004'
  )
  and c.visibility = 'public'
  and not ('tiny-titans' = any (c.tags));

insert into public.challenge_winners (challenge_id, place, card_id)
select ch.id, v.place, v.card_id
from (
  values
    (1::smallint, 'c0000000-0000-4000-a000-000000000016'::uuid),
    (2::smallint, 'c0000000-0000-4000-a000-000000000019'::uuid),
    (3::smallint, 'c0000000-0000-4000-a000-000000000002'::uuid)
) as v (place, card_id)
join public.challenges ch on ch.slug = 'tiny-titans' and ch.ends_at <= now()
join public.cards c on c.id = v.card_id and c.visibility = 'public' and 'tiny-titans' = any (c.tags)
where not exists (
  select 1 from public.challenge_winners w
  where w.challenge_id = ch.id and (w.place = v.place or w.card_id = v.card_id)
);

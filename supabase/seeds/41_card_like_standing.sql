-- ---------------------------------------------------------------------------
-- 41_card_like_standing.sql — likes enough for the card page's "most-liked"
-- line (TODO CP3, migration 0168: shown in the top 50 with 3+ likes from
-- OTHER people), so a preview branch, the dev database and the local stack
-- show all three cases:
--
--   Cinderwing Matriarch (dev_artist)  4 likes          → "#1 most-liked card"
--   Veyra, Stormbound (dev_artist)     3 likes          → "Tied for #2 …"
--   Archivist of Lost Hours (dev_pro)  3 likes + its    → "Tied for #2 …" (the
--                                      owner's own        owner's like is left
--                                                         out: never #1)
--
-- Seed 10 gave them 3 / 2 / 2; this adds the rest. Real likes, so
-- likes_count follows through its trigger (0043). Runs after
-- 38_deck_history.sql (config.toml → [db.seed] sql_paths, filename order).
-- Never against production. Idempotent (`where not exists`), only where the
-- users and cards exist. No credential in here (the repo is public).
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.card_likes (user_id, card_id)
select l.user_id, l.card_id
from (values
  -- Cinderwing Matriarch: + dev_new → 4
  ('d0000000-0000-4000-a000-000000000005'::uuid, 'c0000000-0000-4000-a000-000000000001'::uuid),
  -- Veyra, Stormbound: + dev_admin → 3
  ('d0000000-0000-4000-a000-000000000001'::uuid, 'c0000000-0000-4000-a000-000000000011'::uuid),
  -- Archivist of Lost Hours: + dev_admin → 3 from others, + dev_pro's own
  ('d0000000-0000-4000-a000-000000000001'::uuid, 'c0000000-0000-4000-a000-000000000016'::uuid),
  ('d0000000-0000-4000-a000-000000000002'::uuid, 'c0000000-0000-4000-a000-000000000016'::uuid)
) as l (user_id, card_id)
where exists (select 1 from auth.users u where u.id = l.user_id)
  and exists (select 1 from public.cards c where c.id = l.card_id)
  and not exists (
    select 1 from public.card_likes x where x.user_id = l.user_id and x.card_id = l.card_id
  );

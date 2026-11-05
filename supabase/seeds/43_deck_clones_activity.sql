-- ---------------------------------------------------------------------------
-- 43_deck_clones_activity.sql — clones on different days (TODO DK7.4a,
-- migration 0171), so the Deck activity panel's "Clones" chart on dev_pro's
-- Cinderwing Dragonstorm has a shape on a preview branch, the dev database
-- and the local stack:
--
--   * dev_artist's copy from seed 37 (made when the seed ran — "today");
--   * "Cinderwing, Borrowed" (dev_free, private) — a copy made 2 days ago;
--   * "Dragonstorm, Again" (dev_artist, private) — a copy made 9 days ago.
--
-- Plus the case the count must NOT include: "Cinderwing, My Own Copy"
-- (dev_pro, private) — dev_pro's own copy of their own deck. clone_deck()
-- writes no lineage for it; the row here is the worst case (a lineage row
-- the owner made), and deck_clones_by_day() leaves it out.
--
-- Runs after seed 37 (filename order) and touches none of its rows. Never
-- against production. Idempotent: fixed ids + ON CONFLICT DO NOTHING. No
-- credential in here (the repo is public). Rows whose accounts or decks are
-- missing are skipped. Deck ids …021–…023.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.decks (id, owner_id, title, slug, description, format, visibility, deck_type, bracket)
select v.id, v.owner_id, v.title, v.slug,
       'Seeded: a copy of Cinderwing Dragonstorm for the deck activity chart (TODO DK7.4a).',
       'commander', 'private', 'Dragons', 3
from (values
  ('b0000000-0000-4000-a000-000000000021'::uuid, 'd0000000-0000-4000-a000-000000000003'::uuid,
     'Cinderwing, Borrowed', 'cinderwing-borrowed'),
  ('b0000000-0000-4000-a000-000000000022'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid,
     'Dragonstorm, Again', 'dragonstorm-again'),
  ('b0000000-0000-4000-a000-000000000023'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
     'Cinderwing, My Own Copy', 'cinderwing-my-own-copy')
) as v (id, owner_id, title, slug)
where exists (select 1 from public.profiles p where p.id = v.owner_id)
  and exists (select 1 from public.decks where id = 'b0000000-0000-4000-a000-000000000001')
on conflict (id) do nothing;

insert into public.deck_remix_sources (deck_id, source_deck_id, source_owner_id, created_at)
select v.deck_id, 'b0000000-0000-4000-a000-000000000001'::uuid,
       'd0000000-0000-4000-a000-000000000002'::uuid, now() - v.age
from (values
  ('b0000000-0000-4000-a000-000000000021'::uuid, interval '2 days'),
  ('b0000000-0000-4000-a000-000000000022'::uuid, interval '9 days'),
  ('b0000000-0000-4000-a000-000000000023'::uuid, interval '4 days')
) as v (deck_id, age)
where exists (select 1 from public.decks where id = v.deck_id)
  and exists (select 1 from public.decks where id = 'b0000000-0000-4000-a000-000000000001')
on conflict (deck_id) do nothing;

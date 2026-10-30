-- ---------------------------------------------------------------------------
-- 32_deck_slug_history.sql — a renamed deck's old links redirect (migration
-- 0155, TODO DK5.14), so a preview branch, the dev database and the local
-- stack show each case on dev_pro's decks:
--
--   Ashen Emberforge (dev_pro, PUBLIC) — renamed from "Emberforge Draft":
--     /deck/emberforge-draft answers a 308 to /deck/ashen-emberforge, for
--     everyone.
--   Quiet Tide (link only) (dev_pro, UNLISTED) — renamed from "Quiet Tide
--     Draft": /deck/quiet-tide-draft answers a 308 to
--     /deck/quiet-tide-link-only (the old link is a link too: 0151's header
--     names the OLD slug), and `GET /deck_slug_history` without the header
--     lists no row of it.
--
-- The rows are written the way a rename writes them: the deck at its new
-- slug and the slug it left in deck_slug_history (what 0155's trigger
-- records). Runs after the earlier deck seeds (config.toml → [db.seed]
-- sql_paths, filename order) and touches none of their rows. Never against
-- production. Idempotent: fixed ids + ON CONFLICT DO NOTHING; skipped on a
-- database 0155 has not reached and where dev_pro is missing. No credential
-- in here (the repo is public). Deck ids …00a / …00b.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

do $seed$
begin
  if to_regclass('public.deck_slug_history') is null then
    raise notice 'deck_slug_history is missing (0155 not applied): skipped';
    return;
  end if;

  insert into public.decks (id, owner_id, title, slug, description, format, visibility)
  select d.id, d.owner_id, d.title, d.slug, d.description, 'casual', d.visibility
  from (values
    ('b0000000-0000-4000-a000-00000000000a'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
       'Ashen Emberforge', 'ashen-emberforge',
       'Seeded: a renamed PUBLIC deck — its old link /deck/emberforge-draft redirects here.', 'public'),
    ('b0000000-0000-4000-a000-00000000000b'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid,
       'Quiet Tide (link only)', 'quiet-tide-link-only',
       'Seeded: a renamed UNLISTED deck — its old link /deck/quiet-tide-draft redirects here.', 'unlisted')
  ) as d (id, owner_id, title, slug, description, visibility)
  where exists (select 1 from public.profiles where id = d.owner_id)
    and not exists (select 1 from public.decks where slug = d.slug and id <> d.id)
  on conflict (id) do nothing;

  insert into public.deck_slug_history (old_slug, deck_id, created_at)
  select h.old_slug, h.deck_id, now() - interval '2 days'
  from (values
    ('emberforge-draft', 'b0000000-0000-4000-a000-00000000000a'::uuid),
    ('quiet-tide-draft', 'b0000000-0000-4000-a000-00000000000b'::uuid)
  ) as h (old_slug, deck_id)
  where exists (select 1 from public.decks where id = h.deck_id)
    and not exists (select 1 from public.decks where slug = h.old_slug)
  on conflict (old_slug) do nothing;
end
$seed$;

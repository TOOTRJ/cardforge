-- ---------------------------------------------------------------------------
-- 50_play_exports.sql — the play-surface exports beta tool (`play-exports`,
-- lib/tools/play-exports), so a preview branch, the dev database and the
-- local stack can try it:
--
--   * dev_pro is a Play Exports tester (no end). dev_pro's seeded decks and
--     cards are the sources: "Play online" on a deck page, or a selection in
--     My Cards.
--
-- The tool adds no table and no migration: an export reads the deck and its
-- cards as the viewer may read them and writes the file in the browser.
-- Never against production. Idempotent (ON CONFLICT). No credential. Rows
-- whose accounts are missing are skipped.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.tool_access_grants (tool_slug, user_id, granted_by, granted_at, expires_at, note)
select 'play-exports', 'd0000000-0000-4000-a000-000000000002'::uuid,
       'd0000000-0000-4000-a000-000000000001'::uuid, now() - interval '1 day', null, 'Seeded tester'
where exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000002'::uuid)
  and exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000001'::uuid)
on conflict do nothing;

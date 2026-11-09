-- ---------------------------------------------------------------------------
-- 49_pip_forge.sql — the Pip Forge beta tool (migration 0188), so a preview
-- branch, the dev database and the local stack can open it:
--
--   dev_pro is a tester of Pip Forge (no end). dev_artist and dev_new stay
--   on its waiting list (45_beta_tools), so /admin/tools still shows people
--   waiting.
--
-- No forged_pips rows: a pip's files are storage objects in its maker's
-- folder, which a seed can't write — and a row pointing at nothing would
-- draw an empty pip. A tester forges one.
--
-- Runs after the earlier seeds (filename order). Never against production.
-- Idempotent (ON CONFLICT DO NOTHING). No credential in here (the repo is
-- public). Rows whose accounts are missing are skipped.
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
select 'pip-forge', 'd0000000-0000-4000-a000-000000000002'::uuid,
       'd0000000-0000-4000-a000-000000000001'::uuid, now() - interval '1 day', null::timestamptz,
       'Seeded tester'
where exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000002'::uuid)
  and exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000001'::uuid)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 53_custom_symbols.sql — new mana symbols (migration 0193), so a preview
-- branch, the dev database and the local stack can open the tool:
--
--   dev_pro is a tester of New mana symbols (no end). dev_artist and dev_new
--   have no grant: the tool stays closed to them (a 404), while every
--   symbol still reads for them.
--
-- No custom_symbols rows: a symbol's picture is a storage object in its
-- maker's custom-pips folder, which a seed can't write — and a row pointing
-- at nothing would draw nothing. A tester makes one.
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
select 'custom-symbols', 'd0000000-0000-4000-a000-000000000002'::uuid,
       'd0000000-0000-4000-a000-000000000001'::uuid, now() - interval '1 day', null::timestamptz,
       'Seeded tester'
where exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000002'::uuid)
  and exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000001'::uuid)
on conflict do nothing;

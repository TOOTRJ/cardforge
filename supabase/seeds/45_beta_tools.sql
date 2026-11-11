-- ---------------------------------------------------------------------------
-- 45_beta_tools.sql — beta tools (migration 0182), so a preview branch, the
-- dev database and the local stack show each state of /admin/tools and the
-- Tools hub (/dashboard/tools):
--
--   Testers   dev_pro → Collection Deck Builder (no end) and Token Kit
--             (ends in 30 days); dev_artist → Token Kit, ENDED 3 days ago
--             (shows as ended, no access).
--   Waiting   dev_free → Token Kit and Pip Forge; dev_artist → Pip Forge
--             and Set Symbol Studio; dev_new → Set Symbol Studio.
--   Usage     three weeks of synthetic events on Collection Deck Builder
--             (admin + dev_pro), so the admin chart, totals and tables draw
--             — no tool is built yet; real events start when one is.
--   dev_pro's tool_access notification.
--
-- No tool_releases rows: every tool is in beta. Never against production.
-- Idempotent (ON CONFLICT / a fixed marker on the events). No credential.
-- Rows whose accounts are missing are skipped.
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
select v.tool_slug, v.user_id, 'd0000000-0000-4000-a000-000000000001'::uuid, v.granted_at, v.expires_at, v.note
from (values
  ('collection-builder', 'd0000000-0000-4000-a000-000000000002'::uuid, now() - interval '21 days', null::timestamptz, 'Seeded tester'),
  ('token-kit',          'd0000000-0000-4000-a000-000000000002'::uuid, now() - interval '2 days',  now() + interval '30 days', 'Seeded tester, 30 days'),
  ('token-kit',          'd0000000-0000-4000-a000-000000000004'::uuid, now() - interval '40 days', now() - interval '3 days', 'Seeded: an ended grant')
) as v (tool_slug, user_id, granted_at, expires_at, note)
where exists (select 1 from public.profiles p where p.id = v.user_id)
  and exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000001'::uuid)
on conflict do nothing;

insert into public.tool_interest (tool_slug, user_id, created_at)
select v.tool_slug, v.user_id, now() - v.ago
from (values
  ('token-kit',         'd0000000-0000-4000-a000-000000000003'::uuid, interval '5 days'),
  ('pip-forge',         'd0000000-0000-4000-a000-000000000003'::uuid, interval '4 days'),
  ('pip-forge',         'd0000000-0000-4000-a000-000000000004'::uuid, interval '9 days'),
  ('set-symbol-studio', 'd0000000-0000-4000-a000-000000000004'::uuid, interval '9 days'),
  ('set-symbol-studio', 'd0000000-0000-4000-a000-000000000005'::uuid, interval '1 hour')
) as v (tool_slug, user_id, ago)
where exists (select 1 from public.profiles p where p.id = v.user_id)
on conflict do nothing;

-- Synthetic usage, once (props.seed marks the rows).
insert into public.tool_events (tool_slug, user_id, event, access, props, created_at)
select
  'collection-builder',
  u.user_id,
  e.event,
  u.access,
  jsonb_build_object('seed', true),
  now() - make_interval(days => d.day) - make_interval(mins => e.minute)
from (values
  ('d0000000-0000-4000-a000-000000000001'::uuid, 'admin'),
  ('d0000000-0000-4000-a000-000000000002'::uuid, 'grant')
) as u (user_id, access)
cross join generate_series(0, 20, 2) as d (day)
cross join (values ('open', 5), ('import', 9), ('buildable_decks', 14)) as e (event, minute)
where exists (select 1 from public.profiles p where p.id = u.user_id)
  and (u.access = 'grant' or d.day % 4 = 0)
  and not exists (
    select 1 from public.tool_events t
    where t.tool_slug = 'collection-builder' and t.props ? 'seed'
  );

-- The synthetic rows of a database seeded before the tool named its real
-- events (the dev branch): the same rows under the names the tool records,
-- so its seeded "uses" count as uses (lib/tools/catalog.ts TOOL_USE_EVENTS).
update public.tool_events
   set event = case event when 'import_csv' then 'import' else 'buildable_decks' end
 where tool_slug = 'collection-builder'
   and props ? 'seed'
   and event in ('import_csv', 'match_decks');

insert into public.notifications (recipient_id, actor_id, type, payload, created_at)
select
  'd0000000-0000-4000-a000-000000000002'::uuid,
  'd0000000-0000-4000-a000-000000000001'::uuid,
  'tool_access',
  jsonb_build_object('tool', 'token-kit', 'toolName', 'Token Kit', 'built', false, 'expiresAt', null),
  now() - interval '2 days'
where exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000002'::uuid)
  and exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000001'::uuid)
  and not exists (
    select 1 from public.notifications n
    where n.recipient_id = 'd0000000-0000-4000-a000-000000000002'::uuid and n.type = 'tool_access'
  );

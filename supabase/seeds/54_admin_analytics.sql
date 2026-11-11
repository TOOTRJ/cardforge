-- ---------------------------------------------------------------------------
-- 54_admin_analytics.sql — rows that make every tab of /admin/analytics draw
-- on a preview branch, the dev database and the local stack (the 2026-11
-- analytics page; migrations 0200–0204).
--
-- The other seeds already give the Funnel, Revenue, Credits and Referrals
-- tabs something to read. Two tabs had nothing:
--
--   Tools     45_beta_tools.sql seeds only `open` and two uses for one tool.
--             Here: what a tool records since the tools audit — refusals and
--             failures WITH a reason, a paid use carrying `credits`, a
--             browser's report carrying `credits_seen`, and a shared sheet's
--             view by a visitor with no account — from testers, so the tab
--             shows people with "Include admins" off.
--   Content   no card page view was ever seeded (a view is written by the
--             browser's ping). Here: two weeks of views on the public seed
--             cards, a few viewers a day.
--
--   Credits   the ledger rows behind the seeded tools' AI (a tool's cost is
--             the credit ledger's by reason, never an event's prop), one of
--             them refunded.
--
-- Never against production. No credential. Rows whose accounts or cards are
-- missing are skipped. Safe to run again, on any later day, WITHOUT growing:
-- the events are replaced when the last batch is three weeks old (so the
-- Tools tab is never left empty on the persistent dev database, whose every
-- period ends today), the views are added only for a card with none in the
-- last two weeks, and the ledger rows are keyed.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

-- Tools: what happened, to whom, by which way in. A batch older than three
-- weeks is replaced by a fresh one.
delete from public.tool_events t
 where t.props ->> 'seed' = 'analytics'
   and not exists (
     select 1 from public.tool_events n
      where n.props ->> 'seed' = 'analytics' and n.created_at > now() - interval '21 days'
   );

insert into public.tool_events (tool_slug, user_id, event, access, props, created_at)
select v.tool_slug, v.user_id, v.event, v.access, v.props || jsonb_build_object('seed', 'analytics'), now() - v.ago
from (values
  -- dev_pro, a tester of the Collection Deck Builder: two AI builds, one of
  -- them out of credits first, one that failed and was refunded.
  ('collection-builder', 'd0000000-0000-4000-a000-000000000002'::uuid, 'ai_build_failed', 'grant', '{"reason":"insufficient_credits","bracket":3}'::jsonb, interval '9 days'),
  ('collection-builder', 'd0000000-0000-4000-a000-000000000002'::uuid, 'ai_build',        'grant', '{"credits":1,"total":100,"ai_picks":61,"ms":41200}'::jsonb, interval '8 days'),
  ('collection-builder', 'd0000000-0000-4000-a000-000000000002'::uuid, 'ai_build_failed', 'grant', '{"reason":"design_busy","refunded":true,"refund_pending":false,"ms":9800}'::jsonb, interval '6 days'),
  ('collection-builder', 'd0000000-0000-4000-a000-000000000002'::uuid, 'ai_suggest',      'grant', '{"credits":1,"suggested":3,"ms":22100}'::jsonb, interval '5 days'),
  ('collection-builder', 'd0000000-0000-4000-a000-000000000002'::uuid, 'save_deck',       'grant', '{"cards":100,"visibility":"private"}'::jsonb, interval '5 days'),
  ('collection-builder', 'd0000000-0000-4000-a000-000000000002'::uuid, 'add_card_failed', 'grant', '{"reason":"rate_limited","surface":"search"}'::jsonb, interval '2 days'),
  -- dev_free, let in by a release: a token kit, built, exported and one
  -- export that failed in the browser.
  ('token-kit', 'd0000000-0000-4000-a000-000000000003'::uuid, 'open',              'release', '{}'::jsonb, interval '4 days'),
  ('token-kit', 'd0000000-0000-4000-a000-000000000003'::uuid, 'kit_built',         'release', '{"tokens":9,"source":"deck"}'::jsonb, interval '4 days'),
  ('token-kit', 'd0000000-0000-4000-a000-000000000003'::uuid, 'kit_exported',      'release', '{"kind":"pdf","tokens":9,"cards":18}'::jsonb, interval '4 days'),
  ('token-kit', 'd0000000-0000-4000-a000-000000000003'::uuid, 'kit_export_failed', 'release', '{"kind":"zip","reason":"error","failed":2,"ms":5300}'::jsonb, interval '3 days'),
  ('token-kit', 'd0000000-0000-4000-a000-000000000003'::uuid, 'token_save_failed', 'release', '{"reason":"capacity","kind":"token"}'::jsonb, interval '3 days'),
  -- dev_artist: a Rule 0 sheet — saved, shared, copied, and a re-art run
  -- whose own page reported what it watched go (never summed as cost).
  ('rule0-sheet', 'd0000000-0000-4000-a000-000000000004'::uuid, 'open',      'release', '{}'::jsonb, interval '2 days'),
  ('rule0-sheet', 'd0000000-0000-4000-a000-000000000004'::uuid, 'save',      'release', '{"custom":3}'::jsonb, interval '2 days'),
  ('rule0-sheet', 'd0000000-0000-4000-a000-000000000004'::uuid, 'share_on',  'release', '{}'::jsonb, interval '2 days'),
  ('rule0-sheet', 'd0000000-0000-4000-a000-000000000004'::uuid, 'copy_link', 'release', '{}'::jsonb, interval '2 days'),
  ('re-art-deck', 'd0000000-0000-4000-a000-000000000004'::uuid, 'open',         'grant', '{}'::jsonb, interval '1 day'),
  ('re-art-deck', 'd0000000-0000-4000-a000-000000000004'::uuid, 'start_sample', 'grant', '{"cards":3,"credits":3,"makes":0}'::jsonb, interval '1 day'),
  ('re-art-deck', 'd0000000-0000-4000-a000-000000000004'::uuid, 'run_finished', 'grant', '{"painted":3,"failed":0,"credits_seen":3,"stopped":"none"}'::jsonb, interval '1 day'),
  -- Visitors with no account, looking at the shared sheet.
  ('rule0-sheet', null::uuid, 'shared_view', null::text, '{"custom":3}'::jsonb, interval '30 hours'),
  ('rule0-sheet', null::uuid, 'shared_view', null::text, '{"custom":3}'::jsonb, interval '20 hours'),
  ('rule0-sheet', null::uuid, 'shared_view', null::text, '{"custom":3}'::jsonb, interval '3 hours')
) as v (tool_slug, user_id, event, access, props, ago)
where (v.user_id is null or exists (select 1 from public.profiles p where p.id = v.user_id))
  and not exists (
    select 1 from public.tool_events t where t.props ->> 'seed' = 'analytics'
  );

-- Content: two weeks of card page views on the public seed cards — the
-- first cards get more viewers, so "Most viewed" has an order. A viewer key
-- is 32 hex digits (here an md5 of the card, the day and a counter; real
-- keys are a salted hash the app writes).
insert into public.card_views (card_id, day, viewer_key)
select c.id, d.day, md5(c.id::text || ':' || d.day::text || ':' || v.n::text)
from (
  select id, row_number() over (order by created_at, id) as rank
  from public.cards
  where visibility = 'public'
  order by created_at, id
  limit 12
) c
cross join lateral (
  select ((now() at time zone 'utc')::date - g) as day, g
  from generate_series(0, 13) as g
) d
cross join lateral generate_series(1, greatest(1, 6 - (c.rank / 2)::int - (d.g % 3))) as v (n)
where not exists (
  select 1 from public.card_views seen
   where seen.card_id = c.id and seen.day >= (now() at time zone 'utc')::date - 13
)
on conflict do nothing;

-- Credits: the ledger rows behind the seeded tools' AI — what the Tools and
-- Credits tabs read as a tool's cost. Marked settled (the reconcile sweep
-- hands back an aged UNSETTLED spend) and keyed, so a re-run adds nothing.
-- One build failed and was refunded: its refund names its charge's key.
insert into public.credit_ledger (user_id, delta, reason, balance_after, idempotency_key, created_at, settled_at)
select
  v.user_id,
  v.delta,
  v.reason,
  coalesce((select p.credits from public.profiles p where p.id = v.user_id), 0),
  v.key,
  now() - v.ago,
  case when v.delta < 0 then now() - v.ago end
from (values
  ('d0000000-0000-4000-a000-000000000002'::uuid, -1, 'build_collection_deck',        'seed-analytics:spend:1',        interval '8 days'),
  ('d0000000-0000-4000-a000-000000000002'::uuid, -1, 'build_collection_deck',        'seed-analytics:spend:2',        interval '6 days'),
  ('d0000000-0000-4000-a000-000000000002'::uuid,  1, 'refund',                       'refund:seed-analytics:spend:2', interval '6 days'),
  ('d0000000-0000-4000-a000-000000000002'::uuid, -1, 'suggest_collection_commander', 'seed-analytics:spend:3',        interval '5 days'),
  ('d0000000-0000-4000-a000-000000000004'::uuid, -3, 'deck_reart_art',               'seed-analytics:spend:4',        interval '1 day')
) as v (user_id, delta, reason, key, ago)
where exists (select 1 from auth.users u where u.id = v.user_id)
  and not exists (select 1 from public.credit_ledger l where l.idempotency_key = v.key);

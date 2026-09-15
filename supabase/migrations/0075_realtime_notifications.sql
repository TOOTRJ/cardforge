-- ---------------------------------------------------------------------------
-- 0075 — Real-time notifications + admin-action notification types
--
-- Until now every alert was pull-on-navigation: a notification row only
-- surfaced when a server component re-rendered the header. This migration
-- (1) publishes `notifications` on the `supabase_realtime` publication so the
-- browser can subscribe to its own rows (components/notifications/
-- realtime-alerts.tsx), (2) adds a small `payload` for notification kinds
-- whose copy needs a number (credits granted, comp tier, card limit), and
-- (3) admits those three kinds to the type CHECK. The admin user tools
-- (lib/admin/user-actions.ts) insert them through the service role — the
-- table still has no INSERT policy for end users.
--
-- Realtime + RLS: postgres_changes honours the existing SELECT policy
-- ("Users read own notifications", auth.uid() = recipient_id), so a client
-- filtered on recipient_id only ever receives its own rows. No replica
-- identity change is needed for INSERT events.
-- ---------------------------------------------------------------------------

alter table public.notifications
  add column if not exists payload jsonb not null default '{}'::jsonb;

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'like', 'comment', 'remix', 'follow', 'feedback', 'moderation', 'message',
      'credit_grant', 'comp_plan', 'card_limit'
    )
  );

-- Publish the table for Realtime. Hosted projects and the local stack both
-- ship the `supabase_realtime` publication (empty by default); guard both
-- its absence and a re-run so the migration is idempotent.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     )
  then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;

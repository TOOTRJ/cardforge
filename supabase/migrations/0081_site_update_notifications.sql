-- 0081 — "site_update" notification kind + broadcast bookkeeping.
--
-- An admin can push a site update / upcoming feature (site_updates, 0080)
-- to EVERY user as a notification (bell, /notifications, realtime toast):
-- payload = { updateId, kind, title, summary, link }. Service-role insert in
-- batches (lib/updates/actions.ts notifyAllUsersAction), skipping anyone who
-- already holds a notification for that update so "send again" only reaches
-- people who joined since. site_updates records when/how many were sent.

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'like', 'comment', 'remix', 'follow', 'feedback', 'moderation', 'message',
      'credit_grant', 'comp_plan', 'card_limit', 'render_update', 'site_update'
    )
  );

alter table public.site_updates
  add column if not exists notified_at timestamptz,
  add column if not exists notified_count integer not null default 0;

-- The broadcast's "who already has one" check.
create index if not exists notifications_site_update_idx
  on public.notifications ((payload ->> 'updateId'))
  where type = 'site_update';

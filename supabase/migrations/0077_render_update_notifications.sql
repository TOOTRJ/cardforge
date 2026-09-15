-- 0077 — "render_update" notification kind.
--
-- When a renderer/frame change (CARD_LAYOUT_VERSION bump) leaves some of an
-- owner's published cards with an older stored image, the daily cron
-- (/api/cron/notify-render-updates) tells them once per version:
-- payload = { version, count }. Clicking it opens the dashboard's update
-- walkthrough. Service-role insert, like the other admin-originated kinds.

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'like', 'comment', 'remix', 'follow', 'feedback', 'moderation', 'message',
      'credit_grant', 'comp_plan', 'card_limit', 'render_update'
    )
  );

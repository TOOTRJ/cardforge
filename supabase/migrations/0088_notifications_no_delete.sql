-- 0088 — "Clear all" marks notifications read instead of deleting them
-- (owner decision 2026-09-16: the alert count and dots clear, the history
-- stays, like most apps). The 0087 DELETE policy is therefore unused —
-- take it back out so users can't delete notification rows at all.

drop policy if exists "Users delete own notifications" on public.notifications;
revoke delete on public.notifications from authenticated;

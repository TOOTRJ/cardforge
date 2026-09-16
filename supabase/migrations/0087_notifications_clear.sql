-- 0087 — users can clear their own notifications.
--
-- 0032 gave users SELECT + UPDATE on their notifications (triggers do the
-- inserts). "Clear all" in the bell popover and on /notifications deletes
-- the caller's rows, so add the matching DELETE policy. Nothing else can
-- delete: the policy is scoped to recipient_id = auth.uid().

drop policy if exists "Users delete own notifications" on public.notifications;
create policy "Users delete own notifications"
  on public.notifications for delete
  using (auth.uid() = recipient_id);

grant delete on public.notifications to authenticated;

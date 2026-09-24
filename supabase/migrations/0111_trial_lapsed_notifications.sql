-- 0111 — "trial_lapsed" notification kind (trial win-back).
--
-- When a trial ends without converting (cancelled during the trial, or the
-- card was never charged), the webhook writes ONE trial_lapsed notification
-- and sends ONE win-back email: 20% off the first month, applied
-- automatically at checkout for 30 days. The checkout action reads the
-- notification back (recipient + created_at, hence the index) to decide the
-- discount, so the row is both the bell entry and the eligibility record.
-- payload { subscriptionId, tier, discountPct, expiresAt }.
--
-- No new table or function: nothing to grant.

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'like', 'comment', 'remix', 'follow', 'feedback', 'moderation', 'message',
      'credit_grant', 'comp_plan', 'card_limit', 'render_update', 'site_update',
      'deck_generated', 'trial_ending', 'payment_received', 'checkout_reminder',
      'trial_lapsed'
    )
  );

create index if not exists notifications_trial_lapsed_idx
  on public.notifications (recipient_id, created_at desc)
  where type = 'trial_lapsed';

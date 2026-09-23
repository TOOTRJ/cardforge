-- 0109 — "trial_ending" notification kind.
--
-- Stripe sends customer.subscription.trial_will_end three days before a
-- trial ends (or at once for shorter trials). The webhook turns it into ONE
-- notification (bell, /notifications, realtime toast) and one "account"
-- email per subscription, payload
-- { subscriptionId, tier, trialEnd, hasPaymentMethod, amountCents, currency,
--   interval }. The index backs the once-per-subscription guard in
-- lib/stripe/webhook-handlers.ts (a retried delivery must not notify twice).
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
      'deck_generated', 'trial_ending'
    )
  );

create index if not exists notifications_trial_ending_idx
  on public.notifications ((payload ->> 'subscriptionId'))
  where type = 'trial_ending';

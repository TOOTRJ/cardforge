-- 0140 — "credit_refill_failed" notification kind: a subscription credit
-- grant that failed reaches every admin instead of a log line nobody reads.
--
-- Two writers (lib/billing/credit-alerts.ts), one row per admin each:
--   * the daily refill cron (/api/cron/refill-credits) when any grant
--     failed or a profiles page could not be read —
--     payload { source: 'cron', dedupeKey: 'cron:<YYYY-MM-DD>', period,
--     day, processed, granted, failed, pageError, userIds, error };
--   * invoice.paid when its grant failed (the webhook still answers 200;
--     Stripe's retries are unchanged) —
--     payload { source: 'invoice', dedupeKey: 'invoice:<id>', invoiceId,
--     userId, error }.
-- Copy: lib/notifications/describe.ts. Delivered in real time by the
-- existing Realtime publication (0075).
--
-- The unique partial index is the dedupe: ONE row per admin per key — a
-- cron that fails all day alerts each admin once that UTC day (again the
-- next day while it keeps failing), an invoice once however often Stripe
-- redelivers it. A concurrent duplicate insert fails with 23505, which the
-- writer treats as "already alerted". Rows of every other kind are
-- untouched by it.
--
-- Grants: none needed — no table or function is created; the CHECK and an
-- index on public.notifications carry no privileges.
--
-- Ships through a PR; never applied ad-hoc.

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'like', 'comment', 'remix', 'follow', 'feedback', 'moderation', 'message',
      'credit_grant', 'comp_plan', 'card_limit', 'render_update', 'site_update',
      'deck_generated', 'trial_ending', 'payment_received', 'checkout_reminder',
      'trial_lapsed', 'render_sweep_paused', 'credit_refill_failed'
    )
  );

create unique index if not exists notifications_credit_refill_failed_once_idx
  on public.notifications ((payload ->> 'dedupeKey'), recipient_id)
  where type = 'credit_refill_failed';

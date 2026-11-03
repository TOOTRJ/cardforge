-- 0161 — "comp_ending" notification kind: a complimentary plan (an admin
-- comp, profiles.comp_tier / comp_expires_at) is about to end.
--
-- One writer, the daily cron /api/cron/comp-ending (lib/billing/comp-ending.ts):
-- 7 days and 1 day before comp_expires_at, one row per comp per window —
--   payload { dedupeKey: 'comp_ending:<comp_expires_at epoch>:<7d|1d>',
--             window, kind ('free' | 'held_trial' | 'paying' | 'plan_ending'),
--             tier, expiresAt, priceLabel?, nextChargeAt?, cardLast4?,
--             planEndsAt? }
-- plus the same message as an "account" email. Copy:
-- lib/notifications/describe.ts. Delivered in real time by the existing
-- Realtime publication (0075).
--
-- The unique partial index is the dedupe: ONE row per recipient per key. The
-- key carries the comp's end, so a RE-DATED comp is reminded afresh; a
-- concurrent duplicate insert fails with 23505, which the writer reads as
-- "already sent" (and then sends no email). Rows of every other kind are
-- untouched by it.
--
-- The CHECK is 0156's list (the last to redefine it) plus 'comp_ending' —
-- nothing dropped.
--
-- Grants: none needed — no table, view or function is created; a CHECK and
-- an index on public.notifications carry no privileges, and the table's
-- grants (0097, 0074) are unchanged.
--
-- Idempotent (drop … if exists / create … if not exists). Ships through a
-- PR; never applied ad-hoc.

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'like', 'comment', 'remix', 'follow', 'feedback', 'moderation', 'message',
      'credit_grant', 'comp_plan', 'card_limit', 'render_update', 'site_update',
      'deck_generated', 'trial_ending', 'payment_received', 'checkout_reminder',
      'trial_lapsed', 'render_sweep_paused', 'credit_refill_failed',
      'deck_like', 'deck_card_added', 'moderation_unhidden', 'comp_ending'
    )
  );

create unique index if not exists notifications_comp_ending_once_idx
  on public.notifications ((payload ->> 'dedupeKey'), recipient_id)
  where type = 'comp_ending';

-- 0099_stripe_events_claims.sql — a Stripe event can survive a mid-handler crash.
--
-- The webhook claimed an event by INSERTing its id BEFORE processing it and
-- deleted the claim if the handler threw. A process kill between the two (a
-- function timeout, an OOM, a deploy) left the claim in place with no work
-- done, and every Stripe retry was answered "already processed". For a
-- payment event that is money taken with nothing delivered, forever.
--
-- Now a claim starts UNPROCESSED (processed_at null) and is stamped only after
-- the handler succeeds. A retry that finds an unprocessed claim older than the
-- takeover window re-runs the (idempotent) handler; a younger one is told to
-- try again later. Existing rows keep their processed_at (they were all
-- stamped at insert), so nothing already handled is ever re-run.

alter table public.stripe_events
  alter column processed_at drop not null,
  alter column processed_at drop default;

alter table public.stripe_events
  add column if not exists claimed_at timestamptz not null default now();

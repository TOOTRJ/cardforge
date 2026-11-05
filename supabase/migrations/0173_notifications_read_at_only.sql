-- 0173_notifications_read_at_only.sql — a user may change ONE column of a
-- notification: read_at (billing audit 2026-11-05, finding P1-1).
--
-- Until now `authenticated` held a table-wide UPDATE grant on
-- public.notifications (0097, "everything except DELETE") under a
-- column-blind policy (0032: `auth.uid() = recipient_id`). Nothing pinned
-- `type`, `payload` or `created_at`, so a signed-in user could PATCH one of
-- their own rows into a `trial_lapsed` row dated today and buy a plan at the
-- win-back discount (`createCheckoutSessionAction` reads that row as the
-- eligibility record, 0111), or forge `payload.trialEnd` on a `trial_ending`
-- row and suppress their own reminder (`handleTrialWillEnd`).
--
-- The app's only user-side write sets `read_at` ("mark read" / "Clear all",
-- `markAllNotificationsSeen` in lib/notifications/queries.ts; a message
-- thread's mark-read goes through mark_message_thread_read, 0070, SECURITY
-- DEFINER, and the admin inbox writes through the service role). Every
-- other write is a SECURITY DEFINER trigger or the service role. So:
--
-- 1. UPDATE is a COLUMN grant on `read_at` alone. PostgREST's PATCH of any
--    other column answers 42501; the 0032 UPDATE policy still scopes the row
--    to its recipient.
-- 2. INSERT and TRUNCATE are taken back from `authenticated`: no policy ever
--    allowed an insert (RLS refused it), and TRUNCATE bypasses RLS entirely —
--    unreachable through PostgREST, still wrong to hold. `anon` loses its
--    0097 table-wide INSERT / UPDATE / DELETE / TRUNCATE the same way (inert
--    under RLS — auth.uid() is null — but wider than the signed-in role's).
-- 3. SELECT, MAINTAIN, REFERENCES and TRIGGER stay as 0097 granted them.
--
-- The service role keeps its table-level access (0097). Local Docker stacks
-- auto-grant on new tables; the revoke below applies there too.
--
-- Idempotent. Grants are stated explicitly (0097: new projects grant nothing
-- by default). Ships through a PR; never applied ad-hoc.

revoke insert, truncate, update on table public.notifications from authenticated;
revoke insert, update, delete, truncate on table public.notifications from anon;
grant update (read_at) on table public.notifications to authenticated;

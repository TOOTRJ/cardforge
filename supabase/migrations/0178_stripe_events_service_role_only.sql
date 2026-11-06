-- 0178_stripe_events_service_role_only.sql — the webhook's claim table is the
-- service role's alone (Stripe audit 2026-11-05, nice-to-have).
--
-- 0097 granted every API role full table privileges on public.stripe_events
-- ("RLS is the gate"), and the table has RLS on with NO policy, so anon and
-- authenticated could never read or write a row. The grants were still wider
-- than the table's one writer (app/api/stripe/webhook/route.ts, service
-- role): a future policy, or a role-level RLS bypass, would have opened the
-- idempotency record of every Stripe event to the browser. Revoke-first, as
-- the newer migrations state it; the service role keeps what it uses.

revoke all on table public.stripe_events from public, anon, authenticated;
grant select, insert, update, delete on table public.stripe_events to service_role;

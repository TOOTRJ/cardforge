-- 0139 — billing_payments + billing_pack_payments: the API roles keep
-- SELECT on authenticated only.
--
-- Ships through a PR; never applied ad-hoc.
--
-- Every database auto-grants EVERY privilege on a new public table to anon
-- and authenticated: production because it is an old Supabase project,
-- every branch and the local stack because 0097 aligned their default
-- privileges to production's.
--
--   billing_payments (0110, the invoice.paid revenue log) granted SELECT to
--   authenticated and revoked nothing, so anon and authenticated still hold
--   INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and (Postgres 17)
--   MAINTAIN.
--
--   billing_pack_payments (0138, the pack revenue log) revoked anon's
--   privileges and authenticated's by name — but the list has no MAINTAIN
--   (a named `maintain` fails before Postgres 17), so authenticated still
--   holds it: LOCK TABLE … ACCESS EXCLUSIVE, VACUUM, ANALYZE.
--
-- RLS (one admin-only SELECT policy on each) blocks the row writes, but not
-- TRUNCATE or MAINTAIN, which RLS does not cover. `revoke all` + `grant
-- select` (as 0095 / 0127 / 0132 do) takes every one of them on any
-- Postgres version.
--
-- Unchanged on both: authenticated keeps SELECT (the admin-read policy
-- still decides which rows; the Revenue panel itself reads with the
-- service role), and service_role keeps SELECT / INSERT / UPDATE / DELETE
-- — the webhook's writes and the panel's reads. anon gets nothing.

revoke all on public.billing_payments from anon, authenticated;
grant select on public.billing_payments to authenticated;
grant select, insert, update, delete on public.billing_payments to service_role;

revoke all on public.billing_pack_payments from anon, authenticated;
grant select on public.billing_pack_payments to authenticated;
grant select, insert, update, delete on public.billing_pack_payments to service_role;

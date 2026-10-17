-- 0139 — billing_payments: revoke the API roles' write privileges.
--
-- Ships through a PR; never applied ad-hoc.
--
-- 0110 created billing_payments (the invoice.paid revenue log) and granted
-- SELECT to authenticated and SELECT / INSERT / UPDATE / DELETE to
-- service_role — but it revoked nothing, and every database auto-grants
-- EVERY privilege on a new public table to anon and authenticated:
-- production because it is an old Supabase project, every branch and the
-- local stack because 0097 aligned their default privileges to
-- production's. So both roles still hold INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES, TRIGGER and (Postgres 17) MAINTAIN. RLS (one admin-only
-- SELECT policy) blocks the row writes, but not TRUNCATE, which RLS does
-- not cover. `revoke all` + `grant select` (as 0095 / 0127 / 0132 do) takes
-- every one of them, MAINTAIN included, on any Postgres version — a named
-- `maintain` would fail before 17.
--
-- Unchanged: authenticated keeps SELECT (the admin-read policy still
-- decides which rows; the Revenue panel itself reads with the service
-- role), and service_role keeps what 0110 granted — the webhook's upsert
-- and the panel's reads. anon gets nothing.

revoke all on public.billing_payments from anon, authenticated;
grant select on public.billing_payments to authenticated;
grant select, insert, update, delete on public.billing_payments to service_role;

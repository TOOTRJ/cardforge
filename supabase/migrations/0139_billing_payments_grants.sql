-- 0139 — billing_payments: revoke the API roles' write privileges.
--
-- Ships through a PR; never applied ad-hoc.
--
-- 0110 created billing_payments (the invoice.paid revenue log) and granted
-- SELECT to authenticated and SELECT / INSERT / UPDATE / DELETE to
-- service_role — but production is an old Supabase project that
-- auto-grants EVERY privilege on a new public table to anon and
-- authenticated (so does the local stack). There, both roles still hold
-- INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER. RLS (one
-- admin-only SELECT policy) blocks the row writes, but not TRUNCATE, which
-- RLS does not cover. New projects (every branch) never had them, so this
-- makes every database match: the same revokes as 0123 and 0138.
--
-- Unchanged: authenticated keeps SELECT (the admin-read policy still
-- decides which rows; the Revenue panel itself reads with the service
-- role), and service_role keeps what 0110 granted — the webhook's upsert
-- and the panel's reads. anon gets nothing.

revoke all on public.billing_payments from anon;
grant select on public.billing_payments to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.billing_payments from authenticated;
grant select, insert, update, delete on public.billing_payments to service_role;

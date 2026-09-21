-- 0096_challenges_admin_policies.sql — admins can write challenges again.
--
-- 0040 gated challenge writes with
--   exists (select 1 from profiles where id = auth.uid() and is_admin)
-- 0074 then revoked the `authenticated` role's SELECT on profiles.is_admin
-- (column-level grants), so evaluating that subquery as a signed-in user
-- fails outright: "permission denied for table profiles". Unlike the other
-- old-shape admin tables, challenges are written with the ADMIN'S OWN
-- session (lib/challenges/actions.ts uses the cookie client after an
-- is_admin gate, not the service role) — so since 0074 create / edit /
-- close / delete on /admin/challenges has errored for every admin.
--
-- Fix: the same shape 0080 introduced — viewer_is_admin(), a SECURITY
-- DEFINER helper that reads the flag for auth.uid() only. Audited against
-- pg_policies on 2026-09-21: these three are the only remaining policies
-- that read profiles.is_admin directly.
--
-- The SELECT policy (`using (true)`) is untouched: challenges stay public.

drop policy if exists "Admins can insert challenges" on public.challenges;
create policy "Admins can insert challenges"
  on public.challenges
  for insert
  with check (public.viewer_is_admin());

drop policy if exists "Admins can update challenges" on public.challenges;
create policy "Admins can update challenges"
  on public.challenges
  for update
  using (public.viewer_is_admin())
  with check (public.viewer_is_admin());

drop policy if exists "Admins can delete challenges" on public.challenges;
create policy "Admins can delete challenges"
  on public.challenges
  for delete
  using (public.viewer_is_admin());

-- Hardening — scope set_likes SELECT to visible sets only.
-- Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP.
--
-- 0023 shipped set_likes with `using (true)` on SELECT — the exact permissive
-- pattern that 0012 deliberately fixed for card_likes. It lets any (even
-- anonymous) caller enumerate which user liked which set, including likes on
-- PRIVATE/UNLISTED sets belonging to other users. user_id is a foreign key to
-- auth.users (PII-adjacent), so this is worth tightening for parity with
-- card_likes even though the practical impact is small.
--
-- After this migration: a row in set_likes is visible iff the referenced set
-- is visible to the caller (public/unlisted, or the caller owns it). This
-- piggybacks on the existing card_sets RLS by EXISTS-joining to it, keeping the
-- "who can see this set" rule in one place.
--
-- The INSERT and DELETE policies are unchanged — those are already correctly
-- auth.uid()-bound.

drop policy if exists "Set likes are publicly readable" on public.set_likes;

create policy "Set likes are readable when their set is visible"
  on public.set_likes
  for select
  using (
    exists (
      select 1
      from public.card_sets s
      where s.id = set_id
        and (
          s.visibility in ('public', 'unlisted')
          or s.owner_id = auth.uid()
        )
    )
  );

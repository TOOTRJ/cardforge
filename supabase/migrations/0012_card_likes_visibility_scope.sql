-- Phase 9 hardening — scope card_likes SELECT to visible cards only.
-- Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP.
--
-- Before this migration: card_likes.select used `using (true)`, which let
-- any (even anonymous) caller enumerate which user liked which card —
-- including likes on PRIVATE cards belonging to other users. The user_id
-- column is a foreign key to auth.users and is arguably PII-adjacent, so
-- this is worth tightening even though the practical impact is small.
--
-- After this migration: a row in card_likes is visible iff the referenced
-- card is visible to the caller (public/unlisted, or the caller owns it).
-- This piggybacks on the existing `cards` table RLS by EXISTS-joining to
-- it, so the "who can see this card" rule stays in one place.
--
-- The INSERT and DELETE policies are unchanged — those are already
-- correctly auth.uid()-bound.

drop policy if exists "Card likes are publicly readable" on public.card_likes;

create policy "Card likes are readable when their card is visible"
  on public.card_likes
  for select
  using (
    exists (
      select 1
      from public.cards c
      where c.id = card_id
        and (
          c.visibility in ('public', 'unlisted')
          or c.owner_id = auth.uid()
        )
    )
  );

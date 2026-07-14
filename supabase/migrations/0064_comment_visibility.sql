-- ---------------------------------------------------------------------------
-- Gate card_comments INSERT to cards the author can actually SEE.
--
-- The original policy (0019) only checked `author_id = auth.uid()`, with no
-- visibility guard — unlike the sibling card_likes (0008) / deck_cards (0055)
-- INSERT policies, which EXISTS-join the parent so the parent's own RLS
-- filters it. That gap let a signed-in user with a bare card id comment on
-- someone else's PRIVATE card (the FK check bypasses RLS), firing a
-- `notify_on_card_comment` notification to the owner — who can't even read or
-- moderate the comment (the SELECT policy only exposes it on public cards or
-- to its author). An invisible, un-removable notification-spam vector.
--
-- The EXISTS subquery runs under the inserting user's RLS on `cards`, so a
-- private card they don't own is simply not visible → the check fails → the
-- insert is blocked. Owners can still comment on their own (private) cards.
-- ---------------------------------------------------------------------------

drop policy if exists "Comments: authors insert their own" on public.card_comments;

create policy "Comments: authors insert their own"
  on public.card_comments
  for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1
      from public.cards c
      where c.id = card_id
    )
  );

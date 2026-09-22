-- 0102_deck_likes_visibility_and_feedback_fk.sql — two leftovers from 0055/0051.
--
-- 1. deck_likes was `select using (true)`: anyone — anonymous included —
--    could enumerate who liked a PRIVATE or unlisted deck. 0012 (card_likes)
--    and 0024 (set_likes) closed exactly this for the other two like tables;
--    decks (0055) shipped with the old shape. Same rule now: a like is
--    readable when its deck is (public/unlisted, or you own it), plus your
--    own likes.
--
-- 2. feedback.resolved_by referenced auth.users with the default NO ACTION,
--    so an admin who has ever resolved a piece of feedback could no longer
--    delete their account — the regression of the 0031 fix that gave every
--    other auth.users reference `on delete set null`.

drop policy if exists "Deck likes are publicly readable" on public.deck_likes;
create policy "Deck likes are readable when their deck is visible"
  on public.deck_likes
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.decks d
      where d.id = deck_id
        and (
          d.visibility in ('public', 'unlisted')
          or d.owner_id = auth.uid()
        )
    )
  );

alter table public.feedback
  drop constraint if exists feedback_resolved_by_fkey;
alter table public.feedback
  add constraint feedback_resolved_by_fkey
  foreign key (resolved_by) references auth.users (id) on delete set null;

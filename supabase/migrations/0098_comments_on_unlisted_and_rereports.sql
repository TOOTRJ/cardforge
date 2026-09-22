-- 0098_comments_on_unlisted_and_rereports.sql — two moderation/visibility fixes.
--
-- 1. Comments on UNLISTED cards were write-only. 0064 let people comment on
--    any card they can see (public or unlisted), the trigger notified the
--    owner — and then 0019's SELECT policy (`visibility = 'public' or author`)
--    hid the comment from the owner and from every other viewer. The rule is
--    now the natural one: a comment is readable wherever its card is readable
--    (public/unlisted for everyone, plus the card's owner), and always by its
--    author. Private cards stay owner-only, as before.
--
-- 2. Reports could only ever be filed once per (target, reporter): the plain
--    UNIQUE constraint kept holding after the report was dismissed or actioned,
--    and the action treated the 23505 as "already reported, fine". So an owner
--    could republish a hidden card and the people who caught it the first time
--    could never flag it again. The uniqueness now applies to PENDING reports
--    only — one open report per person per target, unlimited history.

-- 1. Comments readable wherever the card is -----------------------------------
drop policy if exists "Comments: readable on public cards or by author"
  on public.card_comments;

create policy "Comments: readable where the card is, or by author"
  on public.card_comments
  for select
  using (
    author_id = auth.uid()
    or exists (
      select 1
      from public.cards c
      where c.id = card_id
        and (
          c.visibility in ('public', 'unlisted')
          or c.owner_id = auth.uid()
        )
    )
  );

-- 2. One PENDING report per reporter per target ---------------------------------
alter table public.card_reports
  drop constraint if exists card_reports_unique_reporter;
create unique index if not exists card_reports_one_pending_per_reporter
  on public.card_reports (card_id, reporter_id)
  where status = 'pending';

alter table public.comment_reports
  drop constraint if exists comment_reports_unique_reporter;
create unique index if not exists comment_reports_one_pending_per_reporter
  on public.comment_reports (comment_id, reporter_id)
  where status = 'pending';

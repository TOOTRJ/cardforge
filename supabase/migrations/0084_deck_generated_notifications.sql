-- 0084 — "deck_generated" notification kind.
--
-- When an AI deck job (kind deck / deck_remix) finishes — every step done,
-- or done with some failures — the owner gets ONE notification (bell,
-- /notifications, realtime toast) with payload
-- { jobId, deckId, slug, title, done, failed }. Written by the step route
-- through the service role; the index backs the once-per-job check.

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'like', 'comment', 'remix', 'follow', 'feedback', 'moderation', 'message',
      'credit_grant', 'comp_plan', 'card_limit', 'render_update', 'site_update',
      'deck_generated'
    )
  );

create index if not exists notifications_deck_generated_idx
  on public.notifications ((payload ->> 'jobId'))
  where type = 'deck_generated';

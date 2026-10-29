-- 0146_feedback_area.sql — WHERE a piece of feedback came from (TODO DK10.1):
-- the deck feedback dialog (the deck page's toolbar and footer, My Decks,
-- the beta banner) files into the same `feedback` table as /feedback, and
-- the admin inbox filters on the area.
--
--   area      NULL = the general /feedback page (every row that exists
--             today, and everything that page sends); 'decks' = the deck
--             dialog. A new area is one more value in feedback_area_check
--             AND in FEEDBACK_AREAS (lib/feedback/schemas.ts) — a unit test
--             holds the two lists together.
--   deck_id   the deck the dialog was opened on (`on delete set null`, as
--             card_id: the feedback outlives the deck). Only on a 'decks'
--             row (feedback_deck_needs_area).
--   viewport  the sender's window, "<width>x<height>" in CSS px — a bug
--             report's screen size. Nothing else about the device is kept.
--
-- No stored row changes: the columns are added NULL, nothing is backfilled.
-- The admin fan-out (0051's feedback_notify_admins) fires on every insert,
-- so deck feedback pings the admins' bell exactly as /feedback does.
--
-- RLS: 0051's two policies keep their rules. The INSERT one gains ONE
-- clause — a deck_id must name a deck the sender can READ (decks' own
-- select policy applies inside it: public, unlisted or their own), so
-- nobody files feedback "about" someone else's private deck through the
-- API. Users still read only their own rows and have no UPDATE / DELETE
-- policy; the admin inbox reads through the service role.
--
-- Grants: `feedback` is granted at TABLE level (0097: every API role, RLS
-- as the gate), which covers a new column on every project; no function,
-- table or sequence is created, so there is nothing new to grant.
--
-- Ships through a PR; never applied ad-hoc. Idempotent.

alter table public.feedback
  add column if not exists area text,
  add column if not exists deck_id uuid references public.decks (id) on delete set null,
  add column if not exists viewport text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'feedback_area_check'
      and conrelid = 'public.feedback'::regclass
  ) then
    alter table public.feedback
      add constraint feedback_area_check
      check (area is null or area in ('decks'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'feedback_deck_needs_area'
      and conrelid = 'public.feedback'::regclass
  ) then
    -- `is not distinct from`, never `=`: a NULL area makes `area = 'decks'`
    -- NULL, and a CHECK lets a NULL through.
    alter table public.feedback
      add constraint feedback_deck_needs_area
      check (deck_id is null or area is not distinct from 'decks');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'feedback_viewport_shape'
      and conrelid = 'public.feedback'::regclass
  ) then
    alter table public.feedback
      add constraint feedback_viewport_shape
      check (viewport is null or viewport ~ '^[0-9]{1,5}x[0-9]{1,5}$');
  end if;
end $$;

comment on column public.feedback.area is
  'Where the feedback was sent from (TODO DK10.1): NULL = the general /feedback page, ''decks'' = the deck feedback dialog. Mirrors FEEDBACK_AREAS in lib/feedback/schemas.ts.';
comment on column public.feedback.deck_id is
  'The deck the deck feedback dialog was opened on (a deck the sender could read). Only on an area = ''decks'' row.';
comment on column public.feedback.viewport is
  'The sender''s window size when they sent it, "<width>x<height>" in CSS px.';

-- The inbox's Area filter reads newest-first within an area; a deck's
-- deletion finds its feedback through deck_id (the FK's set null).
create index if not exists feedback_area_created_idx
  on public.feedback (area, created_at desc) where area is not null;
create index if not exists feedback_deck_idx
  on public.feedback (deck_id) where deck_id is not null;

-- 0051's insert rule, plus: a deck the sender can read, or none.
drop policy if exists "Users insert own feedback" on public.feedback;
create policy "Users insert own feedback"
  on public.feedback for insert
  with check (
    auth.uid() = user_id
    and (
      feedback.deck_id is null
      or exists (select 1 from public.decks d where d.id = feedback.deck_id)
    )
  );

-- 0051_feedback_admin_notifications.sql — user feedback intake + admin
-- notifications.
--
--   * feedback: one row per submission (bug reports, frame/layout issues,
--     feature requests, frame requests). Users INSERT + read their own rows
--     (so the feedback page can show submission history + status); admin
--     reads/updates go through the service-role client gated by
--     profiles.is_admin in app code — the same split card_reports uses.
--   * notifications.type gains 'feedback' and 'moderation'; SECURITY DEFINER
--     triggers fan a notification out to every admin when feedback arrives
--     or a content/comment report is filed.

-- 1. Feedback table -----------------------------------------------------------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  -- Keep the feedback even if the account is later deleted.
  user_id uuid references auth.users (id) on delete set null,
  category text not null,
  subject text not null,
  message text not null,
  -- Optional context: the frame being reported and/or a specific card.
  frame_template text,
  card_id uuid references public.cards (id) on delete set null,
  page_url text,
  status text not null default 'new',
  admin_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id),
  constraint feedback_category_check
    check (category in ('bug', 'frame', 'feature', 'frame_request', 'other')),
  constraint feedback_status_check
    check (status in ('new', 'reviewed', 'resolved')),
  constraint feedback_subject_length
    check (char_length(subject) between 1 and 120),
  constraint feedback_message_length
    check (char_length(message) between 1 and 2000),
  constraint feedback_frame_template_length
    check (frame_template is null or char_length(frame_template) <= 40),
  constraint feedback_page_url_length
    check (page_url is null or char_length(page_url) <= 512)
);

create index if not exists feedback_status_created_idx
  on public.feedback (status, created_at desc);
create index if not exists feedback_user_created_idx
  on public.feedback (user_id, created_at desc);

alter table public.feedback enable row level security;

drop policy if exists "Users insert own feedback" on public.feedback;
drop policy if exists "Users read own feedback" on public.feedback;

create policy "Users insert own feedback"
  on public.feedback for insert
  with check (auth.uid() = user_id);

create policy "Users read own feedback"
  on public.feedback for select
  using (auth.uid() = user_id);
-- No user UPDATE/DELETE: status transitions are admin-only (service role).

-- 2. Notification types -------------------------------------------------------
alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('like', 'comment', 'remix', 'follow', 'feedback', 'moderation'));

-- 3. Admin fan-out triggers ---------------------------------------------------
-- One row per admin per event. actor_id carries the submitting user so the
-- bell can attribute it ("<user> sent feedback"); recipients are admins.

create or replace function public.notify_admins_on_feedback()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, type, card_id)
  select p.id, new.user_id, 'feedback', new.card_id
  from public.profiles p
  where p.is_admin and (new.user_id is null or p.id <> new.user_id);
  return new;
end;
$$;
revoke all on function public.notify_admins_on_feedback() from public, anon, authenticated;

drop trigger if exists feedback_notify_admins on public.feedback;
create trigger feedback_notify_admins
  after insert on public.feedback
  for each row execute function public.notify_admins_on_feedback();

create or replace function public.notify_admins_on_card_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, type, card_id)
  select p.id, new.reporter_id, 'moderation', new.card_id
  from public.profiles p
  where p.is_admin and p.id <> new.reporter_id;
  return new;
end;
$$;
revoke all on function public.notify_admins_on_card_report() from public, anon, authenticated;

drop trigger if exists card_reports_notify_admins on public.card_reports;
create trigger card_reports_notify_admins
  after insert on public.card_reports
  for each row execute function public.notify_admins_on_card_report();

create or replace function public.notify_admins_on_comment_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, type)
  select p.id, new.reporter_id, 'moderation'
  from public.profiles p
  where p.is_admin and p.id <> new.reporter_id;
  return new;
end;
$$;
revoke all on function public.notify_admins_on_comment_report() from public, anon, authenticated;

drop trigger if exists comment_reports_notify_admins on public.comment_reports;
create trigger comment_reports_notify_admins
  after insert on public.comment_reports
  for each row execute function public.notify_admins_on_comment_report();

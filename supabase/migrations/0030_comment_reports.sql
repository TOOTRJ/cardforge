-- 0030_comment_reports.sql — user reporting for comments (mirrors 0029's
-- card_reports). Comments are user-generated text on public cards; they need the
-- same abuse path. Admin resolution ("remove" = delete the comment) runs via the
-- service role; the on-delete cascade then clears the comment's reports.

create table if not exists public.comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.card_comments (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id),
  constraint comment_reports_unique_reporter unique (comment_id, reporter_id),
  constraint comment_reports_reason_check
    check (reason in ('nsfw', 'ip', 'spam', 'hateful', 'other')),
  constraint comment_reports_details_length
    check (details is null or char_length(details) <= 1000),
  constraint comment_reports_status_check
    check (status in ('pending', 'dismissed', 'actioned'))
);

create index if not exists comment_reports_status_created_idx
  on public.comment_reports (status, created_at desc);
create index if not exists comment_reports_comment_idx
  on public.comment_reports (comment_id);

alter table public.comment_reports enable row level security;

drop policy if exists "Users can file comment reports" on public.comment_reports;
drop policy if exists "Users read own comment reports" on public.comment_reports;

create policy "Users can file comment reports"
  on public.comment_reports for insert
  with check (auth.uid() = reporter_id);

create policy "Users read own comment reports"
  on public.comment_reports for select
  using (auth.uid() = reporter_id);

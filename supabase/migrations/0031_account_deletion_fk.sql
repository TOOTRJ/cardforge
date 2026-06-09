-- 0031 — let admin account deletion survive the report-resolver references.
-- card_reports.resolved_by / comment_reports.resolved_by point at auth.users
-- with NO ACTION, so deleting an admin who had resolved any reports would be
-- blocked by these FKs. Switch them to ON DELETE SET NULL: the resolution record
-- stays, only the "who resolved it" pointer clears. (All other user-owned rows
-- already cascade from auth.users, so a normal user delete was never blocked.)

alter table public.card_reports
  drop constraint card_reports_resolved_by_fkey,
  add constraint card_reports_resolved_by_fkey
    foreign key (resolved_by) references auth.users (id) on delete set null;

alter table public.comment_reports
  drop constraint comment_reports_resolved_by_fkey,
  add constraint comment_reports_resolved_by_fkey
    foreign key (resolved_by) references auth.users (id) on delete set null;

-- 0070_admin_messaging.sql — admin ↔ user support messaging.
--
--   * message_threads: one conversation between the PipGlyph team and ONE
--     user. Only admins open threads (independently, or as the reply to a
--     feedback submission — at most one thread per feedback row). Both sides
--     reply. Denormalised list fields (last message, per-side unread counts)
--     keep the inbox and the nav badge a single indexed read.
--   * messages: the individual posts. sender_role is stored (not derived)
--     so the transcript stays truthful if an admin later loses the flag.
--   * notifications gains type 'message' + thread_id: an admin post notifies
--     the user (bell + optional email, app-side); a user reply fans out to
--     every admin, mirroring the feedback trigger in 0051.
--   * mark_message_thread_read: the user's only write to a thread — a
--     SECURITY DEFINER RPC (the row has admin-side counters a user must not
--     touch, so there is deliberately NO user UPDATE policy).
--
-- Posture (same split as feedback / moderation): users read + post in their
-- own threads under RLS; every admin write goes through the service role
-- gated on profiles.is_admin in app code.

-- 1. Threads ----------------------------------------------------------------
create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject text not null,
  -- The feedback submission this thread answers (null = independent).
  feedback_id uuid references public.feedback (id) on delete set null,
  -- The admin who opened it (kept even if they lose the flag / leave).
  created_by uuid references auth.users (id) on delete set null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  last_sender_role text,
  user_unread_count integer not null default 0,
  admin_unread_count integer not null default 0,
  user_last_read_at timestamptz,
  admin_last_read_at timestamptz,
  constraint message_threads_subject_length
    check (char_length(subject) between 1 and 120),
  constraint message_threads_status_check
    check (status in ('open', 'closed')),
  constraint message_threads_last_sender_check
    check (last_sender_role is null or last_sender_role in ('user', 'admin')),
  constraint message_threads_unread_nonneg
    check (user_unread_count >= 0 and admin_unread_count >= 0)
);

-- One thread per feedback submission; the inbox and the nav badge read by
-- user + recency, the admin inbox by recency and by "needs a reply".
create unique index if not exists message_threads_feedback_unique
  on public.message_threads (feedback_id) where feedback_id is not null;
create index if not exists message_threads_user_recent_idx
  on public.message_threads (user_id, last_message_at desc);
create index if not exists message_threads_recent_idx
  on public.message_threads (last_message_at desc);
create index if not exists message_threads_admin_unread_idx
  on public.message_threads (last_message_at desc) where admin_unread_count > 0;

alter table public.message_threads enable row level security;

drop policy if exists "Users read own threads" on public.message_threads;
create policy "Users read own threads"
  on public.message_threads for select
  using (auth.uid() = user_id);
-- No user INSERT/UPDATE/DELETE: admins open threads (service role); the
-- user's read-marker goes through mark_message_thread_read below.

-- 2. Messages ---------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads (id) on delete cascade,
  sender_id uuid references auth.users (id) on delete set null,
  sender_role text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_sender_role_check
    check (sender_role in ('user', 'admin')),
  constraint messages_body_length
    check (char_length(body) between 1 and 4000)
);

create index if not exists messages_thread_created_idx
  on public.messages (thread_id, created_at asc);

alter table public.messages enable row level security;

drop policy if exists "Users read messages in own threads" on public.messages;
drop policy if exists "Users reply in own open threads" on public.messages;

create policy "Users read messages in own threads"
  on public.messages for select
  using (
    exists (
      select 1 from public.message_threads t
      where t.id = thread_id and t.user_id = auth.uid()
    )
  );

-- A user may only post as themselves, as 'user', into their OWN thread, and
-- only while it is open. Admin posts arrive via the service role.
create policy "Users reply in own open threads"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and sender_role = 'user'
    and exists (
      select 1 from public.message_threads t
      where t.id = thread_id
        and t.user_id = auth.uid()
        and t.status = 'open'
    )
  );
-- No UPDATE/DELETE for anyone but the service role.

-- 3. Notifications: 'message' type + thread link -----------------------------
alter table public.notifications
  add column if not exists thread_id uuid
    references public.message_threads (id) on delete cascade;

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('like', 'comment', 'remix', 'follow', 'feedback', 'moderation', 'message'));

create index if not exists notifications_thread_idx
  on public.notifications (thread_id) where thread_id is not null;

-- 4. Post trigger: roll the thread forward + notify the other side ----------
create or replace function public.on_message_posted()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_thread public.message_threads%rowtype;
begin
  select * into v_thread from public.message_threads where id = new.thread_id;
  if not found then
    return new;
  end if;

  update public.message_threads
  set
    last_message_at = new.created_at,
    last_message_preview = left(regexp_replace(new.body, '\s+', ' ', 'g'), 140),
    last_sender_role = new.sender_role,
    user_unread_count = case when new.sender_role = 'admin'
      then user_unread_count + 1 else user_unread_count end,
    admin_unread_count = case when new.sender_role = 'user'
      then admin_unread_count + 1 else admin_unread_count end
  where id = new.thread_id;

  -- One UNREAD bell entry per thread per recipient: a burst of posts in the
  -- same thread updates the existing unread row rather than stacking five
  -- identical "sent you a message" items. Once read, the next post makes a
  -- fresh one.
  if new.sender_role = 'admin' then
    if not exists (
      select 1 from public.notifications n
      where n.recipient_id = v_thread.user_id
        and n.thread_id = new.thread_id
        and n.read_at is null
    ) then
      insert into public.notifications (recipient_id, actor_id, type, thread_id)
      values (v_thread.user_id, new.sender_id, 'message', new.thread_id);
    end if;
  else
    -- A user reply pings every admin (except the poster, if they are one).
    insert into public.notifications (recipient_id, actor_id, type, thread_id)
    select p.id, new.sender_id, 'message', new.thread_id
    from public.profiles p
    where p.is_admin
      and p.id <> new.sender_id
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = p.id
          and n.thread_id = new.thread_id
          and n.read_at is null
      );
  end if;
  return new;
end;
$$;
revoke all on function public.on_message_posted() from public, anon, authenticated;

drop trigger if exists messages_on_posted on public.messages;
create trigger messages_on_posted
  after insert on public.messages
  for each row execute function public.on_message_posted();

-- 5. The user's read marker (their only thread write) ------------------------
-- Zeroes the user's unread counter on THEIR thread and marks that thread's
-- bell entries read. Returns the number of threads touched (0 = not theirs).
create or replace function public.mark_message_thread_read(p_thread_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_touched integer;
begin
  if v_uid is null then
    return 0;
  end if;
  update public.message_threads
  set user_unread_count = 0, user_last_read_at = now()
  where id = p_thread_id and user_id = v_uid;
  get diagnostics v_touched = row_count;
  if v_touched > 0 then
    update public.notifications
    set read_at = coalesce(read_at, now())
    where recipient_id = v_uid and thread_id = p_thread_id and read_at is null;
  end if;
  return v_touched;
end;
$$;
revoke all on function public.mark_message_thread_read(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_message_thread_read(uuid) to authenticated;

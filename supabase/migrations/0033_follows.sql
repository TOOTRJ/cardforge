-- 0033_follows.sql — creator follows + a "follow" notification type.
--
-- A user can follow another creator; the /feed page then shows recent public
-- cards from everyone they follow. The social graph is public (needed for
-- follower/following counts), but each user only writes their own follow rows.

create table if not exists public.follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);

create index if not exists follows_following_idx on public.follows (following_id);
create index if not exists follows_follower_idx on public.follows (follower_id);

alter table public.follows enable row level security;

drop policy if exists "Follows are public" on public.follows;
drop policy if exists "Users create own follows" on public.follows;
drop policy if exists "Users delete own follows" on public.follows;

create policy "Follows are public"
  on public.follows for select using (true);
create policy "Users create own follows"
  on public.follows for insert with check (auth.uid() = follower_id);
create policy "Users delete own follows"
  on public.follows for delete using (auth.uid() = follower_id);

-- Extend the notifications type check to include 'follow' (drop the existing
-- check by whatever name Postgres gave it, then re-add).
do $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'public.notifications'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%type%';
  if c is not null then
    execute format('alter table public.notifications drop constraint %I', c);
  end if;
end $$;

alter table public.notifications
  add constraint notifications_type_check
  check (type in ('like', 'comment', 'remix', 'follow'));

-- Follow → notify the followed user.
create or replace function public.notify_on_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, type)
  values (new.following_id, new.follower_id, 'follow');
  return new;
end;
$$;
revoke all on function public.notify_on_follow() from public, anon, authenticated;

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify
  after insert on public.follows
  for each row execute function public.notify_on_follow();

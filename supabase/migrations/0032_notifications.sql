-- 0032_notifications.sql — in-app creator notifications.
--
-- A card owner is notified when someone (not themselves) likes or comments on
-- their card, or publishes a public remix of it. Rows are written by SECURITY
-- DEFINER triggers (so there's no client INSERT path); recipients can read and
-- mark-read their own rows via RLS.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  type text not null check (type in ('like', 'comment', 'remix')),
  card_id uuid references public.cards (id) on delete cascade,
  comment_id uuid references public.card_comments (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_id) where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "Users read own notifications" on public.notifications;
drop policy if exists "Users update own notifications" on public.notifications;

create policy "Users read own notifications"
  on public.notifications for select
  using (auth.uid() = recipient_id);

create policy "Users update own notifications"
  on public.notifications for update
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);
-- No INSERT/DELETE policy: only the triggers below write rows.

-- Like → notify the card's owner --------------------------------------------
create or replace function public.notify_on_card_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.cards where id = new.card_id;
  if v_owner is not null and v_owner <> new.user_id then
    insert into public.notifications (recipient_id, actor_id, type, card_id)
    values (v_owner, new.user_id, 'like', new.card_id);
  end if;
  return new;
end;
$$;
revoke all on function public.notify_on_card_like() from public, anon, authenticated;

drop trigger if exists card_likes_notify on public.card_likes;
create trigger card_likes_notify
  after insert on public.card_likes
  for each row execute function public.notify_on_card_like();

-- Comment → notify the card's owner -----------------------------------------
create or replace function public.notify_on_card_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.cards where id = new.card_id;
  if v_owner is not null and v_owner <> new.author_id then
    insert into public.notifications (recipient_id, actor_id, type, card_id, comment_id)
    values (v_owner, new.author_id, 'comment', new.card_id, new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.notify_on_card_comment() from public, anon, authenticated;

drop trigger if exists card_comments_notify on public.card_comments;
create trigger card_comments_notify
  after insert on public.card_comments
  for each row execute function public.notify_on_card_comment();

-- Remix → notify the parent card's owner when the remix becomes public -------
-- Fires on create-as-public and on the private→public publish transition, so a
-- remix saved as a draft first still notifies once it's published (no dupes).
create or replace function public.notify_on_card_remix()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_parent_owner uuid;
begin
  if new.parent_card_id is null or new.visibility <> 'public' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.visibility = 'public' then
    return new; -- already public before; not a new publish
  end if;
  select owner_id into v_parent_owner from public.cards where id = new.parent_card_id;
  if v_parent_owner is not null and v_parent_owner <> new.owner_id then
    insert into public.notifications (recipient_id, actor_id, type, card_id)
    values (v_parent_owner, new.owner_id, 'remix', new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.notify_on_card_remix() from public, anon, authenticated;

drop trigger if exists cards_remix_notify on public.cards;
create trigger cards_remix_notify
  after insert or update on public.cards
  for each row execute function public.notify_on_card_remix();

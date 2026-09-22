-- 0101_notification_dedupe.sql — toggling like/follow no longer spams the owner.
--
-- notify_on_card_like (0032) and notify_on_follow (0033) inserted a row on
-- EVERY insert into card_likes / follows, and nothing ran on delete. Someone
-- flipping a heart on and off produced an unbounded stream of identical
-- "liked your card" rows for the owner (the remix trigger already dedupes).
--
-- Two rules, both inside the SECURITY DEFINER triggers (users still have no
-- INSERT/DELETE on notifications — 0088):
--   1. On like/follow: skip when the same actor already notified the same
--      recipient about the same target in the last 24 h (read or unread).
--   2. On unlike/unfollow: remove that actor's UNREAD like/follow notification
--      for the target — the owner never sees a "liked" for a like that no
--      longer exists. Already-read rows stay as history.

-- Like ------------------------------------------------------------------------
create or replace function public.notify_on_card_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.cards where id = new.card_id;
  if v_owner is null or v_owner = new.user_id then
    return new;
  end if;
  if exists (
    select 1 from public.notifications n
    where n.recipient_id = v_owner
      and n.actor_id = new.user_id
      and n.type = 'like'
      and n.card_id = new.card_id
      and n.created_at > now() - interval '1 day'
  ) then
    return new;
  end if;
  insert into public.notifications (recipient_id, actor_id, type, card_id)
  values (v_owner, new.user_id, 'like', new.card_id);
  return new;
end;
$$;
revoke all on function public.notify_on_card_like() from public, anon, authenticated;

create or replace function public.retract_card_like_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.notifications n
  where n.actor_id = old.user_id
    and n.type = 'like'
    and n.card_id = old.card_id
    and n.read_at is null;
  return old;
end;
$$;
revoke all on function public.retract_card_like_notification() from public, anon, authenticated;

drop trigger if exists card_likes_retract_notify on public.card_likes;
create trigger card_likes_retract_notify
  after delete on public.card_likes
  for each row execute function public.retract_card_like_notification();

-- Follow ----------------------------------------------------------------------
create or replace function public.notify_on_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.notifications n
    where n.recipient_id = new.following_id
      and n.actor_id = new.follower_id
      and n.type = 'follow'
      and n.created_at > now() - interval '1 day'
  ) then
    return new;
  end if;
  insert into public.notifications (recipient_id, actor_id, type)
  values (new.following_id, new.follower_id, 'follow');
  return new;
end;
$$;
revoke all on function public.notify_on_follow() from public, anon, authenticated;

create or replace function public.retract_follow_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.notifications n
  where n.recipient_id = old.following_id
    and n.actor_id = old.follower_id
    and n.type = 'follow'
    and n.read_at is null;
  return old;
end;
$$;
revoke all on function public.retract_follow_notification() from public, anon, authenticated;

drop trigger if exists follows_retract_notify on public.follows;
create trigger follows_retract_notify
  after delete on public.follows
  for each row execute function public.retract_follow_notification();

-- The dedupe lookups above hit (recipient, actor, type, card_id, created_at).
create index if not exists notifications_dedupe_idx
  on public.notifications (recipient_id, actor_id, type, card_id, created_at desc);

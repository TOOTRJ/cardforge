-- 0172_challenge_winners.sql — a closed design challenge names its winners
-- (TODO NV12; owner 2026-11-05: 1st, 2nd and 3rd; the admin picks with the
-- entries' likes shown; the maker is notified; the card page says it won;
-- NOT listed on /challenges' past challenges — the challenge's own page and
-- the card's page only).
--
-- 1. challenge_winners — (challenge, place 1–3, card). One card per place
--    and a card in one place per challenge; both constraints DEFERRABLE so
--    set_challenge_winners can swap two cards' places in one statement list.
--    Deleting the challenge or the card removes the row.
--
-- 2. The guard (BEFORE insert / update): the challenge has CLOSED
--    (ends_at <= now()) and the card is one of its entries — public and
--    wearing the challenge's tag, the entry rule of 0040. A winner whose card
--    later stops being public stays in the table but is read by no one but an
--    admin (the select policy), so it comes back if the card does.
--
-- 3. RLS: anyone reads a row whose card is public (the challenge page and
--    the card page, both cookie-free); an admin reads every row and writes
--    them (viewer_is_admin(), 0080 — never profiles.is_admin, unreadable to
--    authenticated since 0074). Writes go through set_challenge_winners.
--
-- 4. The notification (AFTER the write; it can never fail it): the card's
--    owner gets ONE `challenge_winner` row per challenge and card — inserted
--    when the card is named (the realtime toast), its payload's place
--    rewritten when only the place moves (an UPDATE raises no toast), and
--    deleted when the card is un-named (a mistake is not left saying it won).
--    No actor: the line is about the card, not the admin who clicked.
--
-- 5. set_challenge_winners(challenge, first, second, third) — the admin
--    page's ONE write: the three places as wanted (null = empty), in one
--    transaction. A card that stays a winner keeps its row (its place
--    updated), so its maker is not toasted again.
--
-- Grants are explicit (0097): new projects grant nothing by default.

-- ===========================================================================
-- 1. The table
-- ===========================================================================

create table if not exists public.challenge_winners (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  place smallint not null check (place between 1 and 3),
  card_id uuid not null references public.cards (id) on delete cascade,
  named_at timestamptz not null default now(),
  named_by uuid references public.profiles (id) on delete set null,
  constraint challenge_winners_pkey primary key (challenge_id, place)
    deferrable initially immediate,
  constraint challenge_winners_card_once unique (challenge_id, card_id)
    deferrable initially immediate
);

create index if not exists challenge_winners_card_idx
  on public.challenge_winners (card_id);

-- ===========================================================================
-- 2. The guard
-- ===========================================================================

create or replace function public.challenge_winners_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge public.challenges%rowtype;
  v_card record;
begin
  select * into v_challenge from public.challenges where id = new.challenge_id;
  if not found then
    raise exception 'challenge_not_found' using errcode = 'P0002';
  end if;
  if v_challenge.ends_at > now() then
    raise exception 'challenge_not_closed' using errcode = 'P0001';
  end if;
  select c.visibility, c.tags into v_card from public.cards c where c.id = new.card_id;
  if not found or v_card.visibility <> 'public'
     or not coalesce(v_challenge.tag = any (v_card.tags), false) then
    raise exception 'not_a_challenge_entry' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' or new.card_id is distinct from old.card_id then
    new.named_at := now();
    new.named_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function public.challenge_winners_guard() from public, anon, authenticated;

drop trigger if exists challenge_winners_guard on public.challenge_winners;
create trigger challenge_winners_guard
  before insert or update on public.challenge_winners
  for each row execute function public.challenge_winners_guard();

-- ===========================================================================
-- 3. RLS + grants
-- ===========================================================================

alter table public.challenge_winners enable row level security;

drop policy if exists "Winners of public cards are readable by everyone" on public.challenge_winners;
create policy "Winners of public cards are readable by everyone"
  on public.challenge_winners
  for select
  using (
    public.viewer_is_admin()
    or exists (
      select 1 from public.cards c
      where c.id = challenge_winners.card_id and c.visibility = 'public'
    )
  );

drop policy if exists "Admins can insert challenge winners" on public.challenge_winners;
create policy "Admins can insert challenge winners"
  on public.challenge_winners
  for insert
  with check (public.viewer_is_admin());

drop policy if exists "Admins can update challenge winners" on public.challenge_winners;
create policy "Admins can update challenge winners"
  on public.challenge_winners
  for update
  using (public.viewer_is_admin())
  with check (public.viewer_is_admin());

drop policy if exists "Admins can delete challenge winners" on public.challenge_winners;
create policy "Admins can delete challenge winners"
  on public.challenge_winners
  for delete
  using (public.viewer_is_admin());

revoke all on table public.challenge_winners from public, anon, authenticated;
grant select on table public.challenge_winners to anon, authenticated;
grant insert, update, delete on table public.challenge_winners to authenticated;
grant select, insert, update, delete on table public.challenge_winners to service_role;

-- ===========================================================================
-- 4. The notification
-- ===========================================================================

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'like', 'comment', 'remix', 'follow', 'feedback', 'moderation', 'message',
      'credit_grant', 'comp_plan', 'card_limit', 'render_update', 'site_update',
      'deck_generated', 'trial_ending', 'payment_received', 'checkout_reminder',
      'trial_lapsed', 'render_sweep_paused', 'credit_refill_failed',
      'deck_like', 'deck_card_added', 'moderation_unhidden', 'comp_ending',
      'deck_cloned', 'challenge_winner'
    )
  );

create unique index if not exists notifications_challenge_winner_once_idx
  on public.notifications (card_id, (payload ->> 'challengeId'))
  where type = 'challenge_winner';

create or replace function public.challenge_winners_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_challenge record;
begin
  begin
    -- The card that is no longer a winner here (un-named, or replaced in
    -- its row): its line goes.
    if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.card_id is distinct from old.card_id) then
      delete from public.notifications
      where type = 'challenge_winner'
        and card_id = old.card_id
        and payload ->> 'challengeId' = old.challenge_id::text;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;

    select c.slug, c.title into v_challenge from public.challenges c where c.id = new.challenge_id;
    if tg_op = 'UPDATE' and new.card_id = old.card_id then
      -- Only the place moved: the line says the new place, no new toast.
      update public.notifications
      set payload = payload || jsonb_build_object('place', new.place)
      where type = 'challenge_winner'
        and card_id = new.card_id
        and payload ->> 'challengeId' = new.challenge_id::text;
      return new;
    end if;

    select owner_id into v_owner from public.cards where id = new.card_id;
    if v_owner is null then
      return new;
    end if;
    insert into public.notifications (recipient_id, actor_id, type, card_id, payload)
    values (
      v_owner, null, 'challenge_winner', new.card_id,
      jsonb_build_object(
        'challengeId', new.challenge_id,
        'slug', v_challenge.slug,
        'title', v_challenge.title,
        'place', new.place
      )
    )
    on conflict (card_id, (payload ->> 'challengeId')) where type = 'challenge_winner'
    do update set payload = excluded.payload;
  exception when others then
    raise warning 'challenge_winners notification: % (%)', sqlerrm, sqlstate;
  end;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.challenge_winners_notify() from public, anon, authenticated;

drop trigger if exists challenge_winners_notify on public.challenge_winners;
create trigger challenge_winners_notify
  after insert or update or delete on public.challenge_winners
  for each row execute function public.challenge_winners_notify();

-- ===========================================================================
-- 5. set_challenge_winners
-- ===========================================================================

create or replace function public.set_challenge_winners(
  p_challenge_id uuid,
  p_first uuid,
  p_second uuid,
  p_third uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_wanted uuid[] := array[p_first, p_second, p_third];
  v_place smallint;
  v_card uuid;
begin
  if not public.viewer_is_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if (select count(*) from unnest(v_wanted) w where w is not null)
     <> (select count(distinct w) from unnest(v_wanted) w where w is not null) then
    raise exception 'duplicate_winner' using errcode = 'P0001';
  end if;

  set constraints public.challenge_winners_pkey, public.challenge_winners_card_once deferred;

  -- Cards no longer wanted in any place.
  delete from public.challenge_winners w
  where w.challenge_id = p_challenge_id
    and not (w.card_id = any (array_remove(v_wanted, null)));

  for v_place in 1..3 loop
    v_card := v_wanted[v_place];
    if v_card is null then
      continue;
    end if;
    if exists (
      select 1 from public.challenge_winners w
      where w.challenge_id = p_challenge_id and w.card_id = v_card
    ) then
      -- A winner already: only its place may move.
      update public.challenge_winners w
      set place = v_place
      where w.challenge_id = p_challenge_id and w.card_id = v_card and w.place <> v_place;
    else
      insert into public.challenge_winners (challenge_id, place, card_id)
      values (p_challenge_id, v_place, v_card);
    end if;
  end loop;

  -- An emptied place that still holds a kept card's OLD row is gone by now
  -- (the update moved it); one that held a dropped card went with the delete.
  set constraints public.challenge_winners_pkey, public.challenge_winners_card_once immediate;
end;
$$;

revoke all on function public.set_challenge_winners(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.set_challenge_winners(uuid, uuid, uuid, uuid) to authenticated, service_role;

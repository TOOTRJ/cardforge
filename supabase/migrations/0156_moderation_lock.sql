-- 0156 — the moderation lock: a card hidden by moderation stays PRIVATE
-- until an admin unhides it (owner approval 2026-10-30).
--
-- Until now the moderation hide (lib/moderation/hide-card.ts — the admin's
-- "Hide card" on a report, and the flagged-file rescan) only set
-- visibility = 'private' and cleared the render pointers. Nothing recorded
-- that MODERATION did it (a rescan hide may have no report at all), so the
-- owner could publish the card again through any go-public path: the edit
-- (updateCardAction), My Cards' bulk change (updateCardsVisibilityAction),
-- the deck's "Make public" offers.
--
-- 1. cards.moderation_hidden_at (timestamptz, NULL = not locked) and
--    cards.moderation_hidden_reason (a short CODE — 'report', 'flagged_file'
--    or 'backfill' — never report text; the app never shows it raw).
--
-- 2. cards_moderation_lock_private (CHECK, the 0121 frame-preview pattern):
--    a locked card is private, for EVERY role — the owner through RLS, the
--    service role, a definer function. A go-public write on a locked card
--    fails with check_violation (23514) naming the constraint; the app reads
--    the lock first and answers with a typed reason instead
--    (lib/moderation/lock.ts). Every other column stays editable.
--
-- 3. cards_guard_moderation_lock (trigger, the 0126 render-guard pattern):
--    an API role (anon / authenticated) may never set or clear either
--    column — an INSERT naming one, or an UPDATE changing one, is refused
--    with insufficient_privilege. The hide writes them with the service
--    role; the unhide through admin_unhide_card (definer, below).
--    SECURITY INVOKER on purpose: current_user is the caller's role.
--
-- 4. admin_unhide_card(card): SECURITY DEFINER, gated on viewer_is_admin()
--    (anyone else: insufficient_privilege). Clears the lock — it does NOT
--    republish: the card stays private and its owner decides — and, in the
--    same transaction, sends the owner a 'moderation_unhidden' notification
--    (copy: lib/notifications/describe.ts). Returns the owner's id, or NULL
--    when the card is missing or was not locked (nothing written).
--
-- 5. set_cards_updated_at (0108 / 0134) ignores the two columns: a lock or
--    an unhide is not an edit of the card (the hide's own visibility change
--    still is, as before).
--
-- 6. Backfill: a card that is private today AND has an 'actioned' report
--    (the only trace a hide left before this migration) is locked, stamped
--    with its latest actioned report's resolved_at, reason 'backfill'. A
--    rescan hide with no report cannot be told from an owner's own private
--    card and is not locked. Idempotent: only rows not yet locked.
--
-- Grants: admin_unhide_card is authenticated's and the service role's;
-- PUBLIC and anon have no EXECUTE (prod's old project auto-grants, a new
-- project grants nothing — the revoke makes them agree). The trigger
-- function fires for every role regardless of EXECUTE; no API role may call
-- it (revoked). The two columns ride 0097's table-level privileges on
-- public.cards (the trigger is their gate) and need no grant of their own.
--
-- Ships through a PR; never applied ad-hoc.

-- 1. The columns -------------------------------------------------------------

alter table public.cards
  add column if not exists moderation_hidden_at timestamptz,
  add column if not exists moderation_hidden_reason text;

comment on column public.cards.moderation_hidden_at is
  'When moderation hid the card (lib/moderation/hide-card.ts). NULL = not locked. While set the card is private (cards_moderation_lock_private); only admin_unhide_card clears it (cards_guard_moderation_lock).';
comment on column public.cards.moderation_hidden_reason is
  'A short code for why moderation hid the card: report, flagged_file or backfill. Never report text; never shown raw.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cards_moderation_hidden_reason_code'
      and conrelid = 'public.cards'::regclass
  ) then
    alter table public.cards
      add constraint cards_moderation_hidden_reason_code
      check (
        moderation_hidden_reason is null
        or (moderation_hidden_at is not null
            and moderation_hidden_reason in ('report', 'flagged_file', 'backfill'))
      );
  end if;
end;
$$;

-- 5 (first, so the backfill below doesn't bump updated_at). ------------------

create or replace function public.set_cards_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new)
        - 'view_count' - 'likes_count' - 'share_count' - 'updated_at' - 'color_count'
        - 'rendered_image_url' - 'rendered_thumb_url' - 'rendered_back_image_url' - 'rendered_back_thumb_url' - 'rendered_at' - 'layout_version'
        - 'moderation_hidden_at' - 'moderation_hidden_reason')
     is distinct from
     (to_jsonb(old)
        - 'view_count' - 'likes_count' - 'share_count' - 'updated_at' - 'color_count'
        - 'rendered_image_url' - 'rendered_thumb_url' - 'rendered_back_image_url' - 'rendered_back_thumb_url' - 'rendered_at' - 'layout_version'
        - 'moderation_hidden_at' - 'moderation_hidden_reason') then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end;
$$;

-- 6. Backfill (before the CHECK; every row it locks is private) ---------------

update public.cards as c
set moderation_hidden_at = coalesce(
      (select max(r.resolved_at) from public.card_reports r
       where r.card_id = c.id and r.status = 'actioned'),
      now()),
    moderation_hidden_reason = 'backfill'
where c.visibility = 'private'
  and c.moderation_hidden_at is null
  and exists (
    select 1 from public.card_reports r
    where r.card_id = c.id and r.status = 'actioned'
  );

-- 2. A locked card is private ------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cards_moderation_lock_private'
      and conrelid = 'public.cards'::regclass
  ) then
    alter table public.cards
      add constraint cards_moderation_lock_private
      check (moderation_hidden_at is null or visibility = 'private');
  end if;
end;
$$;

-- The admin's list of locked cards reads only the locked rows.
create index if not exists cards_moderation_hidden_idx
  on public.cards (moderation_hidden_at desc)
  where moderation_hidden_at is not null;

-- 3. Only the server sets or clears the lock ---------------------------------

create or replace function public.guard_card_moderation_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.moderation_hidden_at is not null or new.moderation_hidden_reason is not null then
      raise exception 'moderation_lock_server_only: only moderation hides a card'
        using errcode = 'insufficient_privilege';
    end if;
  elsif new.moderation_hidden_at is distinct from old.moderation_hidden_at
     or new.moderation_hidden_reason is distinct from old.moderation_hidden_reason then
    raise exception 'moderation_lock_server_only: only an admin unhides a card'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists cards_guard_moderation_lock on public.cards;
create trigger cards_guard_moderation_lock
  before insert or update of moderation_hidden_at, moderation_hidden_reason
  on public.cards
  for each row execute function public.guard_card_moderation_lock();

revoke all on function public.guard_card_moderation_lock() from public, anon, authenticated;

-- The notification kind ------------------------------------------------------

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
      'deck_like', 'deck_card_added', 'moderation_unhidden'
    )
  );

-- 4. The admin's unhide ------------------------------------------------------

create or replace function public.admin_unhide_card(p_card_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if not public.viewer_is_admin() then
    raise exception 'not_admin: only an admin unhides a card'
      using errcode = 'insufficient_privilege';
  end if;

  update public.cards
  set moderation_hidden_at = null,
      moderation_hidden_reason = null
  where id = p_card_id
    and moderation_hidden_at is not null
  returning owner_id into v_owner;

  if v_owner is null then
    return null;
  end if;

  insert into public.notifications (recipient_id, actor_id, type, card_id, payload)
  values (v_owner, auth.uid(), 'moderation_unhidden', p_card_id, '{}'::jsonb);

  return v_owner;
end;
$$;

revoke all on function public.admin_unhide_card(uuid) from public, anon;
grant execute on function public.admin_unhide_card(uuid) to authenticated, service_role;

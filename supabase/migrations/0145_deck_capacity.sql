-- 0145_deck_capacity.sql — private and unlisted decks, capped per plan, in
-- the database (2026-10-28 deck plan: TODO DK3.1, DK3.4, DK3.6).
--
-- Owner decision D1 (2026-10-28): Free keeps 1 private or unlisted deck,
-- Plus 3, Pro unlimited; PUBLIC decks are unlimited on every plan (empty
-- ones stay out of the public lists since 0143). The design is 0104's for
-- saved cards, on decks:
--
--   deck_capacity_for(uuid)   the cap (-1 = unlimited). It MIRRORS
--                             lib/billing/plans.ts DECK_CAPACITY and resolves
--                             the tier exactly as card_capacity_for (0104):
--                             admins unlimited; a paid tier counts only while
--                             its subscription is active/trialing; an
--                             unexpired admin comp takes the HIGHER of comp
--                             and subscription. card_limit_override is a CARD
--                             override and is not read. tests/unit/billing/
--                             deck-capacity.test.ts holds the numbers and the
--                             tier rule to plans.ts and to 0104.
--   decks_enforce_capacity    BEFORE INSERT, and BEFORE UPDATE OF visibility /
--                             owner_id. It checks only a write that ADDS a
--                             deck to the owner's private + unlisted decks:
--                               * an insert of a private or unlisted deck;
--                               * an update from public to private / unlisted;
--                               * a private / unlisted deck moved to another
--                                 owner (a trusted path only — the decks
--                                 UPDATE policy pins owner_id to auth.uid()).
--                             The owner's other private + unlisted decks are
--                             counted under a per-owner advisory lock, so two
--                             writes at the cap can't both read "one below";
--                             at the cap it raises `deck_capacity_exceeded`,
--                             which lib/decks/actions.ts maps to the upgrade
--                             prompt (reason "deck_capacity").
--
-- Grandfathering (DK3.4): nothing else is checked. A deck over the cap — a
-- lapsed plan, a downgrade, decks made before this migration — keeps its
-- visibility, its title, its cards; private ↔ unlisted, a re-save of the same
-- value and every content edit pass. Only a NEW private / unlisted deck (or a
-- public one turned private) is refused, and nothing is ever deleted or
-- locked.
--
-- The deck itself is never counted (`id <> new.id`). An insert always has a
-- fresh id, so this changes nothing there — except for an idempotent seed:
-- a BEFORE INSERT trigger fires before ON CONFLICT is resolved, so re-running
-- `insert … on conflict (id) do nothing` for a deck that already exists would
-- count that very deck and refuse a no-op. On an update the row is still
-- public in the table, so it is never counted either way.
--
-- Like 0104 the trigger ignores the billing flag (NEXT_PUBLIC_BILLING_ENABLED
-- is an app setting the database cannot see) and fires for every role: the
-- app's pre-check (getDeckCapacity) reads the plan, the database holds the
-- line. The seeded free account starts with no private deck
-- (supabase/seeds/10_dev_data.sql), so it can make its first one on a
-- branch or the dev database.
--
-- Grants (every migration states them — new projects don't auto-grant): the
-- trigger fires for every role regardless; only tooling needs to CALL the
-- helper, and end users must not read other users' caps. Same as 0104.
--
-- Backward compatible: the code before this PR inserts and updates decks as
-- before below the cap; at the cap it would show the raw database message,
-- which is why it ships with the code that maps it. Ships through a PR; never
-- applied ad-hoc. Idempotent.

create or replace function public.deck_capacity_for(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select
      is_admin,
      case
        when subscription_tier in ('plus', 'pro')
         and subscription_status in ('active', 'trialing') then subscription_tier
        else 'free'
      end as subscribed,
      case
        when comp_tier in ('plus', 'pro')
         and (comp_expires_at is null or comp_expires_at > now()) then comp_tier
        else null
      end as comp
    from public.profiles
    where id = p_user_id
  ),
  ranked as (
    select
      is_admin,
      case
        when comp is not null
         and (case comp when 'pro' then 2 when 'plus' then 1 else 0 end)
           > (case subscribed when 'pro' then 2 when 'plus' then 1 else 0 end)
        then comp
        else subscribed
      end as tier
    from p
  )
  select case
    when is_admin then -1
    when tier = 'pro' then -1
    when tier = 'plus' then 3
    else 1
  end
  from ranked;
$$;

comment on function public.deck_capacity_for(uuid) is
  'Private + unlisted deck cap for a user (-1 = unlimited; public decks are never capped). Mirrors lib/billing/plans.ts DECK_CAPACITY and card_capacity_for''s tier rule; keep in sync.';

create or replace function public.enforce_deck_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap integer;
  v_count integer;
begin
  -- Public decks are unlimited (D1): never counted, never checked.
  if new.visibility not in ('private', 'unlisted') then
    return new;
  end if;

  -- An update that leaves the deck where it was — already private or
  -- unlisted under the same owner — adds nothing: a deck over the cap stays
  -- editable (grandfathered).
  if tg_op = 'UPDATE'
     and old.visibility in ('private', 'unlisted')
     and new.owner_id is not distinct from old.owner_id then
    return new;
  end if;

  -- A missing profile row (should not happen — the signup trigger creates it)
  -- gets the free cap rather than a free pass.
  v_cap := coalesce(public.deck_capacity_for(new.owner_id), 1);
  if v_cap = -1 then
    return new;
  end if;

  -- Serialise this owner's capped writes for the rest of the transaction so
  -- two concurrent creates at the cap can't both read "one below" and both
  -- commit (the count below runs with a fresh snapshot, after the lock).
  perform pg_advisory_xact_lock(hashtextextended('deck_capacity:' || new.owner_id::text, 0));

  select count(*) into v_count
  from public.decks d
  where d.owner_id = new.owner_id
    and d.visibility in ('private', 'unlisted')
    and d.id <> new.id;
  if v_count >= v_cap then
    raise exception 'deck_capacity_exceeded: % of % private or unlisted decks', v_count, v_cap
      using errcode = 'check_violation',
            hint = 'Make a deck public, delete one, or upgrade the plan for more private decks.';
  end if;
  return new;
end;
$$;

drop trigger if exists decks_enforce_capacity on public.decks;
create trigger decks_enforce_capacity
  before insert or update of visibility, owner_id on public.decks
  for each row execute function public.enforce_deck_capacity();

revoke all on function public.deck_capacity_for(uuid) from public, anon, authenticated;
grant execute on function public.deck_capacity_for(uuid) to service_role;
revoke all on function public.enforce_deck_capacity() from public, anon, authenticated;

-- ===========================================================================
-- 0104 — saved-card capacity, enforced in the database
--
-- The app gated capacity with a count-then-insert in createCardAction, so two
-- saves racing at the cap could both land. This trigger is the backstop: a
-- card insert beyond the owner's cap raises `card_capacity_exceeded`, which
-- lib/cards/actions.ts maps to the same "limit reached" upgrade prompt.
--
-- The cap MIRRORS lib/billing/entitlements.ts + lib/billing/plans.ts
-- (CARD_CAPACITY): free 50, plus 500, pro unlimited (-1); admins unlimited; a
-- paid tier counts only while its subscription is active/trialing; an
-- unexpired admin comp takes the HIGHER of comp and subscription; an admin
-- card_limit_override can only ADD headroom. tests/unit/billing/
-- card-capacity.test.ts keeps the numbers in sync.
-- ===========================================================================

create or replace function public.card_capacity_for(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select
      is_admin,
      card_limit_override,
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
      card_limit_override,
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
    when tier = 'plus' then greatest(500, coalesce(card_limit_override, 0))
    else greatest(50, coalesce(card_limit_override, 0))
  end
  from ranked;
$$;

comment on function public.card_capacity_for(uuid) is
  'Saved-card cap for a user (-1 = unlimited). Mirrors lib/billing/entitlements.ts; keep in sync.';

create or replace function public.enforce_card_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap integer;
  v_count integer;
begin
  -- A missing profile row (should not happen — the signup trigger creates it)
  -- gets the free cap rather than a free pass.
  v_cap := coalesce(public.card_capacity_for(new.owner_id), 50);
  if v_cap = -1 then
    return new;
  end if;

  -- Serialise this owner's inserts for the rest of the transaction so two
  -- concurrent saves at the cap can't both read "one below" and both commit.
  perform pg_advisory_xact_lock(hashtext('card_capacity:' || new.owner_id::text));

  select count(*) into v_count from public.cards where owner_id = new.owner_id;
  if v_count >= v_cap then
    raise exception 'card_capacity_exceeded: % of % saved cards', v_count, v_cap
      using errcode = 'check_violation',
            hint = 'Delete a card or upgrade the plan for more space.';
  end if;
  return new;
end;
$$;

drop trigger if exists cards_enforce_capacity on public.cards;
create trigger cards_enforce_capacity
  before insert on public.cards
  for each row execute function public.enforce_card_capacity();

-- Grants (every migration states them — new projects don't auto-grant). The
-- trigger fires for every role's inserts regardless; only tooling needs to
-- CALL the helper, and end users must not read other users' caps.
revoke all on function public.card_capacity_for(uuid) from public, anon, authenticated;
grant execute on function public.card_capacity_for(uuid) to service_role;
revoke all on function public.enforce_card_capacity() from public, anon, authenticated;

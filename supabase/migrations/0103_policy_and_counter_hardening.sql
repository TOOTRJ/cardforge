-- 0103_policy_and_counter_hardening.sql — four small hardenings from the
-- 2026-09-14 audit.
--
-- 1. card_set_items UPDATE: the INSERT policy (0009) requires the set AND the
--    card to belong to the caller; UPDATE only checked the set, so a set owner
--    could re-point an item at anyone's card. Mirror the INSERT rule.
-- 2. Profile URL columns: the app's zod schemas are https-gated, but nothing
--    stopped a direct PostgREST write from storing `javascript:` / `http:`
--    links that every profile page then renders as anchors. Mirror the rule
--    as CHECK constraints (production has zero violating rows).
-- 3. increment_card_view / increment_deck_view: SECURITY DEFINER, callable by
--    anon, and they counted views of ANY row — including private ones a
--    visitor cannot see. Count only what is publicly viewable. (They stay
--    definer + anon-callable: anonymous views are real views; this closes
--    the "inflate a private draft" and "probe ids" angles, not rate.)
-- 4. Deck-entry writes touch decks.updated_at, so "recent" ordering follows
--    card-list edits. 0057's guard reverts an updated_at-only UPDATE (it
--    treats it as a counter bump), so the guard now honours an EXPLICIT
--    touch and only reverts when nothing was set.

-- 1 ---------------------------------------------------------------------------
drop policy if exists "Card set items: owners can update" on public.card_set_items;
create policy "Card set items: owners can update"
  on public.card_set_items
  for update
  using (
    exists (
      select 1 from public.card_sets s
      where s.id = set_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.card_sets s
      where s.id = set_id and s.owner_id = auth.uid()
    )
    and exists (
      select 1 from public.cards c
      where c.id = card_id and c.owner_id = auth.uid()
    )
  );

-- 2 ---------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_urls_https;
alter table public.profiles
  add constraint profiles_urls_https check (
    (website_url   is null or website_url   ~ '^https://')
    and (twitter_url   is null or twitter_url   ~ '^https://')
    and (bluesky_url   is null or bluesky_url   ~ '^https://')
    and (instagram_url is null or instagram_url ~ '^https://')
    and (youtube_url   is null or youtube_url   ~ '^https://')
    and (tiktok_url    is null or tiktok_url    ~ '^https://')
    and (discord_url   is null or discord_url   ~ '^https://')
    and (github_url    is null or github_url    ~ '^https://')
  );

-- 3 ---------------------------------------------------------------------------
create or replace function public.increment_card_view(p_card_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.cards
  set view_count = view_count + 1
  where id = p_card_id
    and visibility in ('public', 'unlisted');
$$;

create or replace function public.increment_deck_view(p_deck_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.decks
  set view_count = view_count + 1
  where id = p_deck_id
    and visibility in ('public', 'unlisted');
$$;

-- 4 ---------------------------------------------------------------------------
create or replace function public.set_decks_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'view_count' - 'likes_count' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'view_count' - 'likes_count' - 'updated_at') then
    new.updated_at = now();
  elsif new.updated_at is distinct from old.updated_at then
    -- An explicit touch (the deck_cards trigger below) — keep it.
    null;
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end;
$$;

create or replace function public.touch_deck_from_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.decks
  set updated_at = now()
  where id = coalesce(new.deck_id, old.deck_id);
  return coalesce(new, old);
end;
$$;
revoke all on function public.touch_deck_from_entry() from public, anon, authenticated;

drop trigger if exists deck_cards_touch_deck on public.deck_cards;
create trigger deck_cards_touch_deck
  after insert or update or delete on public.deck_cards
  for each row execute function public.touch_deck_from_entry();

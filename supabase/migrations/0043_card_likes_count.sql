-- 0043_card_likes_count.sql — materialize per-card like tallies.
--
-- Until now every gallery/detail render aggregated the entire card_likes table
-- in-process (attachStats) or ran full-scan COUNTs (countCardLikes, the rank
-- RPCs from 0042). That's O(all likes) per page and doesn't scale.
--
-- This adds cards.likes_count, kept in exact sync by AFTER INSERT/DELETE
-- triggers on card_likes, backfills it, and rewrites the like-rank RPCs to read
-- the column (index-friendly, no aggregation). The triggers are SECURITY
-- DEFINER so a liker (who isn't the card owner) can still bump the counter past
-- the cards UPDATE RLS policy.
--
-- Apply via `supabase db push` or the Supabase MCP.

-- 1. Column -----------------------------------------------------------------
alter table public.cards
  add column if not exists likes_count integer not null default 0;

comment on column public.cards.likes_count is
  'Materialized like tally, kept in sync by the card_likes AFTER INSERT/DELETE triggers (see 0043).';

-- 2. Sync trigger -----------------------------------------------------------
create or replace function public.sync_card_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.cards
      set likes_count = likes_count + 1
      where id = new.card_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.cards
      set likes_count = greatest(likes_count - 1, 0)
      where id = old.card_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists card_likes_count_insert on public.card_likes;
create trigger card_likes_count_insert
  after insert on public.card_likes
  for each row execute function public.sync_card_likes_count();

drop trigger if exists card_likes_count_delete on public.card_likes;
create trigger card_likes_count_delete
  after delete on public.card_likes
  for each row execute function public.sync_card_likes_count();

-- 3. Backfill ---------------------------------------------------------------
update public.cards c
  set likes_count = coalesce(sub.cnt, 0)
from (
  select card_id, count(*)::integer as cnt
  from public.card_likes
  group by card_id
) sub
where sub.card_id = c.id;

-- Optional: index to speed up "most liked" ordering + rank scans.
create index if not exists cards_likes_count_idx
  on public.cards (likes_count desc);

-- 4. Rewrite rank RPCs to read the materialized column ----------------------
create or replace function public.card_like_rank(p_card_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    1 + (
      select count(*) from public.cards
      where visibility in ('public', 'unlisted')
        and likes_count > (
          select likes_count from public.cards where id = p_card_id
        )
    )
  )::integer
  where exists (
    select 1 from public.cards
    where id = p_card_id and visibility in ('public', 'unlisted')
  );
$$;

create or replace function public.card_like_rank_in_set(p_card_id uuid, p_set_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    1 + (
      select count(*)
      from public.card_set_items si
      join public.cards c on c.id = si.card_id
      where si.set_id = p_set_id
        and c.likes_count > (
          select likes_count from public.cards where id = p_card_id
        )
    )
  )::integer
  where exists (
    select 1 from public.card_set_items
    where set_id = p_set_id and card_id = p_card_id
  );
$$;

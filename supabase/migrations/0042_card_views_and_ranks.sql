-- 0042_card_views_and_ranks.sql — card view counter + like-rank helpers for the
-- detail page's analytics panel ("By the numbers").
--
--   * cards.view_count: a lifetime view tally, bumped once per non-owner detail
--     view via increment_card_view (SECURITY DEFINER so anon viewers can bump
--     a counter without a broad UPDATE grant on cards).
--   * card_like_rank / card_like_rank_in_set: 1-based popularity rank by total
--     likes, overall (shareable cards) and within a given set. Full-scan
--     aggregates — fine at the current catalog size; revisit if it grows large.
--
-- Apply via `supabase db push` or the Supabase MCP.

-- 1. View counter -----------------------------------------------------------
alter table public.cards
  add column if not exists view_count integer not null default 0;

comment on column public.cards.view_count is
  'Lifetime detail-page view tally, bumped by increment_card_view (excludes owner views, best-effort).';

create or replace function public.increment_card_view(p_card_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.cards set view_count = view_count + 1 where id = p_card_id;
$$;

-- 2. Like rank — overall (across shareable cards) ---------------------------
create or replace function public.card_like_rank(p_card_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with counts as (
    select c.id, count(l.card_id) as likes
    from public.cards c
    left join public.card_likes l on l.card_id = c.id
    where c.visibility in ('public', 'unlisted')
    group by c.id
  )
  select (
    1 + (
      select count(*) from counts
      where likes > coalesce((select likes from counts where id = p_card_id), -1)
    )
  )::integer
  where exists (select 1 from counts where id = p_card_id);
$$;

-- 3. Like rank — within a single set ----------------------------------------
create or replace function public.card_like_rank_in_set(p_card_id uuid, p_set_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with members as (
    select c.id, count(l.card_id) as likes
    from public.card_set_items si
    join public.cards c on c.id = si.card_id
    left join public.card_likes l on l.card_id = c.id
    where si.set_id = p_set_id
    group by c.id
  )
  select (
    1 + (
      select count(*) from members
      where likes > coalesce((select likes from members where id = p_card_id), -1)
    )
  )::integer
  where exists (select 1 from members where id = p_card_id);
$$;

grant execute on function public.increment_card_view(uuid) to anon, authenticated;
grant execute on function public.card_like_rank(uuid) to anon, authenticated;
grant execute on function public.card_like_rank_in_set(uuid, uuid) to anon, authenticated;

-- ===========================================================================
-- 0105 — drop the sets feature's schema
--
-- The app side of sets was removed in PR #337 (2026-09-22). Production held
-- 8 sets from 5 owners (25 memberships, 3 likes, 2 finished set jobs); the
-- owner confirmed dropping them on 2026-09-22. Every card keeps its printed
-- set symbol (set_icon_url / set_icon_code) — only the collection rows go.
-- The `set-covers` storage bucket and its policies STAY: deck covers and card
-- set icons live there (historical bucket name).
-- ===========================================================================

-- 1. Functions that read the set tables.
drop function if exists public.card_like_rank_in_set(uuid, uuid);

-- admin_user_stats loses its `sets` column. A return-type change needs
-- drop + create; the grants are restated below (service_role only, as 0071).
drop function if exists public.admin_user_stats(uuid);
create function public.admin_user_stats(p_user_id uuid)
returns table (
  cards_total bigint,
  cards_public bigint,
  cards_unlisted bigint,
  cards_private bigint,
  decks bigint,
  likes_received bigint,
  credits_spent_month bigint,
  feedback_count bigint,
  thread_count bigint,
  unread_from_user bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.cards c where c.owner_id = p_user_id),
    (select count(*) from public.cards c where c.owner_id = p_user_id and c.visibility = 'public'),
    (select count(*) from public.cards c where c.owner_id = p_user_id and c.visibility = 'unlisted'),
    (select count(*) from public.cards c where c.owner_id = p_user_id and c.visibility = 'private'),
    (select count(*) from public.decks d where d.owner_id = p_user_id),
    (select count(*) from public.card_likes l
       join public.cards c on c.id = l.card_id
       where c.owner_id = p_user_id),
    (select coalesce(sum(-l.delta), 0)::bigint from public.credit_ledger l
       where l.user_id = p_user_id and l.delta < 0
         and l.created_at >= date_trunc('month', now() at time zone 'utc')),
    (select count(*) from public.feedback f where f.user_id = p_user_id),
    (select count(*) from public.message_threads t where t.user_id = p_user_id),
    (select coalesce(sum(t.admin_unread_count), 0)::bigint from public.message_threads t
       where t.user_id = p_user_id);
$$;

revoke all on function public.admin_user_stats(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_stats(uuid) to service_role;

-- 2. The set-kind AI jobs (both finished) and the column that linked a job to
--    its set; the kind CHECK no longer admits 'set'.
delete from public.ai_generation_jobs where kind = 'set';
alter table public.ai_generation_jobs drop column if exists set_id;
alter table public.ai_generation_jobs
  drop constraint if exists ai_generation_jobs_kind_check;
alter table public.ai_generation_jobs
  add constraint ai_generation_jobs_kind_check
  check (kind in ('deck', 'deck_remix', 'card', 'card_remix', 'card_fill'));

-- 3. cards.primary_set_id and its partial index (0025). The symbol columns
--    set_icon_url / set_icon_code stay — the Set icon step writes them.
drop index if exists public.cards_primary_set_id_idx;
alter table public.cards drop column if exists primary_set_id;

-- 4. The tables (their policies, indexes, triggers and grants go with them),
--    then the trigger function 0009 created for card_sets.updated_at.
drop table if exists public.set_likes;
drop table if exists public.card_set_items;
drop table if exists public.card_sets;
drop function if exists public.set_card_sets_updated_at();

-- 0071_admin_user_directory.sql — the /admin/users directory.
--
-- Two SECURITY DEFINER aggregates for the admin users page, replacing the
-- search-only page's per-user count queries:
--
--   * admin_list_users: one paginated, filterable, sortable page of users
--     with the counts the list shows (cards, decks, last activity) and the
--     account email. Email lives in auth.users, which PostgREST can't read —
--     a definer function owned by postgres can, and the previous "scan the
--     first 200 auth users for an exact match" email search goes away.
--   * admin_user_stats: the per-user detail numbers (cards by visibility,
--     decks, sets, likes received, credits spent this month, feedback,
--     message threads) in ONE round trip instead of eight.
--
-- Posture matches 0047's admin aggregates: EXECUTE is granted to
-- service_role only, and app code gates on profiles.is_admin before calling
-- through the service-role client. Neither anon nor authenticated sessions
-- can call these at all.

create or replace function public.admin_list_users(
  p_q text default null,
  p_tier text default null,
  p_status text default null,
  p_flag text default null,
  p_sort text default 'newest',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  email text,
  subscription_tier text,
  subscription_status text,
  comp_tier text,
  comp_expires_at timestamptz,
  credits integer,
  is_admin boolean,
  card_count bigint,
  deck_count bigint,
  created_at timestamptz,
  last_active_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      p.id,
      p.username,
      p.display_name,
      p.avatar_url,
      u.email::text as email,
      p.subscription_tier,
      p.subscription_status,
      p.comp_tier,
      p.comp_expires_at,
      p.credits,
      p.is_admin,
      p.created_at,
      (select count(*) from public.cards c where c.owner_id = p.id) as card_count,
      (select count(*) from public.decks d where d.owner_id = p.id) as deck_count,
      greatest(
        p.updated_at,
        (select max(c.updated_at) from public.cards c where c.owner_id = p.id),
        (select max(d.updated_at) from public.decks d where d.owner_id = p.id),
        u.last_sign_in_at
      ) as last_active_at
    from public.profiles p
    left join auth.users u on u.id = p.id
    where
      (p_q is null or btrim(p_q) = '' or (
        p.username ilike '%' || btrim(p_q) || '%'
        or p.display_name ilike '%' || btrim(p_q) || '%'
        or u.email ilike btrim(p_q) || '%'
      ))
      and (p_tier is null or p_tier = '' or p.subscription_tier = p_tier)
      and (p_status is null or p_status = '' or coalesce(p.subscription_status, 'none') = p_status)
      and (
        p_flag is null or p_flag = ''
        or (p_flag = 'admins' and p.is_admin)
        or (p_flag = 'paid' and p.subscription_tier <> 'free'
            and p.subscription_status in ('active', 'trialing'))
        or (p_flag = 'comped' and p.comp_tier is not null
            and (p.comp_expires_at is null or p.comp_expires_at > now()))
        or (p_flag = 'mismatch' and p.subscription_tier = 'free'
            and p.subscription_status in ('active', 'trialing'))
      )
  )
  select
    b.id, b.username, b.display_name, b.avatar_url, b.email,
    b.subscription_tier, b.subscription_status, b.comp_tier, b.comp_expires_at,
    b.credits, b.is_admin, b.card_count, b.deck_count, b.created_at,
    b.last_active_at,
    count(*) over () as total_count
  from base b
  order by
    case when p_sort = 'oldest' then b.created_at end asc,
    case when p_sort = 'active' then b.last_active_at end desc nulls last,
    case when p_sort = 'cards' then b.card_count end desc,
    case when p_sort = 'credits' then b.credits end desc,
    b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

create or replace function public.admin_user_stats(p_user_id uuid)
returns table (
  cards_total bigint,
  cards_public bigint,
  cards_unlisted bigint,
  cards_private bigint,
  decks bigint,
  sets bigint,
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
    (select count(*) from public.card_sets s where s.owner_id = p_user_id),
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

revoke all on function public.admin_list_users(text, text, text, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.admin_user_stats(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_list_users(text, text, text, text, text, integer, integer)
  to service_role;
grant execute on function public.admin_user_stats(uuid) to service_role;

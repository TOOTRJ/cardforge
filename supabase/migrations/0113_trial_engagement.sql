-- 0113 — admin_trial_engagement(): what each trial did during its 7 days.
--
-- Reads funnel_events only (0112): the trial_started row per user, its
-- outcome (trial_converted / trial_lapsed matched on the subscription id in
-- props, "ongoing" while the 7 days run), and the activity rows the app now
-- records (card_saved, ai_generation, download) inside the trial window.
-- Backs the admin Funnel panel's "Trial engagement" table. Admin-only read
-- through the service role, like admin_funnel_counts().
--
-- No new table: nothing else to grant.

create or replace function public.admin_trial_engagement(p_since timestamptz)
returns table (
  user_id uuid,
  username text,
  started_at timestamptz,
  outcome text,
  active_days integer,
  saves integer,
  generations integer,
  downloads integer
)
language sql
stable
security definer
set search_path = public
as $$
  with trials as (
    select e.user_id, e.created_at as started_at, e.props ->> 'subscriptionId' as sub_id
    from public.funnel_events e
    where e.event = 'trial_started'
      and e.user_id is not null
      and e.created_at >= p_since
  ),
  activity as (
    select a.user_id, a.event, a.created_at
    from public.funnel_events a
    where a.event in ('card_saved', 'ai_generation', 'download')
      and a.user_id is not null
      and a.created_at >= p_since
  )
  select
    t.user_id,
    p.username,
    t.started_at,
    coalesce(
      (select o.event from public.funnel_events o
        where o.event in ('trial_converted', 'trial_lapsed')
          and o.props ->> 'subscriptionId' = t.sub_id
        order by o.created_at desc limit 1),
      case when t.started_at + interval '7 days' > now() then 'ongoing' else 'unknown' end
    ) as outcome,
    (select count(distinct date_trunc('day', a.created_at))::integer from activity a
      where a.user_id = t.user_id and a.created_at between t.started_at and t.started_at + interval '7 days') as active_days,
    (select count(*)::integer from activity a
      where a.user_id = t.user_id and a.event = 'card_saved' and a.created_at between t.started_at and t.started_at + interval '7 days') as saves,
    (select count(*)::integer from activity a
      where a.user_id = t.user_id and a.event = 'ai_generation' and a.created_at between t.started_at and t.started_at + interval '7 days') as generations,
    (select count(*)::integer from activity a
      where a.user_id = t.user_id and a.event = 'download' and a.created_at between t.started_at and t.started_at + interval '7 days') as downloads
  from trials t
  left join public.profiles p on p.id = t.user_id
  order by t.started_at desc
  limit 50
$$;

revoke all on function public.admin_trial_engagement(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_trial_engagement(timestamptz) to service_role;

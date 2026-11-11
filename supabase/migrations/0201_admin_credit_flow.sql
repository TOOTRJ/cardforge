-- 0201_admin_credit_flow.sql — where AI credits went in a period: spent,
-- given back and granted, by reason and by day.
--
-- For /admin/analytics' "Credits and AI" tab (the 2026-11 analytics audit).
-- Until now the admin read only what was GRANTED (admin_credit_grant_stats,
-- 0181 / 0197); what was SPENT, on what, and how much of it came back as a
-- refund was in the ledger and on no page.
--
-- admin_credit_flow(p_since, p_until, p_include_admins) reads
-- public.credit_ledger for the period [p_since, p_until) — a NULL p_until
-- is now() — and answers ONE jsonb object:
--
--   since, until          the period as read (timestamps)
--   totals                { spent, spends, refunded, refunds, granted,
--                           grants, taken_back, take_backs } — credits and
--                           the number of ledger rows behind them
--   spent_by_reason       [ { reason, spent, spends, refunded, refunds } ]
--                           largest spend first; `refunded` / `refunds` are
--                           the period's refunds of charges with that reason
--                           (a reason refunded in the period but charged
--                           before it has spent 0)
--   refunded_unattributed { credits, refunds } — refunds whose charge could
--                           not be found (see below); in `totals.refunded`,
--                           in no reason's row
--   granted_by_reason     [ { reason, credits, grants } ] largest first
--   days                  [ { day, spent, granted, refunded } ] one entry
--                           per UTC day that has a row, oldest first (the
--                           app fills the quiet days)
--
-- What each word counts (every row lands in exactly one):
--   spent       delta < 0 — a charge by consume_credits; the reason is the
--               AI action's label (lib/ai/rate-limit.ts AiActionLabel).
--               GROSS: a charge that was later refunded is still a charge
--               here, and its refund is counted under `refunded`.
--   taken_back  delta < 0 with reason 'pack_refund' — the credits of a
--               refunded or disputed pack following the money (0174). The
--               one negative row that is not a charge; never in `spent`.
--   refunded    delta > 0 with reason 'refund' — a charge given back
--               (refundCredits and the reconcile sweep both write exactly
--               that reason).
--   granted     every other delta > 0, grouped as admin_credit_grant_stats
--               groups it: the reason before its first ':', trimmed and
--               lowercased ('admin_grant: a note' → 'admin_grant').
--
-- WHICH charge a refund gives back is read from its key, never guessed:
--   - 'refund:' + the charge's own key (0068: every charge since carries
--     'spend:…', and both refund paths key the refund on it) → that
--     charge's reason, found by the key's unique index on the same user;
--   - before 0068, 'refund:{reason}:{user id}:{…}' named the reason itself
--     (taken only when the third part IS the row's user);
--   - anything else is `refunded_unattributed`.
-- A refund is counted in the period it was WRITTEN in, which for a charge
-- made minutes before the period began is not the charge's period.
--
-- The PREVIOUS period is the caller's to ask for: the app calls this twice,
-- the second time with [previousSince, previousUntil) — the same stretch N
-- days earlier, as long as the period itself — so every tab of the page
-- compares against the same previous period (lib/admin/analytics/params.ts
-- analyticsPeriod).
--
-- p_include_admins = false leaves out every row of an admin's account. An
-- admin's AI use writes NO ledger row (lib/ai/rate-limit.ts spendCredits:
-- admins generate free), so in practice the switch changes what was
-- GRANTED (an admin's welcome credits, a grant to a team account) and
-- whatever an account spent before it was made an admin. The ledger has no
-- row without a user (user_id is NOT NULL, and a deleted account takes its
-- rows with it).
--
-- Grants are explicit (0097): the service role's only — it sums every
-- user's ledger. Idempotent. Ships through a PR; never applied ad-hoc.

create or replace function public.admin_credit_flow(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_include_admins boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select p_since as since, coalesce(p_until, now()) as until
  ),
  ledger as (
    select
      l.user_id,
      l.delta,
      l.idempotency_key,
      (l.created_at at time zone 'utc')::date as day,
      coalesce(nullif(lower(btrim(split_part(l.reason, ':', 1))), ''), 'other') as head
    from public.credit_ledger l
    cross join bounds b
    where l.created_at >= b.since
      and l.created_at < b.until
      and l.delta <> 0
      and (
        p_include_admins
        or l.user_id not in (select p.id from public.profiles p where p.is_admin)
      )
  ),
  classified as (
    select
      l.*,
      case
        when l.delta < 0 and l.head = 'pack_refund' then 'taken_back'
        when l.delta < 0 then 'spent'
        when l.head = 'refund' then 'refunded'
        else 'granted'
      end as kind
    from ledger l
  ),
  refunds as (
    select
      c.delta,
      coalesce(
        (
          select coalesce(nullif(lower(btrim(split_part(s.reason, ':', 1))), ''), 'other')
          from public.credit_ledger s
          where c.idempotency_key like 'refund:%'
            and s.idempotency_key = substr(c.idempotency_key, 8)
            and s.user_id = c.user_id
            and s.delta < 0
        ),
        case
          when c.idempotency_key ~ '^refund:[a-z][a-z0-9_]*:'
            and split_part(c.idempotency_key, ':', 3) = c.user_id::text
          then split_part(c.idempotency_key, ':', 2)
        end
      ) as spent_reason
    from classified c
    where c.kind = 'refunded'
  ),
  spent_by as (
    select c.head as reason, sum(-c.delta)::bigint as spent, count(*)::bigint as spends
    from classified c
    where c.kind = 'spent'
    group by 1
  ),
  refunded_by as (
    select r.spent_reason as reason, sum(r.delta)::bigint as refunded, count(*)::bigint as refunds
    from refunds r
    where r.spent_reason is not null
    group by 1
  ),
  by_reason as (
    select
      coalesce(s.reason, r.reason) as reason,
      coalesce(s.spent, 0) as spent,
      coalesce(s.spends, 0) as spends,
      coalesce(r.refunded, 0) as refunded,
      coalesce(r.refunds, 0) as refunds
    from spent_by s
    full join refunded_by r on r.reason = s.reason
  ),
  granted_by as (
    select c.head as reason, sum(c.delta)::bigint as credits, count(*)::bigint as grants
    from classified c
    where c.kind = 'granted'
    group by 1
  ),
  by_day as (
    select
      c.day,
      coalesce(sum(-c.delta) filter (where c.kind = 'spent'), 0)::bigint as spent,
      coalesce(sum(c.delta) filter (where c.kind = 'granted'), 0)::bigint as granted,
      coalesce(sum(c.delta) filter (where c.kind = 'refunded'), 0)::bigint as refunded
    from classified c
    group by 1
  )
  select jsonb_build_object(
    'since', b.since,
    'until', b.until,
    'totals', (
      select jsonb_build_object(
        'spent', coalesce(sum(-c.delta) filter (where c.kind = 'spent'), 0),
        'spends', count(*) filter (where c.kind = 'spent'),
        'refunded', coalesce(sum(c.delta) filter (where c.kind = 'refunded'), 0),
        'refunds', count(*) filter (where c.kind = 'refunded'),
        'granted', coalesce(sum(c.delta) filter (where c.kind = 'granted'), 0),
        'grants', count(*) filter (where c.kind = 'granted'),
        'taken_back', coalesce(sum(-c.delta) filter (where c.kind = 'taken_back'), 0),
        'take_backs', count(*) filter (where c.kind = 'taken_back')
      )
      from classified c
    ),
    'spent_by_reason', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'reason', r.reason,
            'spent', r.spent,
            'spends', r.spends,
            'refunded', r.refunded,
            'refunds', r.refunds
          )
          order by r.spent desc, r.refunded desc, r.reason asc
        )
        from by_reason r
      ),
      '[]'::jsonb
    ),
    'refunded_unattributed', (
      select jsonb_build_object('credits', coalesce(sum(r.delta), 0), 'refunds', count(*))
      from refunds r
      where r.spent_reason is null
    ),
    'granted_by_reason', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('reason', g.reason, 'credits', g.credits, 'grants', g.grants)
          order by g.credits desc, g.reason asc
        )
        from granted_by g
      ),
      '[]'::jsonb
    ),
    'days', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('day', d.day, 'spent', d.spent, 'granted', d.granted, 'refunded', d.refunded)
          order by d.day asc
        )
        from by_day d
      ),
      '[]'::jsonb
    )
  )
  from bounds b;
$$;

revoke all on function public.admin_credit_flow(timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.admin_credit_flow(timestamptz, timestamptz, boolean) to service_role;

-- 0218_re_art_background_runs.sql — Re-art deck (beta tool `re-art-deck`,
-- 0191): a run can KEEP GOING after its page is closed (owner 2026-11-18,
-- the last of the extras).
--
-- Every step of a run works under the maker's own sign-in (the step door,
-- claim_job_step, spend_credits, the card's edit). Until now the browser
-- asked for each step, so a run stopped when its page closed. With "Keep
-- painting if I close this page" the SERVER asks for them: a driver (the
-- hand-over's own request for its first minutes, then a cron every minute)
-- calls the same step door the browser calls, with a session made of the
-- ACCESS TOKEN the browser had when the run was handed over — never its
-- refresh token, and never refreshed. No new identity is created (owner
-- 2026-11-18: "borrow the sign-in"), so a run is carried for as long as
-- that one token lasts: about an hour. Past that the run pauses and
-- continues when its maker opens the page again, as it always did.
--
-- deck_reart_background — ONE row per run handed to the server:
--   * the driver's LEASE (`driver`, `driven_until`): two drivers never work
--     one run;
--   * `beat_at`: when a driver last looked at it (the studio reads "the
--     server is carrying this" from it);
--   * `door_errors`: refusals of the step door in a row (the sign-in ended,
--     the job gone) — a run is paused at three, never spun on;
--   * `limited_keys`: the steps that had failed on a plan limit when it was
--     handed over — only a NEW such failure stops it;
--   * `state` / `reason`: what became of it, for the studio and the bell.
-- Keyed on ONE column (the job) — never a composite primary key over its
-- foreign keys (the 0209 incident; 0210; CLAUDE.md). Written by the server
-- only; the owner reads their own while the tool is open to them. It holds
-- no sign-in.
--
-- deck_reart_background_tokens — the borrowed access token, ENCRYPTED by
-- the app (AES-256-GCM under a key derived from the server's own secret,
-- lib/tools/re-art/token-seal.ts), for as long as the run is carried and no
-- longer: erased when the server's part ends. No API role reads or writes
-- it — no policy, no grant.
--
-- notifications gains the kind `reart_run`: the bell's row when such a run
-- finished, stopped or paused. The list is rewritten WHOLE from 0183's, the
-- latest that defines it.
--
-- Grants are explicit (0097). Idempotent. Ships through a PR; never applied
-- ad-hoc.

create table if not exists public.deck_reart_background (
  job_id uuid primary key references public.ai_generation_jobs (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  deck_id uuid not null references public.decks (id) on delete cascade,
  state text not null default 'running'
    check (state in ('running', 'paused', 'stopped', 'finished')),
  -- Why it is not running: the sign-in it borrowed ran out; the step door
  -- kept refusing; the maker's credits or card slots ran out; the maker
  -- pressed Stop (or closed the run).
  reason text
    check (reason is null or reason in ('expired', 'error', 'credits', 'capacity', 'stopped')),
  -- The driver working it now, and until when it holds it (renewed as it works).
  driver uuid,
  driven_until timestamptz,
  beat_at timestamptz not null default now(),
  door_errors integer not null default 0 check (door_errors between 0 and 1000),
  limited_keys text[] not null default '{}',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists deck_reart_background_owner_idx on public.deck_reart_background (owner_id);
create index if not exists deck_reart_background_deck_idx on public.deck_reart_background (deck_id);
-- The driver's read: the runs being carried, the least recently worked first.
create index if not exists deck_reart_background_running_idx
  on public.deck_reart_background (beat_at) where state = 'running';

comment on table public.deck_reart_background is
  'Re-art deck beta tool (0218): the runs the server carries on after their page is closed — the driver''s lease, its heartbeat (beat_at) and what became of the run. Holds no sign-in. Written by the server only; the owner reads their own while has_tool_access(''re-art-deck'').';

alter table public.deck_reart_background enable row level security;

drop policy if exists "Deck re-art background: owner reads" on public.deck_reart_background;
create policy "Deck re-art background: owner reads"
  on public.deck_reart_background for select
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('re-art-deck'));

-- The job is the row owner's own Re-art run, and the deck is theirs.
create or replace function public.deck_reart_background_check_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.ai_generation_jobs j
    where j.id = new.job_id and j.owner_id = new.owner_id and j.kind = 'deck_reart'
  ) or not exists (
    select 1 from public.decks d where d.id = new.deck_id and d.owner_id = new.owner_id
  ) then
    raise exception 'deck_reart_background_not_owner'
      using errcode = '42501',
            hint = 'A background Re-art run belongs to its owner''s own run and deck.';
  end if;
  return new;
end;
$$;

drop trigger if exists deck_reart_background_check_owner on public.deck_reart_background;
create trigger deck_reart_background_check_owner
  before insert or update of job_id, owner_id, deck_id on public.deck_reart_background
  for each row execute function public.deck_reart_background_check_owner();

revoke all on function public.deck_reart_background_check_owner() from public, anon, authenticated;

revoke all on public.deck_reart_background from public, anon, authenticated;
grant select on public.deck_reart_background to authenticated;
revoke all on public.deck_reart_background from service_role;
grant select, insert, update, delete on public.deck_reart_background to service_role;

-- The borrowed access token, sealed by the app. Server only: row level
-- security with NO policy, and no grant to any API role.
create table if not exists public.deck_reart_background_tokens (
  job_id uuid primary key references public.deck_reart_background (job_id) on delete cascade,
  sealed text not null check (char_length(sealed) between 40 and 8000),
  expires_at timestamptz not null
);

comment on table public.deck_reart_background_tokens is
  'Re-art deck beta tool (0218): the ACCESS token a carried run borrows, encrypted by the app (never a refresh token), kept only while the run is carried. No API role reads or writes it.';

alter table public.deck_reart_background_tokens enable row level security;

revoke all on public.deck_reart_background_tokens from public, anon, authenticated;
revoke all on public.deck_reart_background_tokens from service_role;
grant select, insert, update, delete on public.deck_reart_background_tokens to service_role;

-- The bell's row for such a run.
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
      'deck_like', 'deck_card_added', 'moderation_unhidden', 'comp_ending',
      'deck_cloned', 'challenge_winner',
      'payment_failed', 'billing_alert',
      'referral_signup', 'referral_reward',
      'banked_days',
      'tool_access',
      'exact_copy_unlisted',
      -- RE-ART DECK: a run that kept going without its page
      'reart_run'
    )
  );

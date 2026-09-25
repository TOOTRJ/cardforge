-- 0115 — what a frame verification was measured against (frames plan 0.10).
--
-- frame_reviews only knew THAT a combo was verified. It now records what
-- the tick meant: the renderer layout version, a hash of the template's
-- layout override, the reference printing on screen and the alignment
-- score at that moment. The admin page compares these with the current
-- state and shows "needs re-verification" when the renderer or the
-- override moved on — before this, an edited override left every combo of
-- the template looking verified forever.
--
-- frame_review_events is the append-only history behind it (verify /
-- withdraw / pin / unpin / override saved / override reset). color_key '*'
-- marks a template-wide event (an override change touches every colour).
-- Admin-only: no policies for the API roles; the admin page reads it
-- through the service role after its own is_admin check.
--
-- Ships through a PR; never applied ad-hoc.

alter table public.frame_reviews
  add column if not exists verified_layout_version integer,
  add column if not exists verified_override_hash text,
  add column if not exists verified_reference_id text,
  add column if not exists score_json jsonb;

create table if not exists public.frame_review_events (
  id uuid primary key default gen_random_uuid(),
  template text not null,
  color_key text not null check (color_key in ('w','u','b','r','g','c','m','*')),
  action text not null check (
    action in ('verify', 'withdraw', 'pin', 'unpin', 'override_saved', 'override_reset')
  ),
  actor uuid references public.profiles (id) on delete set null,
  layout_version integer,
  override_hash text,
  reference_scryfall_id text,
  score_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists frame_review_events_combo_idx
  on public.frame_review_events (template, color_key, created_at desc);

alter table public.frame_review_events enable row level security;
-- No policies on purpose: nothing an anon/authenticated session may do here.

-- Grants (every migration states them — new projects don't auto-grant).
grant select, insert on public.frame_review_events to service_role;

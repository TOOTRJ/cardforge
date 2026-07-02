-- Frame layout overrides for the admin visual editor (/admin/frame-compare).
--
-- One row per template holding a deep-partial FrameProfile (geometry-only,
-- validated by the zod schema in lib/cards/profile-override.ts) that merges
-- over the code defaults in lib/cards/template-layout.ts at render time —
-- live preview AND Satori bake. Absent row = code defaults. Rows are meant
-- to be periodically folded back into code ("Copy as TS" in the editor)
-- and deleted.
--
-- Same posture as frame_reviews (0048): world-readable (every card render
-- needs it), writes only via the service role inside is_admin-gated
-- server actions.

create table if not exists public.frame_profile_overrides (
  template text primary key,
  overrides jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.frame_profile_overrides enable row level security;

drop policy if exists "Anyone can read frame profile overrides"
  on public.frame_profile_overrides;

create policy "Anyone can read frame profile overrides"
  on public.frame_profile_overrides
  for select
  using (true);

-- No insert/update/delete policies: mutations happen via the service role
-- inside the is_admin-gated server action only.

-- Admin-chosen reference card per frame combo (frame-compare tool): name +
-- set stored alongside the id so the checklist renders without API calls.
alter table public.frame_reviews
  add column if not exists reference_name text,
  add column if not exists reference_set text;

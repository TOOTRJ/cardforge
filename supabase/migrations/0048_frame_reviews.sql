-- Frame verification checklist backing /admin/frame-compare.
--
-- One row per (template, color) frame combination the admin has touched;
-- an ABSENT row means "not yet reviewed". `verified = true` publishes the
-- combination to the frame picker for all users (new templates stay hidden
-- until verified; templates shipped before this system are grandfathered
-- in code — see lib/cards/frame-availability.ts).
--
-- Writes go through the service role only (admin action gates on
-- profiles.is_admin, same posture as moderation); everyone can read, since
-- the frame picker needs availability during card creation.

create table if not exists public.frame_reviews (
  template text not null,
  color_key text not null check (color_key in ('w','u','b','r','g','c','m')),
  verified boolean not null default false,
  verified_at timestamptz,
  verified_by uuid references public.profiles (id) on delete set null,
  -- The exact printing the combo was verified against (frame-compare ref).
  reference_scryfall_id text,
  primary key (template, color_key)
);

alter table public.frame_reviews enable row level security;

drop policy if exists "Anyone can read frame reviews" on public.frame_reviews;

-- Availability is public information (the picker uses it for every user).
create policy "Anyone can read frame reviews"
  on public.frame_reviews
  for select
  using (true);

-- No insert/update/delete policies: mutations happen via the service role
-- inside the is_admin-gated server action only.

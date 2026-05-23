-- 0023 — set_likes: per-user heart on a set.
--
-- Mirrors 0008_card_likes exactly — one row = one user liking one set,
-- toggled via insert/delete with the (user_id, set_id) unique constraint
-- protecting against double-like races. RLS is permissive on SELECT so
-- anonymous viewers see counts; writes are owner-only.

create table if not exists public.set_likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  set_id uuid not null references public.card_sets (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, set_id)
);

create index if not exists set_likes_set_id_idx on public.set_likes (set_id);
create index if not exists set_likes_user_id_idx on public.set_likes (user_id);

alter table public.set_likes enable row level security;

drop policy if exists "Set likes are publicly readable" on public.set_likes;
drop policy if exists "Users can like sets" on public.set_likes;
drop policy if exists "Users can unlike their own likes" on public.set_likes;

create policy "Set likes are publicly readable"
  on public.set_likes
  for select
  using (true);

-- Authenticated users may like any set they can read. The card_sets RLS
-- already filters private sets belonging to others; this `exists` check
-- enforces that gating at write time as well.
create policy "Users can like sets"
  on public.set_likes
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.card_sets s
      where s.id = set_id
    )
  );

create policy "Users can unlike their own likes"
  on public.set_likes
  for delete
  using (auth.uid() = user_id);

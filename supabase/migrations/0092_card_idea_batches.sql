-- 0092_card_idea_batches.sql — "Get ideas" batches are kept (owner decision
-- 2026-09-17).
--
-- The ideas dialog charges one credit for three text-only concepts, but the
-- response lived only in the open dialog: navigate away mid-request and the
-- credit was spent for nothing. Every generated batch is now stored under
-- its owner so the dialog can reopen the last one without spending again.
-- Owner-only rows; the app inserts them right after generation.

create table if not exists public.card_idea_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  request jsonb not null default '{}'::jsonb,
  ideas jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists card_idea_batches_owner_created_idx
  on public.card_idea_batches (owner_id, created_at desc);

alter table public.card_idea_batches enable row level security;

drop policy if exists "Idea batches: owner read" on public.card_idea_batches;
create policy "Idea batches: owner read"
  on public.card_idea_batches for select
  using (auth.uid() = owner_id);

drop policy if exists "Idea batches: owner insert" on public.card_idea_batches;
create policy "Idea batches: owner insert"
  on public.card_idea_batches for insert
  with check (auth.uid() = owner_id);

grant select, insert on public.card_idea_batches to authenticated;

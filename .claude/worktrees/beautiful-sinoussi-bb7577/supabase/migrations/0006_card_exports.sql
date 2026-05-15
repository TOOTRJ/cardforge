-- Phase 5 — card_exports: persistent download history per card.
-- Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP.
--
-- Visibility: owner-only. The exported file itself lives in the public
-- `card-exports` bucket so direct URLs work for sharing/downloading; the
-- ROW exists to give the owner an export history they can revisit.

create table if not exists public.card_exports (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  file_url text not null,
  storage_path text not null,
  width integer not null,
  height integer not null,
  format text not null,
  created_at timestamptz not null default now(),
  constraint card_exports_format_valid
    check (format in ('png', 'webp')),
  constraint card_exports_width_positive
    check (width > 0 and width <= 8192),
  constraint card_exports_height_positive
    check (height > 0 and height <= 8192),
  constraint card_exports_file_url_length
    check (char_length(file_url) <= 2048),
  constraint card_exports_storage_path_length
    check (char_length(storage_path) <= 1024)
);

create index if not exists card_exports_card_id_idx
  on public.card_exports (card_id, created_at desc);
create index if not exists card_exports_owner_id_idx
  on public.card_exports (owner_id, created_at desc);

alter table public.card_exports enable row level security;

drop policy if exists "Card exports owner-only select" on public.card_exports;
drop policy if exists "Card exports owner-only insert" on public.card_exports;
drop policy if exists "Card exports owner-only delete" on public.card_exports;

create policy "Card exports owner-only select"
  on public.card_exports
  for select
  using (auth.uid() = owner_id);

create policy "Card exports owner-only insert"
  on public.card_exports
  for insert
  with check (
    auth.uid() = owner_id
    and exists (
      select 1
      from public.cards c
      where c.id = card_id
        and c.owner_id = auth.uid()
    )
  );

create policy "Card exports owner-only delete"
  on public.card_exports
  for delete
  using (auth.uid() = owner_id);

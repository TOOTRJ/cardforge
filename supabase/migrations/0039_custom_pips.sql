-- PipGlyph custom pips — per-user icon overrides for the core mana symbols.
--
-- A row maps (owner, symbol) → an uploaded image that replaces the standard
-- mana-font glyph wherever that owner's cards render a cost pip (live preview
-- AND the Satori bake). Only the icon changes; the cost string, tokenizer,
-- and color identity logic are untouched.
--
-- v1 scope: the six core symbols W/U/B/R/G/C, mana costs only.
-- Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP.

create table if not exists public.custom_pips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null check (symbol in ('W', 'U', 'B', 'R', 'G', 'C')),
  image_url text not null check (char_length(image_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, symbol)
);

create index if not exists custom_pips_owner_idx
  on public.custom_pips (owner_id);

-- updated_at trigger (same hardened pattern as profiles/cards)
create or replace function public.set_custom_pips_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists custom_pips_set_updated_at on public.custom_pips;
create trigger custom_pips_set_updated_at
  before update on public.custom_pips
  for each row execute function public.set_custom_pips_updated_at();

-- ===========================================================================
-- RLS — custom_pips
-- ===========================================================================
-- Reads are public: anonymous visitors viewing a public card must be able to
-- resolve the card OWNER's pip overrides to render the cost faithfully.
-- Writes are owner-only.

alter table public.custom_pips enable row level security;

drop policy if exists "Custom pips are readable by everyone" on public.custom_pips;
drop policy if exists "Owners can insert their own custom pips" on public.custom_pips;
drop policy if exists "Owners can update their own custom pips" on public.custom_pips;
drop policy if exists "Owners can delete their own custom pips" on public.custom_pips;

create policy "Custom pips are readable by everyone"
  on public.custom_pips
  for select
  using (true);

create policy "Owners can insert their own custom pips"
  on public.custom_pips
  for insert
  with check (auth.uid() = owner_id);

create policy "Owners can update their own custom pips"
  on public.custom_pips
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Owners can delete their own custom pips"
  on public.custom_pips
  for delete
  using (auth.uid() = owner_id);

-- ===========================================================================
-- Storage — custom-pips bucket (public read, owner-folder writes)
-- ===========================================================================
-- Path layout: custom-pips/{owner_id}/{symbol}.png
-- Uploads are normalized server-side to 256×256 PNG before they reach
-- storage; the bucket limits are a second line of defense.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'custom-pips',
  'custom-pips',
  true,
  2097152,  -- 2 MB
  array['image/png']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Owner-scoped SELECT: pip uploads use a deterministic path with
-- `upsert: true`, which storage-api executes as INSERT ... ON CONFLICT DO
-- UPDATE — Postgres needs SELECT visibility on storage.objects for that
-- plan (same root cause as the card-renders fix in 0038). Scoped to the
-- owner's folder so the bucket still can't be LISTed broadly.

drop policy if exists "Owners can read their own custom pips" on storage.objects;
create policy "Owners can read their own custom pips"
  on storage.objects for select
  using (
    bucket_id = 'custom-pips'
    and (auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "Owners can upload custom pips to their own folder" on storage.objects;
drop policy if exists "Owners can update their own custom pips" on storage.objects;
drop policy if exists "Owners can delete their own custom pips" on storage.objects;

create policy "Owners can upload custom pips to their own folder"
  on storage.objects
  for insert
  with check (
    bucket_id = 'custom-pips'
    and auth.role() = 'authenticated'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Owners can update their own custom pips"
  on storage.objects
  for update
  using (
    bucket_id = 'custom-pips'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'custom-pips'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Owners can delete their own custom pips"
  on storage.objects
  for delete
  using (
    bucket_id = 'custom-pips'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

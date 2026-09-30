-- 0132 — ONE finish per staged card-art upload (review of #433, 2026-09-29;
-- TODO 6.10). Ships through a PR; never applied ad-hoc.
--
-- MERGE ORDER: with 0131 (same PR, #433), after 0130 (#421). Nothing here
-- depends on 0130's contents — the numbers are what order them.
--
-- 0131's finishCardArtUploadAction reads the staged file, stores it in
-- card-art and only THEN overwrites the staged key with a tombstone — so
-- finishes fired in parallel on one name all read the file first and each
-- stored a copy, on ONE counted start (the upload rate limit counts the
-- start). That undid the 300-a-day limit for anyone scripting the action.
-- Storage can't arbitrate it: racing uploads of one key without upsert all
-- succeed (seen in CI against the local stack) — only a primary key can.
--
-- `card_art_upload_claims` + claim_card_art_upload(user, name): the finish
-- (lib/cards/art-upload-claim.ts) calls it before it reads anything;
-- `insert … on conflict do nothing; return found` answers true to exactly
-- one caller per (user, name) — the others wait for that insert, then insert
-- nothing. A claim older than a day (the signed upload URL it guards lives
-- 2 hours) is pruned by the next call, up to 500 at a time. The user_id FK
-- cascades, so account deletion clears a user's claims.
--
-- Grants: service_role only, like 0127's upload_hits — the table and the
-- function are revoked from public / anon / authenticated; RLS on, no
-- policy.
--
-- Idempotent: `if not exists` for the table and index, `create or replace`
-- for the function; the grants are re-stated.

create table if not exists public.card_art_upload_claims (
  user_id uuid not null references auth.users (id) on delete cascade,
  staged_name text not null check (char_length(staged_name) between 1 and 200),
  claimed_at timestamptz not null default now(),
  primary key (user_id, staged_name)
);

create index if not exists card_art_upload_claims_claimed_at_idx
  on public.card_art_upload_claims (claimed_at);

alter table public.card_art_upload_claims enable row level security;

create or replace function public.claim_card_art_upload(
  p_user_id uuid,
  p_staged_name text
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_user_id is null or p_staged_name is null or p_staged_name = '' then
    raise exception 'card art claim: a user id and a staged name are required';
  end if;

  -- Housekeeping: up to 500 claims older than a day, anyone's. A row another
  -- call has locked is skipped, never waited on.
  with expired as (
    select c.user_id, c.staged_name
      from public.card_art_upload_claims as c
     where c.claimed_at <= now() - interval '1 day'
     limit 500
       for update skip locked
  )
  delete from public.card_art_upload_claims as c
   using expired as e
   where c.user_id = e.user_id
     and c.staged_name = e.staged_name;

  -- The primary key decides: of calls racing on one (user, name), one
  -- inserts; the others wait for it, then insert nothing.
  insert into public.card_art_upload_claims (user_id, staged_name)
  values (p_user_id, p_staged_name)
  on conflict (user_id, staged_name) do nothing;

  return found;
end;
$$;

revoke all on table public.card_art_upload_claims from public, anon, authenticated;
grant select, insert, delete on table public.card_art_upload_claims to service_role;

revoke all on function public.claim_card_art_upload(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_card_art_upload(uuid, text)
  to service_role;

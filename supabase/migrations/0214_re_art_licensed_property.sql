-- 0214_re_art_licensed_property.sql — Re-art deck (beta tool `re-art-deck`,
-- 0191): a deck that names a LICENSED PROPERTY, and a deck's REFERENCE
-- PICTURE.
--
-- Some makers hold the rights to a property (a film series, a game, their
-- own world) or its holder's permission, and want the deck's pictures in
-- that property's look, with its characters. Owner 2026-11-13: the maker
-- self-attests; they can say it in words or upload a picture; the pictures
-- may be public like any other.
--
-- 1. deck_art_styles gains
--      `ip_name`       — the property the deck's pictures are of ('' = none;
--                        up to 120 characters, cleaned by the server). Every
--                        prompt of the deck then says so
--                        (lib/tools/re-art/model.ts reartIpLine);
--      `reference_url` — the deck's reference picture: the maker's OWN
--                        stored picture (their folder in set-covers or
--                        card-art, on a registered storage origin — the
--                        trigger asks media_url_allowed, 0127), which each
--                        picture painted from the prompt is painted WITH.
--    Both are part of the deck's look: the server moves the style's version
--    on when either changes. The table's grants are table-level (0191), so
--    they cover the columns.
--
-- 2. deck_ip_attestations — what a maker CONFIRMED before a deck named a
--    property: who, when, which property, and the sentence itself, word for
--    word. Append-only: the server inserts a row each time a deck starts
--    naming a property (or names another); nothing updates or deletes one
--    but the cascade of a deleted account. The row outlives its deck
--    (deck_id is set null). The owner reads their own while the tool is open
--    to them; an admin reads all. Nothing here CHECKS a licence — the
--    sentence is the maker's own.
--
-- No stored card changes and nothing is charged for. Grants are explicit
-- (0097). Idempotent. Ships through a PR; never applied ad-hoc.

-- ===========================================================================
-- 1. The property a deck names, and its reference picture
-- ===========================================================================

alter table public.deck_art_styles
  add column if not exists ip_name text not null default '',
  add column if not exists reference_url text;

-- lib/tools/re-art/model.ts REART_IP_NAME_MAX, cleaned by the server.
alter table public.deck_art_styles
  drop constraint if exists deck_art_styles_ip_name_check;
alter table public.deck_art_styles
  add constraint deck_art_styles_ip_name_check check (char_length(ip_name) <= 120);

alter table public.deck_art_styles
  drop constraint if exists deck_art_styles_reference_url_check;
alter table public.deck_art_styles
  add constraint deck_art_styles_reference_url_check
  check (reference_url is null or char_length(reference_url) between 1 and 600);

comment on column public.deck_art_styles.ip_name is
  'Re-art deck (0214): the licensed property the deck''s pictures are of ('''' = none). Named only after the maker confirmed their rights (deck_ip_attestations).';
comment on column public.deck_art_styles.reference_url is
  'Re-art deck (0214): the deck''s reference picture — the owner''s own stored picture (set-covers or card-art), which each picture painted from the prompt is painted with. NULL = none.';

-- The owner is the deck's (0191) — and the reference picture is that
-- owner's own stored picture on a registered storage origin: never an
-- address the server would fetch for someone else's deck.
create or replace function public.deck_art_styles_check_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.decks d where d.id = new.deck_id and d.owner_id = new.owner_id
  ) then
    raise exception 'deck_art_style_not_owner'
      using errcode = '42501',
            hint = 'A deck''s art style belongs to the deck''s owner.';
  end if;
  -- 'set-icon' is media_url_allowed's kind for "the owner's own object in
  -- set-covers or card-art" with no built-in exception (0127 / 0150).
  if new.reference_url is not null
     and not public.media_url_allowed('set-icon', new.reference_url, new.owner_id) then
    raise exception 'deck_art_style_reference_not_allowed'
      using errcode = '42501',
            hint = 'A deck''s reference picture is one of its owner''s own stored pictures.';
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

revoke all on function public.deck_art_styles_check_owner() from public, anon, authenticated;

-- ===========================================================================
-- 2. What the maker confirmed
-- ===========================================================================

create table if not exists public.deck_ip_attestations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  -- The record outlives its deck.
  deck_id uuid references public.decks (id) on delete set null,
  ip_name text not null check (char_length(ip_name) between 1 and 120),
  -- The sentence the maker confirmed, word for word
  -- (lib/tools/re-art/model.ts reartIpStatement).
  statement text not null check (char_length(statement) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists deck_ip_attestations_owner_idx
  on public.deck_ip_attestations (owner_id, created_at desc);
create index if not exists deck_ip_attestations_deck_idx
  on public.deck_ip_attestations (deck_id);

comment on table public.deck_ip_attestations is
  'Re-art deck beta tool (0214): what a maker confirmed before a deck named a licensed property — who, when, which property, the sentence word for word. Append-only, written by the server; the owner reads their own while has_tool_access(''re-art-deck''), an admin reads all. Nothing here checks a licence.';

alter table public.deck_ip_attestations enable row level security;

drop policy if exists "Deck IP attestations: owner reads" on public.deck_ip_attestations;
create policy "Deck IP attestations: owner reads"
  on public.deck_ip_attestations for select
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('re-art-deck'));

drop policy if exists "Deck IP attestations: admins read" on public.deck_ip_attestations;
create policy "Deck IP attestations: admins read"
  on public.deck_ip_attestations for select
  to authenticated
  using (public.viewer_is_admin());

-- Append-only, for the server too: it inserts and reads, and never updates
-- or deletes a row (a deleted account's rows go with it through the cascade).
revoke all on public.deck_ip_attestations from public, anon, authenticated;
grant select on public.deck_ip_attestations to authenticated;
revoke all on public.deck_ip_attestations from service_role;
grant select, insert on public.deck_ip_attestations to service_role;

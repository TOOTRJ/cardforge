-- 0215_re_art_kept_rolls.sql — Re-art deck (beta tool `re-art-deck`, 0191):
-- the EARLIER PICTURES of a card are kept, so the maker can go back to one.
--
-- Until now a re-roll replaced the picture Re-art had painted on a card for
-- good, and "Put the old art back" removed it: the only way back to a
-- picture the maker liked better was luck. Owner 2026-11-13 (the six
-- extras): keep earlier rolls and choose.
--
-- deck_reart_rolls — one row per picture Re-art painted on a card for a deck
-- that the deck's row (deck_reart_cards) no longer names: the picture(s),
-- the fit and artist credit the card had with it, the style version it was
-- painted in, who painted it and how. The server keeps a few per card and
-- deck (lib/tools/re-art/model.ts REART_ROLLS_KEPT), removes the oldest past
-- that, and moves one back onto the card when the maker picks it — the row
-- then leaves this table.
--
--   * Keyed on ONE column (`id`), with the picture unique per deck and card:
--     never a composite primary key over the two foreign keys, which the API
--     would read as a link between decks and cards (the 0209 incident;
--     CLAUDE.md, deck-reart-prompts-key-migration.test.ts).
--   * Written by the server only, as deck_reart_cards is; the owner reads
--     their own while the tool is open to them. The deck and the card are
--     the row owner's own (the trigger asks, whoever writes).
--   * The storage orphan sweep keeps any URL a text column names
--     (scripts/lib/storage-orphans.mjs URL_SOURCES lists this table): a kept
--     picture is never swept; one the server dropped is.
--
-- No stored card or painted row changes, and nothing is charged for. Grants
-- are explicit (0097). Idempotent. Ships through a PR; never applied ad-hoc.

create table if not exists public.deck_reart_rolls (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  -- The style version it was painted in (the pick shows a picture of an
  -- earlier style as one).
  style_version integer not null check (style_version between 1 and 100000),
  -- The run whose step painted it (no FK: a job row may be pruned).
  job_id uuid,
  -- The picture, and the fit and artist credit the card had with it (NULL:
  -- the card no longer showed it when it was kept — it is fitted afresh).
  art_url text not null check (char_length(art_url) between 1 and 2048),
  art_position jsonb
    check (art_position is null or (jsonb_typeof(art_position) = 'object' and octet_length(art_position::text) <= 400)),
  artist_credit text check (artist_credit is null or char_length(artist_credit) <= 200),
  -- A two-faced card's back picture, kept with its front.
  back_art_url text check (back_art_url is null or char_length(back_art_url) between 1 and 2048),
  back_art_position jsonb
    check (back_art_position is null or (jsonb_typeof(back_art_position) = 'object' and octet_length(back_art_position::text) <= 400)),
  back_artist_credit text check (back_artist_credit is null or char_length(back_artist_credit) <= 200),
  -- Who painted it and how (deck_reart_cards.image_model, 0211; .method, 0212).
  image_model text check (image_model is null or char_length(image_model) between 1 and 200),
  method text check (method is null or method in ('paint', 'restyle')),
  -- When it was painted, and when it left the card for this table.
  painted_at timestamptz not null,
  kept_at timestamptz not null default now()
);

-- One row a picture, per deck and card: keeping it twice is keeping it once.
create unique index if not exists deck_reart_rolls_picture_key
  on public.deck_reart_rolls (deck_id, card_id, art_url);
create index if not exists deck_reart_rolls_card_idx on public.deck_reart_rolls (card_id);
create index if not exists deck_reart_rolls_owner_idx on public.deck_reart_rolls (owner_id, kept_at desc);

comment on table public.deck_reart_rolls is
  'Re-art deck beta tool (0215): the earlier pictures Re-art painted on a card for a deck, kept so the maker can go back to one (a few per card and deck; the server removes the oldest past that). Written by the server only; the owner reads their own while has_tool_access(''re-art-deck''). The storage orphan sweep keeps any URL a text column names.';

alter table public.deck_reart_rolls enable row level security;

drop policy if exists "Deck re-art rolls: owner reads" on public.deck_reart_rolls;
create policy "Deck re-art rolls: owner reads"
  on public.deck_reart_rolls for select
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('re-art-deck'));

-- The deck AND the card are the row owner's own (deck_reart_cards' rule).
create or replace function public.deck_reart_rolls_check_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.decks d where d.id = new.deck_id and d.owner_id = new.owner_id
  ) or not exists (
    select 1 from public.cards c where c.id = new.card_id and c.owner_id = new.owner_id
  ) then
    raise exception 'deck_reart_roll_not_owner'
      using errcode = '42501',
            hint = 'Re-art keeps only its owner''s own cards'' pictures, on their own decks.';
  end if;
  return new;
end;
$$;

drop trigger if exists deck_reart_rolls_check_owner on public.deck_reart_rolls;
create trigger deck_reart_rolls_check_owner
  before insert or update on public.deck_reart_rolls
  for each row execute function public.deck_reart_rolls_check_owner();

revoke all on function public.deck_reart_rolls_check_owner() from public, anon, authenticated;

revoke all on public.deck_reart_rolls from public, anon, authenticated;
grant select on public.deck_reart_rolls to authenticated;
revoke all on public.deck_reart_rolls from service_role;
grant select, insert, update, delete on public.deck_reart_rolls to service_role;

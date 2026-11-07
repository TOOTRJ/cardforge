-- 0186_bulk_customize.sql — the Bulk Customize beta tool (tool
-- `bulk-customize`, lib/tools/catalog.ts; /dashboard/tools/bulk-customize).
--
-- Bulk Customize turns several REAL cards (Scryfall printings: a deck's
-- printing entries, collection rows, search results) into the maker's own
-- PipGlyph cards in one batch, with one look for all of them (a frame, a
-- border, a set symbol, a watermark) and one choice of art (each printing's,
-- none yet, or AI art in one style). Owner 2026-11-06: "a slot is something
-- you designed" — every card it makes is a customised card (it counts toward
-- the saved-card limit, lives in My Cards, reads "Edited" on a deck), and a
-- batch that would change nothing is refused (lib/cards/exact-copy.ts).
--
-- 1. ai_generation_jobs.kind gains 'bulk_customize'. A batch is an AI job
--    like the others (0059 / 0065 / 0066 / 0106): one step per card, claimed
--    by claim_job_step, written by patch_job_step (never a whole-steps
--    overwrite), a charged step's credit settled in the same transaction as
--    its done-write, refunded on failure, and swept by the reconcile cron if
--    a function dies mid-step. Its `plan` is server-only (0163). The step
--    re-derives everything it saves from the printing and the owner's own
--    rows — a plan names sources, never what to write.
--
-- 2. collection_cards gains customized_card_id / customized_at: the card a
--    collection row was last customised into ("a collection row records its
--    customised card"). Written by the server (service role) after the card
--    exists, never by an API role (0185's column grant: UPDATE of quantity
--    alone). A trigger holds the card to the row's own owner. ON DELETE SET
--    NULL: a deleted card leaves the row as it was.
--
-- 3. card_ai_calls gains 'bulk_customize_art' (one row per AI picture a
--    batch paints; one credit each, two for a double-faced card).
--
-- Grants are explicit (0097). Idempotent. Ships through a PR; never applied
-- ad-hoc.

-- ===========================================================================
-- 1. The job kind
-- ===========================================================================

alter table public.ai_generation_jobs
  drop constraint if exists ai_generation_jobs_kind_check;

alter table public.ai_generation_jobs
  add constraint ai_generation_jobs_kind_check
  check (kind in ('deck', 'deck_remix', 'card', 'card_remix', 'card_fill', 'bulk_customize'));

-- ===========================================================================
-- 2. A collection row's customised card
-- ===========================================================================

alter table public.collection_cards
  add column if not exists customized_card_id uuid references public.cards (id) on delete set null,
  add column if not exists customized_at timestamptz;

create index if not exists collection_cards_customized_idx
  on public.collection_cards (customized_card_id)
  where customized_card_id is not null;

comment on column public.collection_cards.customized_card_id is
  'Bulk Customize (0186): the PipGlyph card this printing was last customised into — the row owner''s own card. Written by the server only.';
comment on column public.collection_cards.customized_at is
  'Bulk Customize (0186): when customized_card_id was last written.';

-- The card must be the row owner's own (a crafted write could otherwise
-- point a row at another user's card). Cheap: one primary-key read, and only
-- when the column changes.
create or replace function public.collection_cards_check_customized()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.customized_card_id is not null
     and (tg_op = 'INSERT' or new.customized_card_id is distinct from old.customized_card_id) then
    if not exists (
      select 1 from public.cards c
      where c.id = new.customized_card_id and c.owner_id = new.owner_id
    ) then
      raise exception 'collection_customized_card_not_owned'
        using errcode = '42501',
              hint = 'A collection row records only its owner''s own card.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists collection_cards_check_customized on public.collection_cards;
create trigger collection_cards_check_customized
  before insert or update of customized_card_id on public.collection_cards
  for each row execute function public.collection_cards_check_customized();

revoke all on function public.collection_cards_check_customized() from public, anon, authenticated;

-- 0185's grants stand: authenticated reads the table (these columns too)
-- and may UPDATE the quantity alone — never these columns. Restated so the
-- migration says what it relies on.
revoke all on public.collection_cards from public, anon, authenticated;
grant select, delete on public.collection_cards to authenticated;
grant update (quantity) on public.collection_cards to authenticated;
grant select, insert, update, delete on public.collection_cards to service_role;

-- ===========================================================================
-- 3. The AI label
-- ===========================================================================

alter table public.card_ai_calls
  drop constraint if exists card_ai_calls_action_check;

alter table public.card_ai_calls
  add constraint card_ai_calls_action_check check (
    action = any (array[
      'improve_wording',
      'suggest_cost',
      'suggest_rarity',
      'generate_flavor',
      'generate_art_prompt',
      'check_balance',
      'generate_from_concept',
      'generate_random_card',
      'generate_random_art',
      'fill_card',
      'generate_deck',
      'remix_card',
      'remix_art',
      'generate_set_icon',
      'generate_deck_cards',
      'generate_card_ideas',
      'generate_deck_ideas',
      'analyze_deck',
      'build_collection_deck',
      'bulk_customize_art'
    ])
  );
